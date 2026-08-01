import { resolveMx } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────

export type EmailSource =
  | "user_entered"
  | "send_confirmed"
  | "team_page"
  | "exa_search"
  | "provider_found"
  | "csv_import"
  | "pattern_derived";

export interface VerifiedEmail {
  email: string;
  firstName: string;
  lastName: string;
  source: EmailSource;
}

// ─── Constants ────────────────────────────────────────────────────────────

export const SOURCE_WEIGHT: Record<EmailSource, number> = {
  user_entered: 1.0,
  send_confirmed: 0.95,
  // A dedicated email provider returned this address for this person at this
  // domain. Ranked above a team-page scrape because it is an answer to the
  // question we asked, not a string that happened to sit near the name on a
  // page — and well above exa_search for the same reason.
  provider_found: 0.75,
  team_page: 0.7,
  // An address the user's uploaded target list carried. Better than a string
  // Exa found near a name, but below team_page and provider_found: uploads
  // are often AI-generated or stale exports, so an import must never displace
  // an address one of those sources established — in particular one a
  // verifier has since confirmed deliverable (recordVerifiedEmail refuses a
  // different-address write from a weaker source). Not in the JIT skip list
  // either, so the send gate still proves the mailbox before anything leaves.
  csv_import: 0.5,
  exa_search: 0.3,
  // A guess, by construction. Zero weight keeps derived addresses out of the
  // evidence that infers the pattern they came from.
  pattern_derived: 0,
};

export const KNOWN_PATTERNS = [
  "{first}.{last}",
  "{first}{last}",
  "{f}{last}",
  "{first}_{last}",
  "{first}-{last}",
  "{f}.{last}",
  "{first}.{l}",
  "{first}",
  "{last}",
] as const;

export type EmailPattern = (typeof KNOWN_PATTERNS)[number];

export const ROLE_PREFIXES = [
  "it",
  "info",
  "support",
  "hello",
  "contact",
  "admin",
  "team",
  "sales",
  "marketing",
  "hr",
  "legal",
  "office",
  "mail",
  "webmaster",
  "postmaster",
  "abuse",
  "billing",
  "accounts",
  "noreply",
  "no-reply",
  "donotreply",
  "press",
  "media",
  "careers",
  "jobs",
  "founders",
  "general",
  "inquiries",
  "feedback",
  "help",
  "service",
] as const;

const ROLE_SET: ReadonlySet<string> = new Set(ROLE_PREFIXES);

// ─── Pure helpers ─────────────────────────────────────────────────────────

function localPart(email: string): string {
  return email.split("@")[0]?.toLowerCase() ?? "";
}

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function alnum(s: string): string {
  // Fold accents to their base letter before stripping. Going straight to
  // `[^a-z0-9]` deleted them outright, so "Clémentine" guessed as "clmentine"
  // and "Ramírez" as "ramrez" — a wrong address for every name with a
  // diacritic, which is a lot of them in European markets.
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Split a person's name into first + last. Returns null parts if unknown. */
export function splitName(name: string): {
  first: string | null;
  last: string | null;
} {
  const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts[parts.length - 1] };
}

/**
 * `it`, `it.dept`, `support_team`, etc. → true. Personal addresses → false.
 * Role prefix may be followed by `.`, `-`, `_`, `+`, or end of local-part.
 */
export function isRolePrefix(local: string): boolean {
  const lower = local.toLowerCase();
  if (ROLE_SET.has(lower)) return true;
  for (const prefix of ROLE_PREFIXES) {
    if (
      lower.startsWith(prefix + ".") ||
      lower.startsWith(prefix + "-") ||
      lower.startsWith(prefix + "_") ||
      lower.startsWith(prefix + "+")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Does the email's local-part plausibly belong to this person? Used to reject
 * generic addresses being attached to specific contacts (e.g., `it@acme.com`
 * latching onto "Jane Doe").
 *
 * Accepts if the normalized local-part contains the first name, last name, or
 * any common combination of initials and names (≥2 chars per token).
 */
export function emailMatchesName(
  email: string,
  firstName: string | null,
  lastName: string | null,
): boolean {
  const local = alnum(localPart(email));
  if (!local) return false;

  const first = firstName ? alnum(firstName) : "";
  const last = lastName ? alnum(lastName) : "";
  const fInit = first.slice(0, 1);
  const lInit = last.slice(0, 1);

  const candidates: string[] = [];
  if (first.length >= 2) candidates.push(first);
  if (last.length >= 2) candidates.push(last);
  if (first && last) {
    candidates.push(first + last); // janedoe
    candidates.push(last + first); // doejane
  }
  if (fInit && last.length >= 2) candidates.push(fInit + last); // jdoe
  if (first.length >= 2 && lInit) candidates.push(first + lInit); // janed
  if (lInit && first.length >= 2) candidates.push(lInit + first); // djane

  return candidates.some((c) => c.length >= 2 && local.includes(c));
}

/** Build the local-part for a given pattern. Returns null if unfillable. */
function renderPattern(
  pattern: string,
  first: string | null,
  last: string | null,
): string | null {
  const f = first ? alnum(first) : "";
  const l = last ? alnum(last) : "";
  const needsFirst = pattern.includes("{first}") || pattern.includes("{f}");
  const needsLast = pattern.includes("{last}") || pattern.includes("{l}");
  if (needsFirst && !f) return null;
  if (needsLast && !l) return null;
  return pattern
    .replace("{first}", f)
    .replace("{last}", l)
    .replace("{f}", f.slice(0, 1))
    .replace("{l}", l.slice(0, 1));
}

/** Build the full email for a pattern + person + domain. */
export function applyPattern(
  pattern: string,
  firstName: string | null,
  lastName: string | null,
  domain: string,
): string | null {
  const local = renderPattern(pattern, firstName, lastName);
  if (!local) return null;
  return `${local}@${domain.toLowerCase()}`;
}

/**
 * Given a set of verified emails (with names), return the most likely email
 * pattern + a confidence in [0, 1] + how many emails support it. Ignores
 * role-prefix addresses.
 */
export function inferPattern(emails: VerifiedEmail[]): {
  pattern: EmailPattern | null;
  confidence: number;
  evidenceCount: number;
} {
  // Filter out role addresses; they don't reveal a personal pattern.
  const personal = emails.filter((e) => !isRolePrefix(localPart(e.email)));
  if (personal.length === 0) {
    return { pattern: null, confidence: 0, evidenceCount: 0 };
  }

  // Score each candidate pattern by summing source-weighted votes from
  // emails whose actual local-part equals what the pattern would produce.
  let bestPattern: EmailPattern | null = null;
  let bestScore = 0;
  let bestEvidence = 0;
  let totalScore = 0;

  for (const pattern of KNOWN_PATTERNS) {
    let score = 0;
    let count = 0;
    for (const email of personal) {
      const expectedLocal = renderPattern(
        pattern,
        email.firstName,
        email.lastName,
      );
      if (!expectedLocal) continue;
      const actualLocal = localPart(email.email);
      if (expectedLocal === actualLocal) {
        score += SOURCE_WEIGHT[email.source];
        count++;
      }
    }
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestPattern = pattern;
      bestEvidence = count;
    }
  }

  if (!bestPattern || bestScore === 0) {
    return { pattern: null, confidence: 0, evidenceCount: 0 };
  }

  // Confidence = winner share of all matched-pattern weight. Bounded to 1.
  const confidence = totalScore > 0 ? Math.min(1, bestScore / totalScore) : 0;
  return { pattern: bestPattern, confidence, evidenceCount: bestEvidence };
}

// ─── Network ──────────────────────────────────────────────────────────────

type MxResolver = (
  domain: string,
) => Promise<Array<{ exchange: string; priority: number }>>;

/**
 * True if the domain has at least one MX record. Free DNS-only check.
 * `resolver` is injectable so tests can substitute it without module mocking.
 */
export async function mxCheck(
  domain: string,
  resolver: MxResolver = resolveMx,
): Promise<boolean> {
  try {
    const records = await resolver(domain);
    return records.length > 0;
  } catch {
    return false;
  }
}

// ─── DB-side: pattern recompute + email recording ─────────────────────────

/**
 * Re-derive `organizations.email_pattern` from all verified, non-derived
 * emails on people in the org. Cheap; called whenever a verified email is
 * recorded.
 */
export async function recomputeOrgPattern(
  supabase: SupabaseClient,
  orgId: string,
): Promise<void> {
  const { data: people } = await supabase
    .from("people")
    .select(
      "name, work_email, work_email_source, work_email_verified_at, work_email_verification",
    )
    .eq("organization_id", orgId)
    .not("work_email", "is", null)
    .not("work_email_verified_at", "is", null);

  const candidates: VerifiedEmail[] = [];
  for (const p of people ?? []) {
    if (!p.work_email || !p.work_email_source) continue;
    // Guesses must not feed the pattern that produced them — that would let a
    // pattern confirm itself out of nothing. But a guess a verifier has since
    // confirmed as deliverable is no longer a guess; it is the strongest
    // evidence available. Excluding it unconditionally meant the flywheel threw
    // away the very address that had just proved the pattern right, since the
    // org-pattern and blind-guess strategies both write `pattern_derived`.
    if (
      p.work_email_source === "pattern_derived" &&
      p.work_email_verification !== "deliverable"
    ) {
      continue;
    }
    const { first, last } = splitName(p.name);
    if (!first || !last) continue; // need both for pattern matching

    // `pattern_derived` weighs 0 by design, so a verified guess would still
    // contribute nothing if we passed its stored source through. Score it by
    // what actually established it — a mailbox check — rather than by how it
    // was first guessed. `send_confirmed` is the existing source meaning
    // "a real mailbox accepted this", which is exactly what happened.
    const source: EmailSource =
      p.work_email_source === "pattern_derived"
        ? "send_confirmed"
        : p.work_email_source;

    candidates.push({
      email: p.work_email,
      firstName: first,
      lastName: last,
      source,
    });
  }

  const { pattern, confidence, evidenceCount } = inferPattern(candidates);

  await supabase
    .from("organizations")
    .update({
      email_pattern: pattern,
      email_pattern_confidence: confidence,
      email_pattern_evidence_count: evidenceCount,
      email_pattern_updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);
}

/**
 * Record that a person's work_email comes from a verified source.
 * Sets work_email + source + confidence + verified_at, then recomputes the
 * org's pattern. NOT for `pattern_derived` — those are written directly by
 * `findEmailForPerson` since their confidence depends on the org's pattern.
 *
 * Skips role-prefix addresses (don't pollute the org's pattern with a role
 * mailbox attached to a real person). Skips overwrites that would *downgrade*
 * the source weight — once `send_confirmed` is set, a later `team_page` rescrape
 * shouldn't replace it.
 */
export async function recordVerifiedEmail(
  supabase: SupabaseClient,
  args: {
    personId: string;
    email: string;
    source: Exclude<EmailSource, "pattern_derived">;
  },
): Promise<void> {
  const { personId, email, source } = args;
  const local = localPart(email);
  if (isRolePrefix(local)) {
    console.warn(
      `[recordVerifiedEmail] skipping role-prefix address for person ${personId}: ${email}`,
    );
    return;
  }

  const { data: person } = await supabase
    .from("people")
    .select(
      "organization_id, work_email, work_email_source, work_email_confidence",
    )
    .eq("id", personId)
    .maybeSingle();

  if (!person) return;

  const newEmail = email.toLowerCase();
  const sameEmail = person.work_email?.toLowerCase() === newEmail;
  const existingSource = person.work_email_source as EmailSource | null;
  const existingWeight = existingSource ? SOURCE_WEIGHT[existingSource] : -1;
  const incomingWeight = SOURCE_WEIGHT[source];

  // Two protections:
  //   1. Different email + weaker source → skip (don't replace a strong signal).
  //   2. Same email + weaker source → still refresh verified_at, but keep the
  //      stronger source (don't downgrade send_confirmed → team_page).
  let finalSource: EmailSource = source;
  if (sameEmail) {
    if (existingSource && existingWeight > incomingWeight) {
      finalSource = existingSource;
    }
  } else if (incomingWeight < existingWeight) {
    return;
  }

  await supabase
    .from("people")
    .update({
      work_email: newEmail,
      work_email_source: finalSource,
      work_email_confidence: SOURCE_WEIGHT[finalSource],
      work_email_verified_at: new Date().toISOString(),
      // A verification verdict describes ONE address. Writing a different
      // address while leaving the old verdict behind left rows claiming, say,
      // `risky` or `undeliverable` about a string that is no longer stored —
      // and since the send gate refuses on those, correcting a bad address by
      // hand became a permanent block instead of the fix. Same address: keep
      // the verdict, it still applies.
      ...(sameEmail
        ? {}
        : { work_email_verification: null, work_email_verified_by: null }),
    })
    .eq("id", personId);

  if (person.organization_id) {
    await recomputeOrgPattern(supabase, person.organization_id);
  }
}

/**
 * Record a bounce against a person's email. Clears verification and, if the
 * email was pattern-derived, lowers the org pattern's confidence (or clears
 * it entirely if bounces dominate).
 */
export async function recordBounce(
  supabase: SupabaseClient,
  args: { personId: string; email: string },
): Promise<void> {
  const { personId, email } = args;

  const { data: person } = await supabase
    .from("people")
    .select("id, name, work_email, work_email_source, organization_id")
    .eq("id", personId)
    .maybeSingle();

  if (!person) return;

  // Only act if the bounced email is the one we have on file.
  if (
    person.work_email &&
    person.work_email.toLowerCase() !== email.toLowerCase()
  ) {
    return;
  }

  // Mark the address undeliverable, not merely unverified.
  //
  // Clearing verified_at and confidence alone left work_email_verification and
  // work_email_source untouched — and canSendTo trusts `send_confirmed`, which
  // every sent address carries by definition. So a hard-bounced mailbox stayed
  // sendable and would be mailed again by the next campaign or signal fire.
  await supabase
    .from("people")
    .update({
      work_email_verified_at: null,
      work_email_confidence: 0,
      work_email_verification: "undeliverable",
    })
    .eq("id", personId);

  if (!person.organization_id) return;

  // Did this address come from the org's pattern?
  //
  // Asking `work_email_source === "pattern_derived"` alone could never be true
  // here: a bounce is always preceded by a send, and a successful send writes
  // `send_confirmed` (0.95), overwriting the original source. So the
  // pattern-degradation half of the feedback loop was unreachable and
  // email_pattern_bounce_count could never leave zero.
  //
  // The fix is not to drop the source check — an address observed on a team
  // page or returned by a provider bounces because that address is stale, which
  // says nothing about the pattern, even if it happens to look pattern-shaped.
  // Instead, also accept `send_confirmed` when the address is exactly what the
  // pattern would have generated, since that is precisely the state a
  // pattern-derived address ends up in after being sent to once.
  const source = person.work_email_source;
  if (source !== "pattern_derived" && source !== "send_confirmed") return;

  const { first, last } = splitName(person.name ?? "");
  const { data: patternOrg } = await supabase
    .from("organizations")
    .select("email_pattern, domain")
    .eq("id", person.organization_id)
    .maybeSingle();

  if (source === "send_confirmed") {
    const derived =
      patternOrg?.email_pattern && patternOrg.domain
        ? applyPattern(patternOrg.email_pattern, first, last, patternOrg.domain)
        : null;
    if (!derived || localPart(derived) !== localPart(email)) return;
  }

  // If a pattern exists but the cached evidence_count is stale (e.g. 0 because
  // recompute hasn't run yet), refresh it first so the bounce ratio is fair.
  // Without this, the very first bounce would compute 1/1 > 0.5 and clear a
  // perfectly-good pattern.
  let { data: org } = await supabase
    .from("organizations")
    .select(
      "email_pattern, email_pattern_confidence, email_pattern_evidence_count, email_pattern_bounce_count",
    )
    .eq("id", person.organization_id)
    .maybeSingle();

  if (!org) return;

  if (org.email_pattern && (org.email_pattern_evidence_count ?? 0) === 0) {
    await recomputeOrgPattern(supabase, person.organization_id);
    const refreshed = await supabase
      .from("organizations")
      .select(
        "email_pattern, email_pattern_confidence, email_pattern_evidence_count, email_pattern_bounce_count",
      )
      .eq("id", person.organization_id)
      .maybeSingle();
    if (refreshed.data) org = refreshed.data;
  }

  const newBounces = (org.email_pattern_bounce_count ?? 0) + 1;
  const evidence = org.email_pattern_evidence_count ?? 0;

  let pattern = org.email_pattern;
  let confidence = org.email_pattern_confidence ?? 0;

  if (evidence === 0) {
    // No supporting evidence even after recompute. Just bump the bounce count;
    // don't touch the pattern (recompute already wrote NULL if there's no
    // evidence, or kept the original if recompute hasn't been re-triggered).
  } else {
    const ratio = newBounces / evidence;
    if (ratio > 0.5) {
      pattern = null;
      confidence = 0;
    } else if (ratio > 0.3) {
      confidence = confidence / 2;
    }
  }

  await supabase
    .from("organizations")
    .update({
      email_pattern: pattern,
      email_pattern_confidence: confidence,
      email_pattern_bounce_count: newBounces,
      email_pattern_updated_at: new Date().toISOString(),
    })
    .eq("id", person.organization_id);
}

/**
 * Lookup the org's cached pattern + load its verified-email evidence count.
 * Used by findEmailForPerson to decide whether to derive vs. fall back to
 * Exa search.
 */
export async function getOrgPattern(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{
  pattern: string | null;
  confidence: number;
  evidenceCount: number;
} | null> {
  const { data } = await supabase
    .from("organizations")
    .select(
      "email_pattern, email_pattern_confidence, email_pattern_evidence_count",
    )
    .eq("id", orgId)
    .maybeSingle();
  if (!data) return null;
  return {
    pattern: data.email_pattern ?? null,
    confidence: data.email_pattern_confidence ?? 0,
    evidenceCount: data.email_pattern_evidence_count ?? 0,
  };
}

// Re-export for tests + integration callers
export { localPart, domainOf };
