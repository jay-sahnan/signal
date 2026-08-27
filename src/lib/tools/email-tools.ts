import { tool } from "ai";
import { z } from "zod";
import { createClient, getSupabaseAndUser } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { callerHoldsPerson, toolSession } from "@/lib/tools/ownership";
import { ExaService } from "@/lib/services/exa-service";
import { trackUsage } from "@/lib/services/cost-tracker";
import {
  sendDraftAndAdvance,
  draftIsCurrentStep,
  type DraftForSend,
} from "@/lib/services/outreach-sender";
import { resolveSenderConfig } from "@/lib/services/email-transport";
import { saveDraft } from "@/lib/email-composition/save";
import {
  applyPattern,
  emailMatchesName,
  getOrgPattern,
  inferPattern,
  isRolePrefix,
  mxCheck,
  recomputeOrgPattern,
  splitName,
  SOURCE_WEIGHT,
  type EmailSource,
  type VerifiedEmail,
} from "@/lib/services/email-pattern";
import {
  getEmailProvider,
  MAX_VERIFICATIONS_PER_PERSON,
  type EmailVerification,
  type VerifyResult,
} from "@/lib/services/email-provider";
import {
  recordAffiliation,
  AFFILIATION_SEND_THRESHOLD,
} from "@/lib/services/affiliation";

// ── Shared findEmail logic ─────────────────────────────────────────────────

const PATTERN_CONFIDENCE_THRESHOLD = 0.5;
// Cap for pattern-derived confidence. Stays strictly below the UI's
// "verified" threshold (0.9) so a pattern guess can never display as verified.
const PATTERN_DERIVED_CONFIDENCE_FACTOR = 0.85;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Confidence awarded to an address a verifier confirmed as deliverable,
 * whatever produced it. This is the point of the whole exercise: proof of
 * delivery outranks provenance, so a pattern guess that verifies is as
 * trustworthy as one scraped off a team page.
 */
const VERIFIED_CONFIDENCE = 0.95;
/** Catch-all domains accept everything, so "deliverable" there proves nothing. */
const CATCH_ALL_CONFIDENCE_CAP = 0.5;
/** The verifier was asked and shrugged — better than unchecked, well short of proof. */
const UNRESOLVED_CONFIDENCE_CAP = 0.6;

/** One address the waterfall produced, before anyone has checked whether it works. */
interface EmailCandidate {
  email: string;
  source: Exclude<EmailSource, "user_entered" | "send_confirmed">;
  /** What we'd have written for this address before verification existed. */
  discoveryConfidence: number;
}

/**
 * Adds a candidate if it is plausible and not already present.
 *
 * Ordering is significance-ordered by the caller, so the first occurrence of an
 * address wins and later duplicates are dropped — that keeps the strongest
 * provenance when two strategies converge on the same string (which they
 * routinely do: an org pattern and a blind {first}.{last} agree whenever the
 * pattern *is* {first}.{last}).
 */
function pushCandidate(
  candidates: EmailCandidate[],
  candidate: EmailCandidate | null,
  first: string | null,
  last: string | null,
  opts: { skipNameCheck?: boolean } = {},
): void {
  if (!candidate) return;
  const email = candidate.email.toLowerCase();
  if (isRolePrefix(email.split("@")[0])) return;
  // The name check exists to stop a stranger's address scraped off a page from
  // attaching to this person. It must NOT apply to the address already stored
  // on the person — that address is the thing being re-checked, and a mailbox
  // under a maiden name or nickname fails a legal-name comparison, which
  // silently excluded it from revalidation and left the contact permanently
  // stuck behind the send gate with "could not find an email address".
  if (!opts.skipNameCheck && !emailMatchesName(email, first, last)) return;
  if (candidates.some((c) => c.email === email)) return;
  candidates.push({ ...candidate, email });
}

/**
 * Finds a work email for a person — for free, by default.
 *
 * Discovery and proof are deliberately separated. The free strategies (org
 * pattern, Exa scrape, inference, blind guess) produce a SUGGESTED address,
 * stored as `unchecked` and badged that way in the UI. Proof costs provider
 * credits, so it happens exactly once per address, at the moment it matters:
 * just before a send (services/send-verification, invoked by the send gate) or
 * on an explicit `revalidate`. The paid finder participates only in
 * verification runs, as the best next candidate after a guess is proven dead.
 * Net effect: enrichment can suggest addresses for an entire campaign without
 * spending a credit, and the daily send cap naturally bounds what verification
 * can ever cost.
 *
 * When verification does run (verify/revalidate), strategies only nominate
 * candidates and the verifier decides — proof of delivery outranks provenance,
 * so a pattern guess that verifies beats a scraped address that doesn't.
 */
export async function findEmailForPerson(
  personId: string,
  opts: {
    revalidate?: boolean;
    /**
     * Spend provider credits proving candidates. Off by default — discovery
     * stores a free suggestion and proof happens at send time, so the daily
     * send cap is what bounds verification spend. `revalidate` implies it.
     */
    verify?: boolean;
  } = {},
): Promise<{
  email: string | null;
  source?: string;
  confidence?: number;
  verification?: EmailVerification | "unchecked";
  reason?: string;
  personId: string;
}> {
  const supabase = await createClient();

  const { data: person, error: personErr } = await supabase
    .from("people")
    .select(
      "id, name, title, work_email, personal_email, organization_id, work_email_source, work_email_confidence, work_email_verification, enrichment_data",
    )
    .eq("id", personId)
    .single();

  if (personErr || !person) {
    return { email: null, reason: "Person not found.", personId };
  }

  // An address we already hold short-circuits everything — unless it has never
  // been proven, in which case verifying it IS the job.
  //
  // Without this second clause there was no way to make an existing contact
  // sendable: the gate refuses an unverified address and tells the user to run
  // findEmail, and findEmail returned the same unverified address untouched.
  // Every contact that predates verification was permanently stuck, and the
  // remediation advice was a no-op.
  const alreadyTrusted =
    person.work_email_verification === "deliverable" ||
    person.work_email_source === "user_entered" ||
    person.work_email_source === "send_confirmed";

  if (person.work_email && (alreadyTrusted || !opts.revalidate)) {
    return {
      email: person.work_email,
      source: person.work_email_source ?? "existing",
      confidence: person.work_email_confidence ?? undefined,
      verification: person.work_email_verification ?? "unchecked",
      personId,
      reason:
        alreadyTrusted || !person.work_email
          ? undefined
          : "Stored but unverified. Call findEmail with revalidate: true to check it.",
    };
  }
  // Same revalidate carve-out as above: without it, a person who happens to
  // have a personal address short-circuits here and their unverified work email
  // is never checked, while the tool reports success.
  if (person.personal_email && !opts.revalidate) {
    return { email: person.personal_email, source: "existing", personId };
  }

  let domain: string | null = null;
  let orgIsCatchAll: boolean | null = null;
  if (person.organization_id) {
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("domain, name, is_catch_all")
      .eq("id", person.organization_id)
      .single();
    // A discarded error here nulls the domain, which gates the org pattern,
    // the paid finder, the inferred pattern and the blind guess: the whole
    // waterfall silently degrades to a domainless Exa query, and "not found"
    // is presented as a clean answer for a contact whose org has a perfectly
    // good domain. Fail closed and say it is retryable.
    if (orgError) {
      console.error(
        `[findEmail] company lookup failed for person ${personId}: ${orgError.message}`,
      );
      return {
        email: null,
        reason: `Could not load the contact's company (${orgError.message}), so the email search was not run. Retry.`,
        personId,
      };
    }
    domain = org?.domain ?? null;
    orgIsCatchAll = org?.is_catch_all ?? null;
  }

  const { first, last } = splitName(person.name);
  const provider = getEmailProvider();
  const candidates: EmailCandidate[] = [];
  // Set by the pattern tiers; a confident pattern makes the paid Exa scrape
  // redundant for free discovery (the send gate verifies the guess later).
  let haveConfidentPattern = false;
  // Discovery is free by default; credits are spent only when explicitly asked
  // (revalidate / the send gate's JIT path), so the daily send cap is the
  // effective verification budget.
  const wantVerify = opts.verify ?? opts.revalidate ?? false;

  // The domain has to be able to receive mail at all before any address at it
  // is worth proposing — one DNS lookup gates every domain-derived candidate.
  const domainAcceptsMail = domain ? await mxCheck(domain) : false;

  // ── 0) The address already on file, when we were asked to re-check it. It
  //       goes first because it is what the user has actually seen and what any
  //       existing draft is addressed to.
  if (opts.revalidate && person.work_email) {
    pushCandidate(
      candidates,
      toCandidate(
        person.work_email,
        (person.work_email_source as EmailCandidate["source"]) ??
          "pattern_derived",
        person.work_email_confidence ?? 0,
      ),
      first,
      last,
      // The stored address is what is being checked — a nickname or maiden-name
      // mailbox must not be excluded for failing a legal-name comparison.
      { skipNameCheck: true },
    );
  }

  // ── 1) Org pattern, if we've learned a confident one from verified emails.
  if (domainAcceptsMail && domain && person.organization_id && first) {
    const orgPattern = await getOrgPattern(supabase, person.organization_id);
    if (
      orgPattern?.pattern &&
      orgPattern.confidence >= PATTERN_CONFIDENCE_THRESHOLD
    ) {
      haveConfidentPattern = true;
      pushCandidate(
        candidates,
        toCandidate(
          applyPattern(orgPattern.pattern, first, last, domain),
          "pattern_derived",
          orgPattern.confidence * PATTERN_DERIVED_CONFIDENCE_FACTOR,
        ),
        first,
        last,
      );
    }
  }

  // ── 2) Paid finder — verification runs only. Free discovery never bills:
  //       the blind guess below guarantees a suggestion exists, and the send
  //       gate proves it later. But when we ARE verifying (an explicit
  //       revalidate after a guess was proven dead), the finder is the best
  //       next candidate — a targeted answer, tried before burning a
  //       verification credit on the blind guess.
  if (
    wantVerify &&
    provider?.canFind &&
    domainAcceptsMail &&
    domain &&
    first &&
    last
  ) {
    const hit = await provider.findEmail({
      firstName: first,
      lastName: last,
      domain,
      linkedinUrl: null,
    });
    pushCandidate(
      candidates,
      toCandidate(hit?.email ?? null, "provider_found", hit?.confidence ?? 0.7),
      first,
      last,
    );
  }

  // ── 3) On-the-fly inference from any verified emails already on the org.
  //       Covers the case where the org has evidence but the cached pattern
  //       hasn't been recomputed or sits below the threshold. Runs before the
  //       Exa scrape because it is a free DB read and, when confident, makes
  //       that paid search unnecessary.
  if (domainAcceptsMail && domain && person.organization_id && first && last) {
    const inferred = await inferPatternFromOrg(
      supabase,
      person.organization_id,
    );
    if (inferred?.pattern) {
      if (inferred.confidence >= PATTERN_CONFIDENCE_THRESHOLD) {
        haveConfidentPattern = true;
      }
      pushCandidate(
        candidates,
        toCandidate(
          applyPattern(inferred.pattern, first, last, domain),
          "pattern_derived",
          inferred.confidence * PATTERN_DERIVED_CONFIDENCE_FACTOR,
        ),
        first,
        last,
      );
    }
  }

  // ── 4) Exa scrape of pages mentioning the person. Skipped for free
  //       discovery when a confident pattern already produced a suggestion:
  //       it was a third of all Exa spend, and the send gate proves or kills
  //       the pattern guess anyway. When verifying (a guess was just proven
  //       dead) it runs regardless, with the response cache bypassed.
  if (wantVerify || !haveConfidentPattern) {
    for (const email of await searchEmailsViaExa(
      person.name,
      domain,
      first,
      last,
      personId,
      wantVerify,
    )) {
      pushCandidate(
        candidates,
        toCandidate(email, "exa_search", SOURCE_WEIGHT.exa_search),
        first,
        last,
      );
    }
  }

  // ── 5) Blind {first}.{last}. Last because it is a guess with no evidence
  //       behind it — and under lazy verification, the suggestion of last
  //       resort that the send gate will prove or kill.
  if (domainAcceptsMail && domain && first && last) {
    pushCandidate(
      candidates,
      toCandidate(
        applyPattern("{first}.{last}", first, last, domain),
        "pattern_derived",
        0.2,
      ),
      first,
      last,
    );
  }

  if (candidates.length === 0) {
    return {
      email: null,
      reason: "Could not find an email address.",
      personId,
    };
  }

  // ── Verification is OPT-IN. Discovery's job is to produce a good suggestion
  //    for free; proof costs money, so it happens exactly once, at the moment
  //    it matters — just before a send (see services/send-verification) or on
  //    an explicit revalidate. This also means the daily send cap naturally
  //    throttles verification spend: credits can never outrun sending.
  if (!provider?.canVerify || !wantVerify) {
    const best = candidates[0];
    await writeEmailResult(supabase, personId, best, {
      confidence: best.discoveryConfidence,
      verification: "unchecked",
      verifiedBy: null,
    });
    return {
      email: best.email,
      source: best.source,
      confidence: best.discoveryConfidence,
      verification: "unchecked",
      personId,
    };
  }

  const rejected: string[] = [];
  let fallback: { candidate: EmailCandidate; result: VerifyResult } | null =
    null;

  for (const candidate of candidates.slice(0, MAX_VERIFICATIONS_PER_PERSON)) {
    const result = await provider.verifyEmail(candidate.email);

    // Catch-all is a property of ONE domain's MX config, so only a verdict
    // about the company's own domain may be cached against the company.
    // Previously any candidate's verdict was written to the org: a personal
    // gmail.com address scraped by Exa flagged the employer catch-all forever,
    // capping every future contact there at 0.5 and blocking them from
    // outreach, with nothing to ever clear it. The flag is also recorded when
    // false, so a negative result is cached too rather than re-probed per
    // contact.
    const candidateAtOrgDomain =
      !!domain && candidate.email.endsWith(`@${domain.toLowerCase()}`);

    if (
      orgIsCatchAll === null &&
      person.organization_id &&
      candidateAtOrgDomain &&
      // An `unknown` verdict is a failed or rate-limited call, and its
      // catchAll:false is a default, not an answer. Caching it would pin
      // "not catch-all" onto the org permanently off a provider outage.
      result.status !== "unknown"
    ) {
      orgIsCatchAll = result.catchAll;
      await supabase
        .from("organizations")
        .update({
          is_catch_all: result.catchAll,
          catch_all_checked_at: new Date().toISOString(),
        })
        .eq("id", person.organization_id);
    }

    if (result.status === "undeliverable") {
      rejected.push(candidate.email);
      continue;
    }

    // The org's cached flag only speaks for addresses at the org's domain; an
    // off-domain candidate is judged solely on its own verdict.
    const catchAll =
      result.catchAll || (candidateAtOrgDomain && orgIsCatchAll === true);

    if (result.status === "deliverable" && !catchAll) {
      await writeEmailResult(supabase, personId, candidate, {
        confidence: VERIFIED_CONFIDENCE,
        verification: "deliverable",
        verifiedBy: provider.id,
      });
      await recordNegatives(supabase, personId, rejected);
      // A confirmed address is also pattern evidence for everyone else at the
      // org — this is what finally bootstraps the pattern flywheel, which
      // cannot start from guesses alone.
      if (person.organization_id) {
        await recomputeOrgPattern(supabase, person.organization_id);

        // …and it is proof of employment. Someone who answers mail at acme.com
        // works at Acme, which makes this the strongest machine signal we have
        // for affiliation. Only when the address is actually at the employer's
        // own domain, and only off a catch-all domain — this branch has already
        // excluded catch-alls, which accept anything and prove nothing.
        if (domain && candidate.email.endsWith(`@${domain.toLowerCase()}`)) {
          await recordAffiliation(supabase, {
            personId,
            organizationId: person.organization_id,
            source: "email_domain",
            evidence: `${candidate.email} verified deliverable at ${domain}`,
          });
        }
      }
      return {
        email: candidate.email,
        source: candidate.source,
        confidence: VERIFIED_CONFIDENCE,
        verification: "deliverable",
        personId,
      };
    }

    // Deliverable-but-catch-all, risky, or unknown. Keep the first one as a
    // fallback and carry on looking for something provable.
    if (!fallback) fallback = { candidate, result };
  }

  await recordNegatives(supabase, personId, rejected);

  if (!fallback) {
    // If the address we already held is among the rejected, do not leave it
    // sitting in the row looking usable. Revalidating an address specifically
    // to learn it is dead, and then keeping it, means the UI still shows it and
    // every later revalidate pays to be told the same thing again.
    if (
      person.work_email &&
      rejected.includes(person.work_email.toLowerCase())
    ) {
      await supabase
        .from("people")
        .update({
          work_email_verification: "undeliverable",
          work_email_confidence: 0,
          work_email_verified_at: null,
        })
        .eq("id", personId);
    }

    return {
      email: null,
      reason:
        rejected.length > 0
          ? `Found ${rejected.length} candidate address(es) but the verifier rejected every one.`
          : "Could not find an email address.",
      personId,
    };
  }

  // Nothing proved deliverable. Write the best unproven candidate, capped well
  // below the verified threshold so the UI and the send gate both treat it as
  // what it is.
  // Scoped exactly like the deliverable path above: the org's cached flag only
  // speaks for addresses at the org's own domain. Leaving this unscoped meant a
  // personal address at a different domain inherited the employer's catch-all
  // verdict and was capped at 0.5 — which the send gate then refuses.
  const fallbackAtOrgDomain =
    !!domain && fallback.candidate.email.endsWith(`@${domain.toLowerCase()}`);
  const catchAll =
    fallback.result.catchAll || (fallbackAtOrgDomain && orgIsCatchAll === true);
  const verification: EmailVerification = catchAll
    ? "risky"
    : fallback.result.status;
  const confidence = Math.min(
    fallback.candidate.discoveryConfidence,
    catchAll ? CATCH_ALL_CONFIDENCE_CAP : UNRESOLVED_CONFIDENCE_CAP,
  );

  await writeEmailResult(supabase, personId, fallback.candidate, {
    confidence,
    verification,
    verifiedBy: provider.id,
  });

  return {
    email: fallback.candidate.email,
    source: fallback.candidate.source,
    confidence,
    verification,
    personId,
  };
}

/** Null-safe candidate constructor — applyPattern returns null when unfillable. */
function toCandidate(
  email: string | null,
  source: EmailCandidate["source"],
  discoveryConfidence: number,
): EmailCandidate | null {
  return email ? { email, source, discoveryConfidence } : null;
}

/** Persists a settled address plus everything we know about how sure we are. */
async function writeEmailResult(
  supabase: Awaited<ReturnType<typeof createClient>>,
  personId: string,
  candidate: EmailCandidate,
  meta: {
    confidence: number;
    verification: EmailVerification | "unchecked";
    verifiedBy: string | null;
  },
): Promise<void> {
  await supabase
    .from("people")
    .update({
      work_email: candidate.email,
      work_email_source: candidate.source,
      work_email_confidence: meta.confidence,
      work_email_verification: meta.verification,
      work_email_verified_by: meta.verifiedBy,
      work_email_verified_at: hasPositiveEvidence(
        candidate.source,
        meta.verification,
      )
        ? new Date().toISOString()
        : null,
    })
    .eq("id", personId);
}

/**
 * Whether we hold independent evidence that this address is real — the question
 * `work_email_verified_at` actually answers, and what recomputeOrgPattern reads
 * to decide which addresses may inform an org's pattern.
 *
 * Two ways to earn it: a verifier confirmed the mailbox, or the address was
 * observed somewhere real (a team page, a search result, a provider lookup)
 * rather than constructed by us. `pattern_derived` is the one source that is
 * pure inference, so it never qualifies on its own — otherwise a guess would
 * become evidence for the very pattern that produced it, and the pattern would
 * confirm itself out of nothing.
 */
function hasPositiveEvidence(
  source: EmailCandidate["source"],
  verification: EmailVerification | "unchecked",
): boolean {
  if (verification === "deliverable") return true;
  return source !== "pattern_derived";
}

/**
 * Remembers addresses a verifier rejected, so a re-run doesn't pay to be told
 * the same thing twice. Written straight to enrichment_data rather than via
 * mergeEnrichmentData because that helper also flips enrichment_status to
 * "enriched", which a failed email lookup has not earned.
 *
 * Reads the row fresh rather than accepting a snapshot: the caller's copy of
 * enrichment_data predates the Exa search and up to three provider
 * verifications, a multi-second window, and spreading a stale base silently
 * clobbered anything a concurrent enrichment run merged in the meantime.
 */
async function recordNegatives(
  supabase: Awaited<ReturnType<typeof createClient>>,
  personId: string,
  rejected: string[],
): Promise<void> {
  if (rejected.length === 0) return;
  const { data: fresh, error: readError } = await supabase
    .from("people")
    .select("enrichment_data")
    .eq("id", personId)
    .single();
  if (readError) {
    // Best-effort cache: losing it costs a repeat verification later, while
    // writing over an unreadable row could cost real enrichment data.
    console.error(
      `[findEmail] could not read enrichment before recording negatives for ${personId}: ${readError.message}`,
    );
    return;
  }
  const base = (fresh?.enrichment_data as Record<string, unknown>) ?? {};
  const priorRaw = base.rejectedEmails;
  const prior = Array.isArray(priorRaw) ? (priorRaw as string[]) : [];
  const { error: writeError } = await supabase
    .from("people")
    .update({
      enrichment_data: {
        ...base,
        rejectedEmails: [...new Set([...prior, ...rejected])],
      },
    })
    .eq("id", personId);
  if (writeError) {
    console.error(
      `[findEmail] could not record rejected addresses for ${personId}: ${writeError.message}`,
    );
  }
}

/** Scrapes candidate addresses for a person out of Exa result text. */
async function searchEmailsViaExa(
  name: string,
  domain: string | null,
  first: string | null,
  last: string | null,
  personId: string,
  bypassCache = false,
): Promise<string[]> {
  const searchQuery = domain
    ? `"${name}" "${domain}" email`
    : `"${name}" email contact`;
  const onDomain: string[] = [];
  const offDomain: string[] = [];

  try {
    const exa = new ExaService();
    const results = await exa.search(searchQuery, {
      numResults: 5,
      includeText: true,
      bypassCache,
    });

    for (const result of results.results) {
      if (!result.text) continue;
      for (const match of result.text.match(EMAIL_REGEX) ?? []) {
        const lower = match.toLowerCase();
        const candidateDomain = lower.slice(lower.lastIndexOf("@") + 1);
        if (candidateDomain === "example.com") continue;
        if (isRolePrefix(lower.split("@")[0])) continue;
        if (!emailMatchesName(lower, first, last)) continue;
        if (domain && lower.endsWith(`@${domain}`)) onDomain.push(lower);
        else offDomain.push(lower);
      }
    }

    trackUsage({
      service: "exa",
      operation: "find-email",
      estimated_cost_usd: 0.007,
      metadata: { personId, query: searchQuery },
    });
  } catch {
    // Exa unavailable — the other strategies still have their say.
  }

  // Company-domain hits first: an address at the employer's own domain is
  // better evidence than a personal one found on the same page.
  return [...onDomain, ...offDomain];
}

/**
 * Infers an email pattern from the org's already-verified emails, right now,
 * rather than trusting the cached column.
 */
async function inferPatternFromOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
): Promise<{ pattern: string | null; confidence: number } | null> {
  const { data: orgPeople } = await supabase
    .from("people")
    .select("name, work_email, work_email_source, work_email_verified_at")
    .eq("organization_id", organizationId)
    .not("work_email", "is", null)
    .not("work_email_verified_at", "is", null);

  const evidence: VerifiedEmail[] = [];
  for (const p of orgPeople ?? []) {
    if (!p.work_email || !p.work_email_source) continue;
    if (p.work_email_source === "pattern_derived") continue;
    const split = splitName(p.name);
    if (!split.first || !split.last) continue;
    evidence.push({
      email: p.work_email,
      firstName: split.first,
      lastName: split.last,
      source: p.work_email_source,
    });
  }

  if (evidence.length === 0) return null;
  const inferred = inferPattern(evidence);
  return inferred.pattern
    ? { pattern: inferred.pattern, confidence: inferred.confidence }
    : null;
}

// ── findEmail ──────────────────────────────────────────────────────────────

export const findEmail = tool({
  description:
    "Find a contact's email address for free (pattern, web search, team pages) and store it as a suggestion; verification happens automatically when a send is attempted, so this never spends provider credits on its own. Returns the stored address if there is one. Pass revalidate: true only to force a paid re-verification now, e.g. after a send was refused because the address was proven dead.",
  inputSchema: z.object({
    personId: z.string().uuid().describe("Person ID to find email for."),
    revalidate: z
      .boolean()
      .optional()
      .describe(
        "Re-verify an address that is already stored but unverified. Use when the send gate reports the email has never been verified.",
      ),
  }),
  execute: async ({ personId, revalidate }) => {
    // /api/find-email wraps this exact function behind an ownership check;
    // reached as a tool it had none, so saying a uuid to the agent returned
    // the stored address for it and, on revalidate, wrote back to the row.
    // Same test as the route, so the two entry points cannot drift.
    const session = await toolSession();
    if (!session) {
      return {
        email: null,
        reason:
          "No authenticated session available in tool context. Ask the user to sign in.",
        personId,
      };
    }
    if (
      !(await callerHoldsPerson(session.supabase, session.userId, personId))
    ) {
      // Worded as absence rather than refusal: distinguishing the two would
      // confirm which guessed uuids are real contacts.
      return { email: null, reason: "Person not found.", personId };
    }
    return findEmailForPerson(personId, { revalidate });
  },
});

// ── findEmails (batch) ─────────────────────────────────────────────────────

export const findEmails = tool({
  description:
    "Batch-discover email addresses for multiple contacts. Returns found, not-found and skipped lists. Contacts with a stored address are returned in found with their existing source, not newly discovered. Contacts not confirmed to work at their company are skipped. Discovery is free: it stores unverified suggestions, and verification is paid for just-in-time when a draft is actually sent.",
  inputSchema: z.object({
    personIds: z
      .array(z.string().uuid())
      .max(25)
      .describe(
        "Array of person IDs (max 25 per call). Call again for the next batch.",
      ),
  }),
  execute: async ({ personIds }) => {
    // Same exposure as findEmail, once per id in the array.
    const session = await toolSession();
    if (!session) {
      return {
        found: [],
        notFound: [],
        skipped: personIds,
        summary:
          "No authenticated session available in tool context. Ask the user to sign in.",
      };
    }
    const { supabase, userId } = session;

    const { data: rows, error: rowsError } = await supabase
      .from("people")
      .select("id, affiliation_confidence")
      .in("id", personIds);

    // On a failed query the confidence map is empty, so every contact would
    // fall below the send threshold and land in `skipped` under a fabricated
    // "not confirmed to work at this company" explanation, which the agent
    // then relays to the user as a confident data-quality verdict.
    if (rowsError) {
      console.error(
        `[findEmails] affiliation lookup failed: ${rowsError.message}`,
      );
      return {
        found: [],
        notFound: [],
        skipped: [],
        summary: `Could not check which contacts are confirmed at their company (${rowsError.message}). No lookups were run: retry the call.`,
      };
    }

    const confidence = new Map<string, number | null>(
      (
        (rows ?? []) as Array<{
          id: string;
          affiliation_confidence: number | null;
        }>
      ).map((r) => [r.id, r.affiliation_confidence]),
    );

    // `source` says where each address came from: "existing"/stored sources
    // mean the contact already had it, so "Found N of M" is not N discoveries.
    const found: Array<{ personId: string; email: string; source?: string }> =
      [];
    const notFound: string[] = [];
    const skipped: string[] = [];

    for (const personId of personIds) {
      // A firstname@company.com address reads to the user as proof of
      // employment, so guessing one for a contact we cannot place at the
      // company manufactures that proof. They are blocked from outreach
      // anyway, so the address could not be used even if it were right. A
      // missing row or a null confidence reads as unconfirmed, which is the
      // safe way round. findEmail applies no confidence rule of its own:
      // that is an explicit request for one named person.
      if ((confidence.get(personId) ?? 0) < AFFILIATION_SEND_THRESHOLD) {
        skipped.push(personId);
        continue;
      }
      // Skipped rather than reported as not-found, for the same reason the
      // single tool words its refusal as absence: which uuids are real
      // contacts is exactly what a caller guessing them wants told.
      if (!(await callerHoldsPerson(supabase, userId, personId))) {
        skipped.push(personId);
        continue;
      }
      try {
        const result = await findEmailForPerson(personId);
        if (result.email) {
          found.push({ personId, email: result.email, source: result.source });
        } else {
          notFound.push(personId);
        }
      } catch {
        notFound.push(personId);
      }
    }

    // Named in the summary so the agent can explain the gap rather than
    // reporting a batch that quietly found nothing.
    const skippedNote = skipped.length
      ? ` ${skipped.length} skipped: not confirmed to work at this company, so a company-domain guess would be misleading.`
      : "";

    return {
      found,
      notFound,
      skipped,
      summary: `Found emails for ${found.length} of ${personIds.length} contacts. ${notFound.length} not found.${skippedNote}`,
    };
  },
});

// ── writeEmail ─────────────────────────────────────────────────────────────

export const writeEmail = tool({
  description:
    "Compose an email draft and save it to the database. This does NOT send the email -- the draft starts pending and the user must approve it in the outreach review queue (/outreach/review) before sendEmail can send it.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID."),
    personId: z.string().uuid().describe("Person ID (from campaign contacts)."),
    subject: z.string().describe("Email subject line."),
    bodyHtml: z.string().describe("Email body as HTML."),
    bodyText: z
      .string()
      .optional()
      .describe("Plain text version of the email body."),
    sequenceId: z
      .string()
      .uuid()
      .optional()
      .describe("Sequence ID if this draft is part of a sequence."),
    sequenceStepId: z
      .string()
      .uuid()
      .optional()
      .describe("Sequence step ID for this draft."),
    enrollmentId: z
      .string()
      .uuid()
      .optional()
      .describe("Sequence enrollment ID for the contact."),
    aiReasoning: z
      .string()
      .optional()
      .describe("Explanation of why the email was written this way."),
  }),
  execute: async (input) => {
    const ctx = await getSupabaseAndUser();
    if (!ctx) {
      return {
        error:
          "No authenticated session available in tool context. Ask the user to sign in.",
      };
    }
    const { supabase, user } = ctx;

    const { data: campaignRow } = await supabase
      .from("campaigns")
      .select("user_id")
      .eq("id", input.campaignId)
      .single();
    const userId: string = campaignRow?.user_id ?? user.id;

    const result = await saveDraft(supabase, { ...input, userId });

    if (!result.ok) {
      return { error: result.error };
    }

    return {
      draftId: result.draftId,
      to: result.to,
      subject: result.subject,
      status: "draft",
      message:
        "Draft saved as pending. Show it to the user and point them to /outreach/review to approve it -- sendEmail will refuse the draft until it is approved there.",
    };
  },
});

// ── sendEmail ──────────────────────────────────────────────────────────────

export const sendEmail = tool({
  description:
    "Send a previously written email draft via the user's connected Gmail. Only approved drafts can be sent: ALL drafts (including ad-hoc writeEmail drafts) start pending and must be approved by the user in the outreach review queue first. Rejected drafts can never be sent.",
  inputSchema: z.object({
    draftId: z.string().uuid().describe("Draft ID to send."),
  }),
  execute: async ({ draftId }) => {
    const supabase = await createClient();

    const { data: draft, error: draftErr } = await supabase
      .from("email_drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (draftErr || !draft) {
      return { error: "Draft not found." };
    }

    if (draft.status !== "draft") {
      return {
        error: `This draft has already been ${draft.status}. Cannot send again.`,
      };
    }

    // Hard gate, not advisory: the review decision lives in the DB, and this
    // tool's inputs can be influenced by scraped web content. The tool
    // description alone must never be what stands between a rejected draft
    // and a prospect's inbox.
    if (draft.review_status === "rejected") {
      return {
        error:
          "This draft was rejected in review and cannot be sent. Write a new draft if the user wants to contact this person.",
      };
    }
    if (draft.review_status !== "approved") {
      return {
        error:
          "This draft is awaiting review. The user must approve it in the outreach review queue before it can be sent.",
      };
    }

    // Drafts exist for every step of a sequence from enrollment onwards, so
    // "approved and unsent" does not mean "due". Sending step 3 now would
    // deliver the breakup email before the follow-up it refers to.
    const stepCheck = await draftIsCurrentStep(supabase, draft);
    if (!stepCheck.current) {
      return { error: stepCheck.reason };
    }

    // The credential read has to go through the admin client.
    //
    // gmail_app_password_enc is not selectable by the `authenticated` role --
    // only server code needs the ciphertext, so the browser's grant was
    // removed rather than left to RLS. Handing resolveSenderConfig this
    // request's RLS-scoped client makes PostgREST refuse the whole select with
    // "permission denied for table user_settings", which reads here as an
    // unconfigured mailbox: every agent-initiated send would refuse with
    // "Email is not configured" while the cron path kept working.
    const sender = await resolveSenderConfig(getAdminClient(), draft.user_id);
    if ("error" in sender) {
      return { error: sender.error };
    }

    const result = await sendDraftAndAdvance(
      supabase,
      draft as DraftForSend & { enrollment_id?: string | null },
      sender,
      undefined,
      // The user just confirmed this send in chat — an explicit human "send"
      // beats the schedule preference, so the send window is bypassed.
      { bypassSendWindow: true },
    );

    if (!result.ok) {
      return { error: `Failed to send email: ${result.reason}` };
    }

    return {
      emailId: result.messageId,
      to: draft.to_email,
      subject: draft.subject,
      status: "sent",
    };
  },
});

// ── listDrafts ─────────────────────────────────────────────────────────────

export const listDrafts = tool({
  description: "List unsent email drafts, optionally filtered by campaign.",
  inputSchema: z.object({
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Filter drafts by campaign ID."),
  }),
  execute: async ({ campaignId }) => {
    const supabase = await createClient();

    let query = supabase
      .from("email_drafts")
      .select(
        "id, campaign_id, person_id, to_email, subject, status, created_at",
      )
      .eq("status", "draft")
      .order("created_at", { ascending: false });

    if (campaignId) {
      query = query.eq("campaign_id", campaignId);
    }

    const { data, error } = await query;
    if (error) return { error: error.message };

    return { drafts: data ?? [], count: data?.length ?? 0 };
  },
});

// ── discardDraft ───────────────────────────────────────────────────────────

export const discardDraft = tool({
  description: "Discard an email draft so it won't be sent.",
  inputSchema: z.object({
    draftId: z.string().uuid().describe("Draft ID to discard."),
  }),
  execute: async ({ draftId }) => {
    const supabase = await createClient();

    // Enrollment context read BEFORE the discard, while the row still
    // matters: discarding a sequence draft used to leave its enrollment
    // active on a step with no draft, so the followups cron failed "No
    // approved draft ready for this step" every 15 minutes forever and the
    // rest of the sequence silently never sent.
    const { data: draft } = await supabase
      .from("email_drafts")
      .select("id, enrollment_id, sequence_step_id")
      .eq("id", draftId)
      .maybeSingle();

    // .select() distinguishes "discarded" from "matched nothing": the update
    // filters on status='draft', so a draft the cron claimed seconds earlier
    // (or a wrong/foreign id RLS filters out) matched 0 rows with no error,
    // and the tool told the user the email would not send while it sent.
    const { data: discarded, error } = await supabase
      .from("email_drafts")
      .update({
        status: "discarded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId)
      .eq("status", "draft")
      .select("id");

    if (error) return { error: error.message };
    if (!discarded || discarded.length === 0) {
      return {
        error: `Draft ${draftId} was not discarded: it is not an unsent draft (it may already be queued or sent, or the ID is wrong). Check its status with listDrafts before telling the user it will not send.`,
      };
    }

    if (draft?.enrollment_id) {
      const stepCheck = await draftIsCurrentStep(supabase, draft);
      if (stepCheck.current) {
        const { error: completeErr } = await supabase
          .from("sequence_enrollments")
          .update({
            status: "completed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", draft.enrollment_id);
        if (completeErr) {
          return {
            draftId,
            status: "discarded",
            warning: `This was the enrollment's current step and the enrollment could not be completed (${completeErr.message}). Until it is, the sequence will retry an empty step forever: tell the user, and either regenerate a draft for this step or complete the enrollment.`,
          };
        }
        return {
          draftId,
          status: "discarded",
          enrollmentStatus: "completed",
          note: "This was the enrollment's current step, so the enrollment is now completed and its remaining steps will not send. Re-enroll the contact or create a new sequence if outreach should continue.",
        };
      }
    }

    return { draftId, status: "discarded" };
  },
});

// ── sendBulkEmails ─────────────────────────────────────────────────────────

export const sendBulkEmails = tool({
  description:
    "Send multiple email drafts at once. Only APPROVED drafts are sent; drafts awaiting review or rejected in the review queue are excluded and reported back. If no draftIds provided, sends all approved unsent drafts for the campaign. Only call after user confirms sending.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID."),
    draftIds: z
      .array(z.string().uuid())
      .optional()
      .describe(
        "Specific draft IDs to send. If omitted, sends all approved drafts for the campaign.",
      ),
  }),
  execute: async ({ campaignId, draftIds }) => {
    const supabase = await createClient();

    // One query for scope AND payload (K24: this used to fetch ids, then
    // re-query full rows for the same ids). Full rows either way, so
    // unapproved drafts are still reported, never silently dropped.
    let scopeQuery = supabase
      .from("email_drafts")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("status", "draft");
    if (draftIds && draftIds.length > 0) {
      scopeQuery = scopeQuery.in("id", draftIds);
    }
    const { data: inScope, error: scopeError } = await scopeQuery;
    if (scopeError) return { error: scopeError.message };

    // Passed ids from another campaign (listDrafts spans campaigns when
    // called without a filter) vanish from the campaign-scoped query: they
    // used to appear in no results bucket while the summary accounted for
    // "every" draft, so the agent reported everything handled while those
    // drafts sat unsent.
    const foundIds = new Set((inScope ?? []).map((d) => d.id as string));
    const notInCampaign = (draftIds ?? []).filter((id) => !foundIds.has(id));
    const notInCampaignNote =
      notInCampaign.length > 0
        ? ` ${notInCampaign.length} passed draft ID(s) are not unsent drafts in this campaign and were NOT sent: ${notInCampaign.join(", ")}. Check their campaign with listDrafts.`
        : "";

    if (!inScope || inScope.length === 0) {
      return { error: `No drafts found to send.${notInCampaignNote}` };
    }

    const awaitingReview = inScope.filter(
      (d) => d.review_status !== "approved" && d.review_status !== "rejected",
    ).length;
    const rejected = inScope.filter(
      (d) => d.review_status === "rejected",
    ).length;
    const drafts = inScope.filter((d) => d.review_status === "approved");

    if (drafts.length === 0) {
      return {
        error: `None of the ${inScope.length} drafts are approved (${awaitingReview} awaiting review, ${rejected} rejected). The user must approve them in the outreach review queue first.${notInCampaignNote}`,
      };
    }

    const results: Array<{ draftId: string; status: string; error?: string }> =
      [];

    // Sequential on purpose: keeps Gmail SMTP happy, and each send claims its
    // draft atomically so a concurrent cron can't double-send any of them.
    for (const draft of drafts ?? []) {
      // Later steps of a sequence are approved long before they are due.
      const stepCheck = await draftIsCurrentStep(supabase, draft);
      if (!stepCheck.current) {
        results.push({
          draftId: draft.id,
          status: "scheduled",
          error: stepCheck.reason,
        });
        continue;
      }

      // Re-resolved per draft rather than once up front: the pause switch has
      // to bite mid-batch, which is exactly when someone reaches for it.
      // Admin client for the same reason as sendEmail above.
      const sender = await resolveSenderConfig(getAdminClient(), draft.user_id);
      if ("error" in sender) {
        results.push({
          draftId: draft.id,
          status: "failed",
          error: sender.error,
        });
        continue;
      }

      const result = await sendDraftAndAdvance(
        supabase,
        draft as DraftForSend & { enrollment_id?: string | null },
        sender,
        undefined,
        // The user just confirmed this bulk send in chat — bypass the window.
        { bypassSendWindow: true },
      );
      if (result.ok) {
        results.push({ draftId: draft.id, status: "sent" });
      } else if (result.reason.includes("claimed")) {
        results.push({
          draftId: draft.id,
          status: "skipped",
          error: result.reason,
        });
      } else {
        results.push({
          draftId: draft.id,
          status: "failed",
          error: result.reason,
        });
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const scheduled = results.filter((r) => r.status === "scheduled").length;
    const skippedHeld = awaitingReview + rejected;

    return {
      sent,
      failed,
      scheduled,
      awaitingReview,
      rejected,
      total: inScope.length,
      ...(notInCampaign.length > 0 ? { notInCampaign } : {}),
      results,
      summary:
        `Sent ${sent} of ${drafts.length} approved drafts.` +
        (failed > 0 ? ` ${failed} failed.` : "") +
        (scheduled > 0
          ? ` ${scheduled} belong to a later step of their sequence and will send when that step comes due.`
          : "") +
        (skippedHeld > 0
          ? ` ${awaitingReview} held for review and ${rejected} rejected, not sent.`
          : "") +
        notInCampaignNote,
    };
  },
});
