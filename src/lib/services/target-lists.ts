import type { SupabaseClient } from "@supabase/supabase-js";

import {
  canHoldPeople,
  findOrCreateOrganization,
  findOrCreatePerson,
  normalizeDomain,
} from "@/lib/services/knowledge-base";
import { recordAffiliation } from "@/lib/services/affiliation";
import { recordVerifiedEmail } from "@/lib/services/email-pattern";
import {
  mapUnknownHeaders,
  type HeaderMapping,
  type HeaderSample,
} from "@/lib/csv/header-mapper";
import type { TargetAccountRow } from "@/lib/types/target-list";

/** Row cap per append request — mirror import-limits.ts. */
export const MAX_ROWS_PER_REQUEST = 500;

/** Same chunked parallelism as import-csv (route.ts:164-179). */
const CHUNK_SIZE = 10;

/** Minimal email shape gate — CSVs carry junk like "n/a" or "see notes". */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface AppendAccountsResult {
  imported: number;
  skipped: number;
  failed: number;
  peopleImported: number;
}

/** A contact carried by a contact-per-row export (Apollo/Clay/CRM). */
interface PersonRow {
  name: string;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
}

/** One company after in-batch grouping, ready to resolve + insert. */
interface Candidate {
  name: string;
  domain: string | null;
  url: string | null;
  industry: string | null;
  location: string | null;
  description: string | null;
  /** Original row content, preserved verbatim on the target_accounts row. */
  raw: Record<string, string>;
  /** Contacts from every row that grouped into this company. */
  people: PersonRow[];
}

/**
 * Resolve rows to organizations (domain-deduped globally via
 * findOrCreateOrganization) and insert target_accounts. Dedup within the list
 * is by organization_id via the (list_id, organization_id) unique constraint —
 * on-conflict-do-nothing, counted as skipped. Chunks of 10 like import-csv.
 *
 * When rows carry unmapped headers in `extra`, the LLM header mapper runs once
 * for the whole batch and mapped fields are folded into empty canonical slots.
 *
 * Contact-per-row files (rows carrying `person`) additionally import people:
 * one org + N contacts per company, deduped by linkedin_url / name+org inside
 * findOrCreatePerson, with affiliation provenance (`csv_import` — an upload
 * is a suggestion Signal's own verification may override, not a human
 * assertion) and the email stored as an unchecked suggestion the send gate
 * verifies just-in-time. People are NOT linked to any campaign here
 * — linkTargetListToCampaign owns that.
 */
export async function appendAccountsToList(
  supabase: SupabaseClient,
  listId: string,
  rows: TargetAccountRow[],
  opts: { userId?: string } = {},
): Promise<AppendAccountsResult> {
  const headerMapping = await resolveExtraHeaders(rows, opts.userId);

  // Pass 1 (sequential, cheap): fold extras, normalize, dedup into candidates.
  // Same reasoning as import-csv: domain-less rows dedup by normalized name
  // because findOrCreateOrganization's matching can't serialize two identical
  // rows racing in the same parallel chunk.
  let skipped = 0;
  const groups = new Map<string, Candidate>();

  for (const row of rows) {
    const folded = foldExtra(row, headerMapping);
    const name = folded.name?.trim();
    if (!name) {
      skipped++;
      continue;
    }

    let domain: string | null = folded.domain?.trim() || null;
    if (!domain && folded.url) {
      try {
        domain = new URL(
          folded.url.startsWith("http") ? folded.url : `https://${folded.url}`,
        ).hostname;
      } catch {
        // unusable URL — leave the row domain-less
      }
    }
    if (domain) domain = normalizeDomain(domain);

    const key = domain ?? `name:${name.toLowerCase()}`;
    const person = sanitizePerson(row.person);
    const existing = groups.get(key);
    if (existing) {
      // Contact-per-row files legitimately repeat the company: later rows
      // contribute their person to the group instead of counting as dups.
      if (person) existing.people.push(person);
      else skipped++;
      continue;
    }

    groups.set(key, {
      name,
      domain,
      url: folded.url?.trim() || (domain ? `https://${domain}` : null),
      industry: folded.industry?.trim() || null,
      location: folded.location?.trim() || null,
      description: folded.description?.trim() || null,
      raw: buildRaw(folded, row.extra),
      people: person ? [person] : [],
    });
  }

  // Pass 2 (parallel chunks): resolve orgs + upsert accounts. Org creation
  // recovers from 23505 races and the account insert ignores duplicates, so
  // chunk-internal parallelism is safe.
  let imported = 0;
  let failed = 0;
  let peopleImported = 0;
  const candidates = [...groups.values()];

  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + CHUNK_SIZE);
    const results = await Promise.allSettled(
      chunk.map(async (candidate) => {
        const org = await findOrCreateOrganization({
          name: candidate.name,
          domain: candidate.domain,
          url: candidate.url,
          industry: candidate.industry,
          location: candidate.location,
          description: candidate.description,
          source: "target_list",
        });

        const { data: upserted, error } = await supabase
          .from("target_accounts")
          .upsert(
            { list_id: listId, organization_id: org.id, raw: candidate.raw },
            { onConflict: "list_id,organization_id", ignoreDuplicates: true },
          )
          .select("id");
        if (error) {
          throw new Error(`Failed to insert target account: ${error.message}`);
        }

        // People import runs even when the account already existed (a
        // re-import should still pick up new contacts); dedup happens inside
        // findOrCreatePerson via linkedin_url / name+org. Domain-less orgs
        // never hold people (canHoldPeople) — two same-named companies are
        // indistinguishable without a domain, so attaching contacts is how
        // the wrong people end up pooled under the right name.
        let people = 0;
        if (candidate.people.length > 0 && canHoldPeople(org)) {
          for (const p of candidate.people) {
            const person = await findOrCreatePerson(
              {
                name: p.name,
                title: p.title,
                linkedin_url: p.linkedin_url,
                work_email: p.email,
                organization_id: org.id,
                source: "target_list",
              },
              supabase,
            );

            // The upload names this employer, but a CSV is often an
            // AI-generated prospect list or a stale export — a suggestion,
            // not a human assertion. csv_import (0.85) keeps the contact
            // above the send threshold while letting email_domain
            // verification or an explicit human edit override a bad upload.
            await recordAffiliation(supabase, {
              personId: person.id,
              organizationId: org.id,
              source: "csv_import",
              evidence: `the user's uploaded target list places them at ${candidate.name}`,
            });

            // Imported addresses are free suggestions, not proof: csv_import
            // ranks below every verified-ish source, so an upload can never
            // displace an address a scrape or provider established, and
            // verification stays unchecked so the send gate's just-in-time
            // verifier proves the mailbox before anything leaves
            // (lazy-verification convention). Junk that isn't even
            // email-shaped is skipped silently — the person still imports.
            if (p.email && EMAIL_SHAPE.test(p.email)) {
              await recordVerifiedEmail(supabase, {
                personId: person.id,
                email: p.email,
                source: "csv_import",
              });
            }
            people++;
          }
        }

        // ignoreDuplicates returns no row when the account already existed.
        return { inserted: (upserted?.length ?? 0) > 0, people };
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.inserted) imported++;
        else skipped++;
        peopleImported += r.value.people;
      } else {
        failed++;
        console.error("[target-lists] row failed:", r.reason);
      }
    }
  }

  // Read-modify-write is fine under one owner (RLS scopes the list to them).
  if (imported > 0) {
    const { data: list } = await supabase
      .from("target_account_lists")
      .select("row_count")
      .eq("id", listId)
      .single();
    await supabase
      .from("target_account_lists")
      .update({ row_count: (list?.row_count ?? 0) + imported })
      .eq("id", listId);
  }

  return { imported, skipped, failed, peopleImported };
}

/**
 * One header-mapper call per batch: collect every header seen in `extra`
 * (with up to 3 sample values each) and ask for canonical assignments.
 * Returns {} when nothing is unmapped, so callers pay no LLM cost.
 */
async function resolveExtraHeaders(
  rows: TargetAccountRow[],
  userId?: string,
): Promise<Record<string, HeaderMapping>> {
  const samplesByHeader = new Map<string, string[]>();
  for (const row of rows) {
    for (const [header, value] of Object.entries(row.extra ?? {})) {
      const samples = samplesByHeader.get(header) ?? [];
      if (value && samples.length < 3) samples.push(value);
      samplesByHeader.set(header, samples);
    }
  }
  if (samplesByHeader.size === 0) return {};

  const headerSamples: HeaderSample[] = [...samplesByHeader].map(
    ([header, samples]) => ({ header, samples }),
  );
  return mapUnknownHeaders(headerSamples, { userId });
}

/** Trim a row's person into a PersonRow, or null when there is no usable name. */
function sanitizePerson(person: TargetAccountRow["person"]): PersonRow | null {
  const name = person?.name?.trim();
  if (!name) return null;
  return {
    name,
    title: person?.title?.trim() || null,
    email: person?.email?.trim() || null,
    linkedin_url: person?.linkedin_url?.trim() || null,
  };
}

/** Fold header-mapped extra values into canonical fields the row left empty. */
function foldExtra(
  row: TargetAccountRow,
  mapping: Record<string, HeaderMapping>,
): TargetAccountRow {
  if (!row.extra) return row;
  const folded = { ...row };
  for (const [header, value] of Object.entries(row.extra)) {
    const field = mapping[header];
    if (!field || field === "ignore" || !value) continue;
    if (!folded[field]) folded[field] = value;
  }
  return folded;
}

/** The original CSV row, verbatim: canonical fields plus everything unmapped. */
function buildRaw(
  row: TargetAccountRow,
  extra: Record<string, string> | undefined,
): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const field of [
    "name",
    "domain",
    "url",
    "industry",
    "location",
    "description",
  ] as const) {
    const value = row[field];
    if (value) raw[field] = value;
  }
  return { ...raw, ...extra };
}
