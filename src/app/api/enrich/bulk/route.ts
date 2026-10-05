import { z } from "zod";
import { isHostedMode } from "@/lib/auth/workspace";
import { executePaidAction, hasPaidAction } from "@/lib/billing/paid-action";
import { toolOperationKey } from "@/lib/billing/tool-operation-key";
import { CreditExecutionError, NoBillableWork } from "@/lib/billing/credit-execution";
import { NextResponse } from "next/server";

import { getSupabaseAndUser } from "@/lib/supabase/server";
import { isRecentlyEnriched } from "@/lib/services/knowledge-base";
import {
  enrichPerson,
  PERSON_ENRICH_COLUMNS,
  type PersonForEnrichment,
  type PersonEnrichmentResult,
} from "@/lib/services/person-enrichment";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Bulk "Enrich all" for one company's contacts.
 *
 * Deliberately capped and re-clickable rather than unbounded. A single
 * enrichment is allowed 120s of its own (see /api/enrich), so a 40-contact
 * company cannot possibly finish inside one request: the honest design is a
 * small batch plus "click again", the same shape /api/find-email/bulk already
 * uses for the same reason.
 */
const MAX_PER_REQUEST = 10;

/**
 * Enrichments in flight at once.
 *
 * find-email/bulk is sequential ON PURPOSE, because the first lookup at an org
 * caches an email pattern the rest derive from for free. Enrichment has no
 * such dependency -- each contact is independent -- so serialising it would
 * only make a batch four times slower. Kept modest because each one fans out
 * to LinkedIn, X and three Exa searches.
 */
const CONCURRENCY = 4;

/** organizationId is required: one click = one company, never a campaign-wide fanout. */
export async function POST(req: Request) {
  try {
    return await enrichBatch(req);
  } catch (error) {
    console.error("[enrich/bulk] Request failed", error);
    return NextResponse.json(
      { error: "Could not prepare enrichment. Retry the same batch." },
      { status: 500 },
    );
  }
}

async function enrichBatch(req: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  let body: {
    campaignId?: string;
    organizationId?: string;
    personIds?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { campaignId, organizationId } = body ?? {};
  if (typeof campaignId !== "string" || !campaignId) {
    return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  }
  if (typeof organizationId !== "string" || !organizationId) {
    return NextResponse.json(
      { error: "organizationId required (one company per request)" },
      { status: 400 },
    );
  }

  const hosted = isHostedMode();
  const batchKey = req.headers.get("Idempotency-Key");
  const selection = z
    .array(z.string().uuid())
    .min(1)
    .max(MAX_PER_REQUEST)
    .refine((ids) => new Set(ids).size === ids.length)
    .safeParse(body.personIds);
  if (
    (hosted && !z.string().uuid().safeParse(batchKey).success) ||
    ((hosted || body.personIds !== undefined) && !selection.success)
  )
    return NextResponse.json(
      { error: "A valid retry key and 1–10 unique contact IDs are required." },
      { status: 400 },
    );
  const selected = selection.success ? new Set(selection.data) : null;

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("user_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = supabase
    .from("campaign_people")
    .select(
      `person:people!inner(id, organization_id, ${PERSON_ENRICH_COLUMNS})`,
    )
    .eq("campaign_id", campaignId);
  if (selected)
    query = query
      .in("person_id", [...selected])
      .eq("person.organization_id", organizationId);
  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    person:
      | (PersonForEnrichment & { id: string; organization_id: string | null })
      | null;
  };

  const candidates: Array<{ id: string; person: PersonForEnrichment }> = [];
  for (const row of (rows ?? []) as unknown as Row[]) {
    const person = row.person;
    if (!person || (selected && !selected.has(person.id))) continue;
    if (person.organization_id !== organizationId) continue;
    candidates.push({ id: person.id, person });
  }

  const paidInputFor = (personId: string) => ({
    identity: { userId: user.id, source: "web" as const },
    kind: "contact.enrich.web",
    key: hosted ? toolOperationKey("web", undefined, JSON.stringify([
      batchKey!.toLowerCase(), campaignId, organizationId, personId,
    ])) : null,
    request: { personId },
  });

  // Skip anyone already enriched recently. isRecentlyEnriched's default window
  // is 7 days, so genuinely stale data still refreshes rather than being
  // frozen forever by one old run.
  const fresh = await Promise.all(
    candidates.map(async (c) => {
      const existing = hosted && await hasPaidAction(paidInputFor(c.id));
      return (await isRecentlyEnriched("people", c.id, 7, hosted)) && !existing;
    }),
  );
  const pending = candidates.filter((_, i) => !fresh[i]);
  const alreadyEnriched = candidates.length - pending.length;

  const targets = pending.slice(0, MAX_PER_REQUEST);

  const enriched: string[] = [];
  const failed: Array<{ personId: string; reason?: string }> = [];

  const blocked: Array<{ error: string; status: number }> = [];

  // Simple worker pool: CONCURRENCY workers pulling from one cursor.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      for (;;) {
        if (blocked.length) return;
        const index = cursor++;
        if (index >= targets.length) return;
        const target = targets[index];
        try {
          const work = async () => {
            // Run this after the ledger claim: simultaneous retries must share
            // one durable outcome before the browser can discard its batch key.
            if (
              hosted &&
              (!target.person.name || target.person.name === "Unknown") &&
              !target.person.linkedin_url && !target.person.twitter_url
            ) return new NoBillableWork({
              status: "failed" as const,
              enrichmentData: {},
              errors: ["No enrichment sources available"],
            });
            const result = await enrichPerson(
              supabase,
              target.id,
              target.person,
              user.id,
            );
            if (hosted && result.status === "failed")
              throw new Error("All enrichment sources failed");
            return result;
          };
          const result = hosted
            ? await executePaidAction<PersonEnrichmentResult>(
                paidInputFor(target.id),
                work,
              )
            : await enrichPerson(supabase, target.id, target.person, user.id);
          if (result.status === "enriched") enriched.push(target.id);
          else
            failed.push({
              personId: target.id,
              reason: result.errors?.[0] ?? "No data found",
            });
        } catch (err) {
          if (hosted && !blocked.length)
            blocked.push({
              error:
                err instanceof CreditExecutionError
                  ? err.message
                  : "Enrichment failed. Retry the same batch.",
              status: err instanceof CreditExecutionError ? err.status : 500,
            });
          failed.push({
            personId: target.id,
            reason: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }
    }),
  );

  if (blocked.length)
    return NextResponse.json(
      {
        error: blocked[0].error,
        enriched: enriched.length,
        failed: failed.length,
        remaining: Math.max(
          0,
          targets.length - enriched.length - failed.length,
        ),
      },
      { status: blocked[0].status },
    );

  const remaining = Math.max(0, pending.length - targets.length);

  const failureNote = failed.length ? ` ${failed.length} could not be enriched.` : "";
  const sourceNote = failed.some((f) => f.reason === "No enrichment sources available")
    ? " Add a name or social URL to contacts without sources before retrying." : "";

  // Report the skip rather than dropping it: without this, clicking Enrich all
  // on a fully-enriched company looks like the button did nothing.
  const skipNote =
    alreadyEnriched > 0 ? ` ${alreadyEnriched} already enriched, skipped.` : "";

  return NextResponse.json({
    enriched: enriched.length,
    failed: failed.length,
    attempted: targets.length,
    pendingTotal: pending.length,
    remaining,
    alreadyEnriched,
    failures: failed,
    summary:
      targets.length === 0
        ? alreadyEnriched > 0
          ? `Nothing to do: all ${alreadyEnriched} contacts are already enriched.`
          : "No contacts to enrich at this company."
        : remaining > 0
          ? `Enriched ${enriched.length} of ${targets.length} (${remaining} more to go, click again).${skipNote}${failureNote}${sourceNote}`
          : `Enriched ${enriched.length} of ${targets.length}.${skipNote}${failureNote}${sourceNote}`,
  });
}
