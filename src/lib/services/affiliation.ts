import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeLinkedInUrl } from "@/lib/services/knowledge-base";
import { WebExtractionService } from "@/lib/services/web-extraction-service";

/**
 * How sure are we that this person works at this company?
 *
 * `people.organization_id` was a bare FK: set once, never revisited, with no
 * record of what convinced us. That made a wrong link invisible (nothing
 * distinguishes a scraped guess from a confirmed employee) and permanent
 * (findOrCreatePerson only ever filled it when null, so even a real job change
 * could not correct it).
 *
 * Deliberately shaped like email-pattern.ts — a weight per source, a monotonic
 * writer that never downgrades — so affiliation and email provenance read as
 * one system rather than two competing conventions.
 */

export type AffiliationSource =
  | "user_entered"
  | "email_domain"
  | "team_page"
  | "linkedin_profile"
  | "csv_import"
  | "llm_verified"
  | "search_stamp";

export const AFFILIATION_WEIGHT: Record<AffiliationSource, number> = {
  /** A human said so. Nothing outranks it. */
  user_entered: 1.0,
  /**
   * A verifier confirmed a deliverable mailbox at the company's own domain.
   * The strongest machine signal available: someone who answers mail at
   * acme.com works at Acme. Only granted when the domain is NOT catch-all —
   * a catch-all accepts anything and proves nothing.
   */
  email_domain: 0.95,
  /** Listed on the company's own website. They published it about themselves. */
  team_page: 0.9,
  /**
   * The user's uploaded target list places them at this company. Deliberately
   * NOT ranked as a human assertion: uploads are routinely AI-generated
   * prospect lists or stale exports from another tool, so the claim is
   * secondhand at best. Above the send threshold — an imported contact is
   * actionable as-is — but below email_domain, so Signal's own verification
   * can correct a bad upload, and below user_entered, so it never triggers
   * the human-override move.
   */
  csv_import: 0.85,
  /** Their LinkedIn profile names this employer. */
  linkedin_profile: 0.8,
  /** An LLM read the evidence and judged them an employee. */
  llm_verified: 0.6,
  /**
   * They came back from a search we ran for this company. This is the weakest
   * possible claim and, before this work, was the *only* thing behind most
   * affiliations — searchPeople stamped every result with the target org.
   */
  search_stamp: 0.2,
};

/**
 * Minimum confidence to be contacted. Sits just below llm_verified, so a
 * positive LLM judgement is enough to email someone but a bare search hit is
 * not.
 */
export const AFFILIATION_SEND_THRESHOLD = 0.6;

/**
 * Records why we believe someone works somewhere. Monotonic in the same sense
 * as recordVerifiedEmail: a weaker signal never overwrites a stronger one.
 *
 * The cross-org case is the interesting one. Stronger evidence for a
 * *different* employer does move the person — that is a job change, or a
 * correction of a bad stamp — while equal-or-weaker evidence is ignored. That
 * is what makes affiliation revisable at all.
 */
export async function recordAffiliation(
  supabase: SupabaseClient,
  args: {
    personId: string;
    organizationId: string | null;
    source: AffiliationSource;
    evidence: string;
  },
): Promise<void> {
  const { personId, organizationId, source, evidence } = args;
  const incoming = AFFILIATION_WEIGHT[source];

  const { data: person } = await supabase
    .from("people")
    .select("organization_id, affiliation_source, affiliation_confidence")
    .eq("id", personId)
    .maybeSingle();

  if (!person) return;

  const existingSource = person.affiliation_source as AffiliationSource | null;
  // A pre-existing link with no recorded source is legacy data, and we know
  // nothing about how it got there — treat it as the weakest possible claim
  // rather than as unassailable.
  const existingWeight = existingSource
    ? AFFILIATION_WEIGHT[existingSource]
    : person.organization_id
      ? AFFILIATION_WEIGHT.search_stamp
      : -1;

  const sameOrg = person.organization_id === organizationId;

  // Moving someone between companies — or detaching them entirely — requires
  // STRICTLY stronger evidence than whatever put them where they are.
  //
  // This was `incoming < existingWeight` with the equal-weight guard applied
  // only to same-org writes, which meant equal evidence could reassign across
  // orgs. Since no row is backfilled, every pre-existing person is
  // organization_id-set + source-NULL, which this function scores as
  // search_stamp (0.2) — so a single `rejected` verdict, also 0.2, was enough to
  // silently orphan any legacy contact. `people` is a shared pool across users
  // on an instance, so one person's search could empty someone else's contact
  // list. Two equal-confidence LLM calls would also ping-pong the same contact
  // between two companies on alternate runs.
  // A person explicitly assigned by a human always moves. Requiring strictly
  // more than the existing weight would make someone already at `user_entered`
  // (1.0) unmovable — nothing outranks 1.0 — so reassigning a contact you had
  // previously assigned by hand would silently no-op while the endpoint
  // returned success.
  const humanOverride = source === "user_entered";

  if (!humanOverride) {
    if (sameOrg) {
      if (incoming < existingWeight) return;
      if (incoming === existingWeight && existingSource) return;
    } else if (incoming <= existingWeight) {
      return;
    }
  }

  await supabase
    .from("people")
    .update({
      organization_id: organizationId,
      affiliation_source: source,
      affiliation_confidence: incoming,
      affiliation_evidence: evidence.slice(0, 500),
      affiliation_verified_at: new Date().toISOString(),
    })
    .eq("id", personId);
}

// ─── Send gate ────────────────────────────────────────────────────────────

/** The fields the send gate reads. */
export interface SendCandidate {
  work_email: string | null;
  /** Read only to give an accurate refusal reason — never sendable itself. */
  personal_email?: string | null;
  work_email_source: string | null;
  work_email_verification: string | null;
  affiliation_confidence: number | null;
  affiliation_source: string | null;
}

export type SendCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether we know enough about a contact to email them.
 *
 * Nothing checked this before: the send path only asked whether the address
 * field was non-empty, so a blind {first}.{last}@domain guess written at
 * confidence 0.2 was treated exactly like an address the user typed in
 * themselves. Both halves of the check matter and they fail differently — a bad
 * address bounces and costs sender reputation, a bad affiliation sends a
 * personalised pitch about the wrong company to a real person.
 *
 * Returns a reason rather than a bare false so the agent can explain the
 * blockage and offer the fix, instead of silently skipping the contact.
 */
export function canSendTo(person: SendCandidate): SendCheck {
  if (!person.work_email) {
    return {
      ok: false,
      // Distinguish "nothing at all" from "only a personal address". saveDraft
      // will happily address a draft to personal_email, so the old blanket
      // "no email address on file" was factually wrong for those contacts and
      // the agent relayed it to the user as fact.
      reason: person.personal_email
        ? "only a personal address is on file — outreach requires a work address (enter one to unblock)"
        : "no email address on file",
    };
  }

  // A human typing the address outranks any machine verdict, including a
  // catch-all "risky". Without this exemption, correcting a bad address by hand
  // could not unblock a contact — and on a catch-all domain, where every
  // address verifies `risky`, nothing could ever be sent at all.
  const humanEntered = person.work_email_source === "user_entered";

  // `undeliverable` blocks unconditionally — including for user_entered.
  //
  // The human exemption must not cover this verdict: a bounce is recorded
  // about the exact string currently stored, so a hand-typed address that hard
  // bounced is a typo, and exempting it made that typo permanently sendable —
  // nothing ever displaces user_entered (1.0), and findEmail refuses to
  // re-check trusted sources. The way out is entering a *different* address,
  // which clears the verdict.
  //
  // Checked BEFORE the source shortcuts below for the same reason as ever:
  // every address that has been sent carries `send_confirmed` by definition,
  // so trusting the source first kept hard-bounced mailboxes sendable.
  if (person.work_email_verification === "undeliverable") {
    return {
      ok: false,
      reason:
        "this address hard-bounced — enter a corrected address for this contact",
    };
  }

  // `risky` is different: it usually means a catch-all domain, where EVERY
  // address verifies risky, so without a human exemption nothing at such a
  // company could ever be emailed. A person vouching for the address is the
  // one signal a catch-all cannot fake.
  if (!humanEntered && person.work_email_verification === "risky") {
    return {
      ok: false,
      reason: `email verification came back "risky" — it is not confirmed deliverable`,
    };
  }

  // A human typing the address, or a previous send it accepted, is proof enough
  // — neither needs a verifier to confirm it.
  const emailTrusted =
    person.work_email_source === "user_entered" ||
    person.work_email_source === "send_confirmed" ||
    person.work_email_verification === "deliverable";

  if (!emailTrusted) {
    const state = person.work_email_verification ?? "unchecked";
    return {
      ok: false,
      reason:
        state === "unchecked"
          ? "email has never been verified — run findEmail with an email provider configured, or enter the address manually"
          : `email verification came back "${state}" — it is not confirmed deliverable`,
    };
  }

  const confidence = person.affiliation_confidence ?? 0;
  if (confidence < AFFILIATION_SEND_THRESHOLD) {
    return {
      ok: false,
      reason: person.affiliation_source
        ? `not confirmed to work at this company (evidence: ${person.affiliation_source}, confidence ${confidence.toFixed(2)})`
        : "no evidence on file that this person works at this company",
    };
  }

  return { ok: true };
}

/**
 * Draft-stage predicate: is this contact worth spending a Claude call drafting
 * for?
 *
 * Deliberately laxer than canSendTo on exactly one axis. An `unchecked` email
 * is a fine reason to draft — verification is lazy, and the send gate proves
 * the address just-in-time when the mail actually leaves. What still blocks a
 * draft: no address at all, an address already proven dead or risky, and an
 * unconfirmed employer (a personalised pitch about the wrong company is wasted
 * whichever address it goes to).
 */
export function canDraftFor(person: SendCandidate): SendCheck {
  if (!person.work_email) {
    return {
      ok: false,
      reason: person.personal_email
        ? "only a personal address is on file — outreach requires a work address"
        : "no email address on file",
    };
  }

  const humanEntered = person.work_email_source === "user_entered";
  if (person.work_email_verification === "undeliverable") {
    return { ok: false, reason: "this address hard-bounced" };
  }
  if (!humanEntered && person.work_email_verification === "risky") {
    return { ok: false, reason: "address is on a catch-all domain" };
  }

  const confidence = person.affiliation_confidence ?? 0;
  if (confidence < AFFILIATION_SEND_THRESHOLD) {
    return {
      ok: false,
      reason: person.affiliation_source
        ? `not confirmed to work at this company (evidence: ${person.affiliation_source})`
        : "no evidence on file that this person works at this company",
    };
  }

  return { ok: true };
}

/** Columns canSendTo needs — keep SELECTs and the predicate in step. */
export const SEND_GATE_COLUMNS =
  "work_email, personal_email, work_email_source, work_email_verification, affiliation_confidence, affiliation_source, organization_id";

// ─── LinkedIn employer check ──────────────────────────────────────────────

export type EmployerCheck =
  | { status: "match"; employer: string }
  | { status: "mismatch"; employer: string }
  /** Rate-limited, blocked, or unparseable — tells us nothing either way. */
  | { status: "unknown"; reason: string };

/**
 * Normalize a company name for comparison: lowercase, strip common legal
 * suffixes, collapse punctuation and whitespace.
 *
 * Duplicated deliberately rather than imported from contact-filter, which owns
 * the LLM path — this is a small pure helper and importing that module would
 * drag an Anthropic client into every affiliation check.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(ltd|limited|inc|incorporated|llc|plc|corp|corporation|co|company|group|holdings)\b\.?/g,
      "",
    )
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pulls the employer out of a LinkedIn profile.
 *
 * The page title is reliably "Name - Employer | LinkedIn", and og:description
 * carries "· Experience: <Employer> ·" as a fallback. Both survive the
 * logged-out view, which is the only view we get without authenticating.
 */
export function parseLinkedInEmployer(
  title: string | null | undefined,
  ogDescription?: string | null,
): string | null {
  const fromTitle = title
    ?.replace(/\s+/g, " ")
    .trim()
    .match(/^(.+?)\s+-\s+(.+?)\s*\|\s*LinkedIn/)?.[2];
  if (fromTitle) return fromTitle.trim();

  const fromDesc = ogDescription?.match(/Experience:\s*([^·]+)/i)?.[1];
  return fromDesc ? fromDesc.trim() : null;
}

/**
 * Checks a person's LinkedIn profile against the employer we have on file.
 *
 * Best-effort by design. LinkedIn rate-limits aggressively (HTTP 999) and
 * roughly half of attempts come back empty; an `unknown` result must leave the
 * existing affiliation exactly as it was. Treating a block as a mismatch would
 * unlink real employees at random.
 */
export async function checkLinkedInEmployer(
  linkedinUrl: string,
  expectedCompany: string,
): Promise<EmployerCheck> {
  // Must be the www host — the apex form redirects and our scrapers return an
  // empty body for it. Every URL stored before this fix is apex.
  const url = normalizeLinkedInUrl(linkedinUrl);

  const extractor = new WebExtractionService();
  const result = await extractor.extract(url, {
    includeMetadata: true,
    includeLinks: false,
    timeout: 10_000,
  });

  if (!result.success) {
    return { status: "unknown", reason: result.error ?? "fetch failed" };
  }

  const employer = parseLinkedInEmployer(
    result.data.title,
    result.data.openGraph?.description ?? result.data.description,
  );

  if (!employer) {
    return { status: "unknown", reason: "no employer in profile" };
  }

  const seen = normalizeCompanyName(employer);
  const expected = normalizeCompanyName(expectedCompany);
  if (!seen || !expected) {
    return { status: "unknown", reason: "unusable company name" };
  }

  // Substring either way: "Browserbase" vs "Browserbase Inc", or a headline
  // that reads "Acme (YC W24)".
  const match = seen.includes(expected) || expected.includes(seen);
  return match
    ? { status: "match", employer }
    : { status: "mismatch", employer };
}
