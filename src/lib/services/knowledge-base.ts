import { getDomain } from "tldts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Organization, Person } from "@/lib/types/campaign";

/**
 * Strip diacritics/accents from a string for fuzzy name comparison.
 * e.g. "Žunič" → "Zunic", "Müller" → "Muller"
 */
function stripDiacritics(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalize a domain to its registrable apex for dedup. Strips protocol,
 * subdomains, www, paths, and lowercases. `docs.mintlify.com` → `mintlify.com`.
 * `allowPrivateDomains: true` enables PSL's private section, so platform-style
 * domains like `foo.github.io` and `user.vercel.app` are kept intact instead
 * of collapsing to `github.io` / `vercel.app`.
 */
export function normalizeDomain(raw: string): string {
  let cleaned = raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .toLowerCase();
  // Strip trailing slashes via a deterministic loop so CodeQL's polynomial-
  // regex check doesn't flag this on user-controlled input.
  let end = cleaned.length;
  while (end > 0 && cleaned.charCodeAt(end - 1) === 47) end -= 1;
  if (end !== cleaned.length) cleaned = cleaned.slice(0, end);
  return getDomain(cleaned, { allowPrivateDomains: true }) ?? cleaned;
}

/**
 * Normalize a LinkedIn URL for dedup: canonical host, no query, no trailing
 * slash.
 *
 * The host matters for two separate reasons, and getting it wrong broke both:
 *
 *  1. Dedup. This previously kept whatever host it was handed, so
 *     `linkedin.com/in/x` and `www.linkedin.com/in/x` normalized to different
 *     strings and slipped past the unique index on people.linkedin_url — one
 *     human, two rows, two different employers possible.
 *
 *  2. Fetching. linkedin.com redirects to www.linkedin.com, and the scrapers we
 *     use do not follow it: the apex form returns an empty body. Every URL
 *     stored before this fix is apex, so affiliation checks against a stored
 *     URL would have failed 100% of the time.
 */
export function normalizeLinkedInUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const host = /(^|\.)linkedin\.com$/i.test(url.hostname)
      ? "www.linkedin.com"
      : url.hostname;
    return `https://${host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

/**
 * Whether an organization is identified well enough to have people attached to
 * it.
 *
 * A domain is what makes a company a distinct thing. Without one we cannot tell
 * two same-named companies apart, cannot verify an email against the employer's
 * domain, and cannot check a LinkedIn profile against anything meaningful — so
 * attaching contacts to a domain-less org is how the wrong people end up
 * pooled under the right name.
 */
export function canHoldPeople(org: { domain?: string | null }): boolean {
  return Boolean(org.domain);
}

/**
 * Find an existing organization by domain, or create a new one. Returns the
 * organization record.
 *
 * Note there is deliberately no name-based merge — see the comment in the body.
 */
export async function findOrCreateOrganization(data: {
  name: string;
  domain?: string | null;
  url?: string | null;
  industry?: string | null;
  location?: string | null;
  description?: string | null;
  source?: string | null;
}): Promise<Organization> {
  const supabase = await createClient();
  const normalizedDomain = data.domain ? normalizeDomain(data.domain) : null;

  // Try dedup by domain first
  if (normalizedDomain) {
    const { data: existing } = await supabase
      .from("organizations")
      .select("*")
      .eq("domain", normalizedDomain)
      .maybeSingle();

    if (existing) {
      // Update base fields if we have new info
      const updates: Record<string, unknown> = {};
      if (data.industry && !existing.industry) updates.industry = data.industry;
      if (data.location && !existing.location) updates.location = data.location;
      if (data.description && !existing.description)
        updates.description = data.description;
      if (data.url && !existing.url) updates.url = data.url;

      if (Object.keys(updates).length > 0) {
        await supabase
          .from("organizations")
          .update(updates)
          .eq("id", existing.id);
      }

      return existing as Organization;
    }
  }

  // NO name-based merge fallback.
  //
  // This used to match an existing org by name whenever no domain was supplied,
  // which silently collapsed genuinely different companies that share a name
  // into one row — and with them, their people. Two "Acme"s in different
  // industries became one organization with one pooled contact list, and
  // nothing recorded that it had happened.
  //
  // A name is not an identity; a domain is. Without one we create a separate
  // row and leave `domain` null, which marks the org unresolved. Unresolved
  // orgs are excluded from people-attachment (see canHoldPeople) precisely so
  // that a duplicate is a harmless empty row rather than a contaminated one.

  // Create new
  const { data: created, error } = await supabase
    .from("organizations")
    .insert({
      name: data.name,
      domain: normalizedDomain,
      url:
        data.url || (normalizedDomain ? `https://${normalizedDomain}` : null),
      industry: data.industry || null,
      location: data.location || null,
      description: data.description || null,
      source: data.source || null,
    })
    .select("*")
    .single();

  if (error) {
    // Handle race condition: another request may have inserted the same domain
    if (error.code === "23505" && normalizedDomain) {
      const { data: existing } = await supabase
        .from("organizations")
        .select("*")
        .eq("domain", normalizedDomain)
        .single();
      if (existing) return existing as Organization;
    }
    throw new Error(`Failed to create organization: ${error.message}`);
  }

  return created as Organization;
}

/**
 * Find an existing person by LinkedIn URL (primary) or name+org (fallback),
 * or create a new one. Returns the person record.
 */
export async function findOrCreatePerson(
  data: {
    name: string;
    linkedin_url?: string | null;
    work_email?: string | null;
    personal_email?: string | null;
    twitter_url?: string | null;
    title?: string | null;
    organization_id?: string | null;
    source?: string | null;
  },
  client?: SupabaseClient,
): Promise<Person> {
  // Callers running outside a Clerk session (e.g. QStash processors) must
  // pass their own client; defaults to the RLS request client otherwise.
  const supabase = client ?? (await createClient());
  const normalizedLinkedin = data.linkedin_url
    ? normalizeLinkedInUrl(data.linkedin_url)
    : null;

  // Try dedup by LinkedIn URL first
  if (normalizedLinkedin) {
    const { data: existing } = await supabase
      .from("people")
      .select("*")
      .eq("linkedin_url", normalizedLinkedin)
      .maybeSingle();

    if (existing) {
      // Update fields if we have newer info
      const updates: Record<string, unknown> = {};
      if (data.title && !existing.title) updates.title = data.title;
      if (data.work_email && !existing.work_email)
        updates.work_email = data.work_email;
      if (data.personal_email && !existing.personal_email)
        updates.personal_email = data.personal_email;
      if (data.twitter_url && !existing.twitter_url)
        updates.twitter_url = data.twitter_url;

      // Deliberately does NOT set organization_id on an existing person.
      //
      // Employer is provenance-tracked and recordAffiliation owns it, applying
      // a monotonic never-downgrade rule. Writing the column here bypassed that
      // rule while leaving affiliation_source/confidence describing the OLD
      // employer — so a person detached from Acme (which keeps
      // affiliation_confidence 0.95 and evidence naming Acme) could be silently
      // re-attached to Beta by a passing search, and would then sail through
      // the send gate on Acme's confidence. Callers that mean to set an
      // employer must call recordAffiliation and say why.

      if (Object.keys(updates).length > 0) {
        await supabase.from("people").update(updates).eq("id", existing.id);
      }

      return existing as Person;
    }
  }

  // Fallback: match by name + organization (diacritics-insensitive)
  if (data.organization_id) {
    const { data: orgPeople } = await supabase
      .from("people")
      .select("*")
      .eq("organization_id", data.organization_id);

    if (orgPeople && orgPeople.length > 0) {
      const incomingNorm = stripDiacritics(data.name).toLowerCase();
      const match = orgPeople.find(
        (p) => stripDiacritics(p.name).toLowerCase() === incomingNorm,
      );
      if (match) {
        // Merge in any new data (linkedin URL, email, etc.)
        const updates: Record<string, unknown> = {};
        if (normalizedLinkedin && !match.linkedin_url)
          updates.linkedin_url = normalizedLinkedin;
        if (data.title && !match.title) updates.title = data.title;
        if (data.work_email && !match.work_email)
          updates.work_email = data.work_email;
        if (data.personal_email && !match.personal_email)
          updates.personal_email = data.personal_email;
        if (data.twitter_url && !match.twitter_url)
          updates.twitter_url = data.twitter_url;

        if (Object.keys(updates).length > 0) {
          await supabase.from("people").update(updates).eq("id", match.id);
        }

        return match as Person;
      }
    }
  }

  // Create new
  const { data: created, error } = await supabase
    .from("people")
    .insert({
      name: data.name,
      linkedin_url: normalizedLinkedin,
      work_email: data.work_email || null,
      personal_email: data.personal_email || null,
      twitter_url: data.twitter_url || null,
      title: data.title || null,
      organization_id: data.organization_id || null,
      source: data.source || null,
    })
    .select("*")
    .single();

  if (error) {
    // Handle race condition on linkedin_url unique constraint
    if (error.code === "23505" && normalizedLinkedin) {
      const { data: existing } = await supabase
        .from("people")
        .select("*")
        .eq("linkedin_url", normalizedLinkedin)
        .single();
      if (existing) return existing as Person;
    }
    throw new Error(`Failed to create person: ${error.message}`);
  }

  return created as Person;
}

/**
 * Link an organization to a campaign. Upserts into campaign_organizations.
 */
export async function linkOrganizationToCampaign(
  organizationId: string,
  campaignId: string,
): Promise<{ id: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("campaign_organizations")
    .upsert(
      { campaign_id: campaignId, organization_id: organizationId },
      { onConflict: "campaign_id,organization_id" },
    )
    .select("id")
    .single();

  if (error)
    throw new Error(
      `Failed to link organization to campaign: ${error.message}`,
    );
  return data;
}

/**
 * Link a person to a campaign. Upserts into campaign_people.
 */
export async function linkPersonToCampaign(
  personId: string,
  campaignId: string,
  client?: SupabaseClient,
): Promise<{ id: string }> {
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase
    .from("campaign_people")
    .upsert(
      { campaign_id: campaignId, person_id: personId },
      { onConflict: "campaign_id,person_id" },
    )
    .select("id")
    .single();

  if (error)
    throw new Error(`Failed to link person to campaign: ${error.message}`);
  return data;
}

/**
 * Merge new enrichment data into an existing record (additive).
 * Updates last_enriched_at and enrichment_status.
 */
export async function mergeEnrichmentData(
  table: "organizations" | "people",
  id: string,
  newData: Record<string, unknown>,
  status: "enriched" | "failed" = "enriched",
  client?: SupabaseClient,
): Promise<void> {
  const supabase = client ?? (await createClient());

  // Fetch existing enrichment_data
  const { data: existing } = await supabase
    .from(table)
    .select("enrichment_data")
    .eq("id", id)
    .single();

  const existingData =
    (existing?.enrichment_data as Record<string, unknown>) || {};

  // Additive merge: new keys overwrite, but don't null-out existing keys
  const merged: Record<string, unknown> = { ...existingData };
  for (const [key, value] of Object.entries(newData)) {
    if (key === "errors") {
      const existingErrors = (existingData.errors as string[]) || [];
      const newErrors = (value as string[]) || [];
      merged.errors = [...new Set([...existingErrors, ...newErrors])];
      continue;
    }
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }

  // Throw on failure: a swallowed error here leaves enrichment_status stuck
  // at 'pending' with the caller believing the work landed — the target-list
  // chain would then re-pick the org forever. Callers' per-account error
  // handling owns the failure.
  const { error: updateError } = await supabase
    .from(table)
    .update({
      enrichment_data: merged,
      enrichment_status: status,
      last_enriched_at:
        status === "enriched" ? new Date().toISOString() : undefined,
    })
    .eq("id", id);
  if (updateError) {
    throw new Error(
      `Failed to persist enrichment for ${table}/${id}: ${updateError.message}`,
    );
  }
}

/**
 * Check if a record needs re-enrichment based on last_enriched_at recency.
 * Returns true if enrichment should be skipped (data is fresh).
 */
export async function isRecentlyEnriched(
  table: "organizations" | "people",
  id: string,
  maxAgeDays: number = 7,
  client?: SupabaseClient,
): Promise<boolean> {
  const supabase = client ?? (await createClient());

  const { data } = await supabase
    .from(table)
    .select("enrichment_data")
    .eq("id", id)
    .single();

  if (!data) return false;

  // Check for the enrichedAt key inside enrichment_data -- this is set
  // specifically by the company/contact enrichment routes, not by other
  // enrichment sources (YC scraper, hiring scraper, etc.)
  const enrichmentData = data.enrichment_data as Record<string, unknown> | null;
  const enrichedAt = enrichmentData?.enrichedAt as string | undefined;
  if (!enrichedAt) return false;

  const age = Date.now() - new Date(enrichedAt).getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return age < maxAgeMs;
}
