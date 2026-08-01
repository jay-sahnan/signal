import type { SupabaseClient } from "@supabase/supabase-js";

import { parseLinkedInTitle } from "@/lib/utils";
import { ExaService } from "@/lib/services/exa-service";
import {
  findPeopleOnDomain,
  filterContactsByCompany,
  type CandidateContact,
  type CompanyContext,
} from "@/lib/services/contact-filter";
import {
  canHoldPeople,
  findOrCreatePerson,
  linkPersonToCampaign,
  normalizeLinkedInUrl,
} from "@/lib/services/knowledge-base";
import { recordVerifiedEmail } from "@/lib/services/email-pattern";
import {
  recordAffiliation,
  type AffiliationSource,
} from "@/lib/services/affiliation";

/**
 * The one path contacts are discovered through.
 *
 * This logic previously existed as three near-identical copies — the
 * findContacts tool, /api/find-contacts, and /api/enrich-company — which meant
 * a fix to any of them left the same bug live in the other two. Consolidated
 * here so affiliation is recorded identically wherever contacts come from.
 */

export interface DiscoveredContact {
  id: string;
  name: string;
  title: string | null;
  work_email: string | null;
  personal_email: string | null;
  linkedinUrl: string | null;
  source: string;
  /** Why we believe they work here, and how strongly. */
  affiliation: AffiliationSource;
  affiliationEvidence: string;
}

/** Per-call ceiling on Exa searches. One search per title, so this bounds spend. */
export const MAX_TITLES = 5;

/**
 * Ceiling on the `alreadyLinked` roster returned to the caller. This rides
 * along on every search, unlike getContacts which the agent asks for
 * deliberately, so an org with hundreds of stored people would otherwise put
 * its whole roster in the model's context on each call. `alreadyLinkedTotal`
 * always reports the true count so a truncated list never reads as complete.
 */
export const MAX_ALREADY_LINKED = 50;

export interface ExistingContact {
  id: string;
  name: string;
  title: string | null;
  work_email: string | null;
  personal_email: string | null;
  linkedinUrl: string | null;
}

export interface ContactDiscoveryResult {
  organizationId: string;
  companyName: string;
  contacts: DiscoveredContact[];
  /**
   * People already attached to this organization before the search ran. Not
   * newly found and not billed — surfaced so the caller can answer "add the
   * people you already have" without searching again. Capped at
   * MAX_ALREADY_LINKED; read `alreadyLinkedTotal` for the real count.
   */
  alreadyLinked: ExistingContact[];
  /** How many people are attached to this org, ignoring the display cap. */
  alreadyLinkedTotal: number;
  searchesRun: Array<{
    title: string;
    query: string;
    resultsFound: number;
    error?: string;
  }>;
  totalFound: number;
  duplicatesSkipped: number;
  /** Judged as genuine employees. */
  verifiedCount: number;
  /** Kept but unproven — surfaced to the user, blocked from outreach. */
  uncertainCount: number;
  /** Positively placed at a different company; stored unattached. */
  rejectedAsWrongCompany: number;
  error?: string;
}

export async function findContactsForOrganization(
  supabase: SupabaseClient,
  args: {
    organizationId: string;
    campaignId?: string | null;
    titles: string[];
    numResults?: number;
  },
): Promise<ContactDiscoveryResult> {
  const { organizationId, campaignId, numResults = 5 } = args;
  // Bounded here rather than in the callers. Two of the three original copies
  // sliced to 5; the consolidation moved the logic but left the cost cap
  // behind, so find-more-people quietly went from 4 searches to 6 unbounded.
  const titles = args.titles.slice(0, MAX_TITLES);

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, name, domain, industry, location, description")
    .eq("id", organizationId)
    .single();

  if (orgError || !org) {
    throw new Error(
      `Organization not found: ${orgError?.message ?? "unknown"}`,
    );
  }

  const empty = (error: string): ContactDiscoveryResult => ({
    organizationId,
    companyName: org.name,
    contacts: [],
    alreadyLinked: [],
    alreadyLinkedTotal: 0,
    searchesRun: [],
    totalFound: 0,
    duplicatesSkipped: 0,
    verifiedCount: 0,
    uncertainCount: 0,
    rejectedAsWrongCompany: 0,
    error,
  });

  // Without a domain we cannot tell this company apart from any other with the
  // same name, so attaching people to it is how contact lists get pooled across
  // unrelated businesses. Refuse, and say what would fix it.
  if (!canHoldPeople(org)) {
    return empty(
      `"${org.name}" has no domain on record, so contacts cannot be attached to it — two different companies with this name would be indistinguishable. Resolve the company's website first, then retry.`,
    );
  }

  const company: CompanyContext = {
    name: org.name,
    domain: org.domain,
    industry: org.industry,
    location: org.location,
    description: org.description,
  };

  // Dedup against people we already hold — both the campaign's linked contacts
  // and everyone already attached to this organization.
  //
  // The org half matters because the only caller with no campaignId is "Find
  // more people": without it, every click re-fetched, re-judged and re-billed
  // every already-known contact, then reported them all as newly added.
  const existingUrls = new Set<string>();

  // Everyone already attached to this org, kept rather than counted. The agent
  // used to see only `duplicatesSkipped: 10` and three new strangers, with no
  // way to tell that the 10 skipped rows were the confirmed employees the user
  // had just asked it to add — so "add them" triggered another search instead
  // of resolving to people we already held.
  const { data: orgPeople } = await supabase
    .from("people")
    .select("id, name, title, work_email, personal_email, linkedin_url")
    .eq("organization_id", organizationId);
  const alreadyLinked: ExistingContact[] = [];
  let alreadyLinkedTotal = 0;
  for (const p of orgPeople ?? []) {
    // Dedup is never capped — a truncated set of known URLs would re-fetch and
    // re-bill people we already hold. Only the returned roster is bounded.
    if (p.linkedin_url) existingUrls.add(normalizeLinkedInUrl(p.linkedin_url));
    alreadyLinkedTotal++;
    if (alreadyLinked.length < MAX_ALREADY_LINKED) {
      alreadyLinked.push({
        id: p.id,
        name: p.name,
        title: p.title,
        work_email: p.work_email,
        personal_email: p.personal_email,
        linkedinUrl: p.linkedin_url,
      });
    }
  }

  if (campaignId) {
    const { data: links } = await supabase
      .from("campaign_people")
      .select("person:people(linkedin_url)")
      .eq("campaign_id", campaignId);
    for (const l of links ?? []) {
      const url = (
        l.person as unknown as { linkedin_url: string | null } | null
      )?.linkedin_url;
      if (url) existingUrls.add(normalizeLinkedInUrl(url));
    }
  }

  const contacts: DiscoveredContact[] = [];
  let duplicatesSkipped = 0;
  let verifiedCount = 0;
  let uncertainCount = 0;
  let rejectedAsWrongCompany = 0;

  // ── Phase 1: the company's own website ──────────────────────────────────
  // Strongest routine evidence there is: the company published these people as
  // its own staff.
  if (org.domain) {
    try {
      const domainPeople = await findPeopleOnDomain(org.domain, org.name);
      for (const dp of domainPeople) {
        const linkedinUrl = dp.linkedinUrl
          ? normalizeLinkedInUrl(dp.linkedinUrl)
          : null;
        if (linkedinUrl && existingUrls.has(linkedinUrl)) {
          duplicatesSkipped++;
          continue;
        }

        const person = await findOrCreatePerson(
          {
            name: dp.name,
            title: dp.title,
            linkedin_url: linkedinUrl,
            work_email: dp.email,
            organization_id: organizationId,
            source: "website",
          },
          supabase,
        );

        const evidence = `listed on ${org.domain}`;
        await recordAffiliation(supabase, {
          personId: person.id,
          organizationId,
          source: "team_page",
          evidence,
        });

        if (dp.email) {
          await recordVerifiedEmail(supabase, {
            personId: person.id,
            email: dp.email,
            source: "team_page",
          });
        }

        if (campaignId)
          await linkPersonToCampaign(person.id, campaignId, supabase);
        if (linkedinUrl) existingUrls.add(linkedinUrl);

        verifiedCount++;
        contacts.push({
          id: person.id,
          name: person.name,
          title: person.title,
          work_email: person.work_email,
          personal_email: person.personal_email,
          linkedinUrl: person.linkedin_url,
          source: "website",
          affiliation: "team_page",
          affiliationEvidence: evidence,
        });
      }
    } catch (err) {
      console.error("[contact-discovery] Domain scrape failed:", err);
    }
  }

  // ── Phase 2: LinkedIn search, judged ────────────────────────────────────
  const exa = new ExaService();
  const searchResults = await Promise.all(
    titles.map(async (title) => {
      const query = `"${org.name}" ${title} site:linkedin.com`;
      try {
        const result = await exa.search(query, {
          numResults,
          category: "people" as const,
          includeText: true,
        });
        return { title, query, results: result.results };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(
          `[contact-discovery] Search failed for "${query}": ${msg}`,
        );
        return { title, query, results: [], error: msg };
      }
    }),
  );

  const seenUrls = new Set<string>();
  const candidates: Array<
    CandidateContact & { searchTitle: string; linkedinUrl: string | null }
  > = [];

  for (const search of searchResults) {
    for (const result of search.results) {
      // Only individual profiles. A bare `linkedin.com` test also matches
      // /company/ and /school/ pages, which parse into a "person" named after
      // the company — whose headline then obviously mentions the target
      // company, so the judge confirms it and the fake contact clears the
      // affiliation half of the send gate.
      const isProfile = /linkedin\.com\/in\//i.test(result.url);

      // LinkedIn URLs that are not individual profiles — /company/, /school/,
      // /posts/ — are skipped outright, not merely stripped of their URL. A
      // company page parses into a "person" named after the company, whose
      // headline then names the target company, so the judge verifies it and a
      // fake contact clears the affiliation half of the send gate. Nulling the
      // URL (the previous behaviour) made that worse: with no URL it also
      // slipped every dedup.
      if (!isProfile && /linkedin\.com/i.test(result.url)) {
        continue;
      }

      const linkedinUrl = isProfile ? normalizeLinkedInUrl(result.url) : null;

      // Dedup on the canonical form. Keying on the raw URL let the same profile
      // through twice in different host/trailing-slash forms — the one place
      // the two forms still diverged after the canonicalisation migration.
      const dedupKey = linkedinUrl ?? result.url;
      if (seenUrls.has(dedupKey)) {
        duplicatesSkipped++;
        continue;
      }
      seenUrls.add(dedupKey);

      if (linkedinUrl && existingUrls.has(linkedinUrl)) {
        duplicatesSkipped++;
        continue;
      }

      const parsed = parseLinkedInTitle(result.title);
      // parseLinkedInTitle yields "Unknown" for anything it cannot split.
      // Storing those creates contacts named "Unknown". Not counted as a
      // duplicate — it isn't one, and inflating that number misleads the agent.
      if (!parsed.name || parsed.name === "Unknown") {
        continue;
      }

      candidates.push({
        name: parsed.name,
        // Only a title we actually read off this person's headline. This used
        // to fall back to `search.title` — the title we *queried* for — which
        // stamped the ICP target title onto anyone whose headline didn't parse.
        // The result was a 15-person startup showing three Heads of Growth and
        // four Revenue Operations: the search list, replicated across people.
        // A guess is worse than a blank here, because it is what outreach
        // personalises against and what the judge below reads as evidence.
        title: parsed.title,
        linkedinUrl,
        rawHeadline: result.title,
        searchTitle: search.title,
      });
    }
  }

  if (candidates.length > 0) {
    for (const judged of await filterContactsByCompany(company, candidates)) {
      const candidate = candidates[judged.index];
      if (!candidate) continue;

      // Rejected means the evidence positively placed them somewhere else.
      // Keep them, unattached, rather than pretending they are an employee —
      // but only when we can actually identify them. findOrCreatePerson dedups
      // by LinkedIn URL, or by name within an organization; a rejected
      // candidate has no organization, so one with no profile URL matches
      // neither path and would be INSERTED fresh on every run, leaving the
      // mis-filed original untouched and adding an orphan each time.
      if (judged.verdict === "rejected" && !candidate.linkedinUrl) {
        rejectedAsWrongCompany++;
        continue;
      }

      const attachTo = judged.verdict === "rejected" ? null : organizationId;
      const source: AffiliationSource =
        judged.verdict === "verified" ? "llm_verified" : "search_stamp";

      const person = await findOrCreatePerson(
        {
          name: judged.name,
          title: judged.title,
          linkedin_url: candidate.linkedinUrl,
          organization_id: attachTo,
          source: "exa",
        },
        supabase,
      );

      await recordAffiliation(supabase, {
        personId: person.id,
        organizationId: attachTo,
        source,
        evidence: judged.evidence,
      });

      if (judged.verdict === "rejected") {
        rejectedAsWrongCompany++;
        continue;
      }
      if (judged.verdict === "verified") verifiedCount++;
      else uncertainCount++;

      if (campaignId)
        await linkPersonToCampaign(person.id, campaignId, supabase);

      contacts.push({
        id: person.id,
        name: person.name,
        title: person.title,
        work_email: person.work_email,
        personal_email: person.personal_email,
        linkedinUrl: person.linkedin_url,
        source: "exa",
        affiliation: source,
        affiliationEvidence: judged.evidence,
      });
    }
  }

  return {
    organizationId,
    companyName: org.name,
    contacts,
    alreadyLinked,
    alreadyLinkedTotal,
    searchesRun: searchResults.map((s) => ({
      title: s.title,
      query: s.query,
      resultsFound: s.results.length,
      error: "error" in s ? (s as { error?: string }).error : undefined,
    })),
    totalFound: contacts.length,
    duplicatesSkipped,
    verifiedCount,
    uncertainCount,
    rejectedAsWrongCompany,
  };
}
