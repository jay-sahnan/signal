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
import { titleMatchesAny } from "@/lib/services/title-match";

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
  /**
   * Why we believe they work here, and how strongly. `unchanged` means the
   * write this search wanted to make was refused because the stored evidence
   * outranks it, so the affiliation on file is whatever it already was.
   */
  affiliation: AffiliationSource | "unchanged";
  affiliationEvidence: string;
}

/**
 * How a contact whose affiliation write was refused is described.
 *
 * Both judge-and-store paths use these, so the two cannot drift on how they
 * report a refusal. The person is kept in the returned list either way: a
 * refused detach leaves them attached and sendable, and dropping them while
 * reporting them as departed is the failure this replaces.
 */
export const AFFILIATION_UNCHANGED = "unchanged" as const;

export function unchangedEvidence(
  reason: string | undefined,
  judgedEvidence: string,
): string {
  return `affiliation left as it was (${reason ?? "write refused"}); this search saw: ${judgedEvidence}`;
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
  /**
   * Positively placed at a different company, so not a contact here. Detached
   * from this company if they were filed under it, and left exactly as they
   * were if they were already filed under someone else.
   */
  rejectedAsWrongCompany: number;
  /** Worked here once, and the evidence shows the role has ended. Detached. */
  departedCount: number;
  /**
   * People whose affiliation this search did NOT change, because what is
   * already on file outranks what it found. Counted separately from every
   * verdict counter above: none of those describe what happened to these rows,
   * and reporting them under one is how the agent came to describe writes that
   * never landed.
   */
  affiliationUnchanged: number;
  /** Team-page staff stored in the pool but not linked: titles outside the targets. */
  teamPageUnlinked: number;
  error?: string;
}

/**
 * Prose for the three counters that describe people the agent will NOT find in
 * the returned contact list.
 *
 * A bare `affiliationUnchanged: 2` reads as "two more were fine" when it means
 * "two writes were refused", and a bare `uncertainCount: 6` invites the agent
 * to go and fix it with a tool that cannot. Shared by both discovery paths so
 * the same number is never described two different ways.
 */
export function affiliationNotes(counts: {
  uncertainCount: number;
  departedCount: number;
  affiliationUnchanged: number;
}): string | undefined {
  const notes: string[] = [];
  if (counts.uncertainCount > 0) {
    notes.push(
      `${counts.uncertainCount} contact(s) could not be confirmed as employees of this company. They are stored and flagged, but are blocked from outreach until confirmed. Enrichment cannot settle this: confirming them is a human action in the campaign UI.`,
    );
  }
  if (counts.departedCount > 0) {
    notes.push(
      `${counts.departedCount} contact(s) have left this company: their profile shows a stint here that has already ended, so they were detached from it and are not in the contact list.`,
    );
  }
  if (counts.affiliationUnchanged > 0) {
    notes.push(
      `${counts.affiliationUnchanged} contact(s) already have stronger evidence on file than this search found, so their affiliation was left exactly as it was and is shown as "unchanged". Do not describe them as verified or as departed: nothing about them changed.`,
    );
  }
  return notes.length > 0 ? notes.join(" ") : undefined;
}

export async function findContactsForOrganization(
  supabase: SupabaseClient,
  args: {
    organizationId: string;
    campaignId?: string | null;
    titles: string[];
    numResults?: number;
    /**
     * Who from the company's own team page gets linked to the campaign.
     * "matching" (default): only people whose title is in the family of a
     * target title; everyone else is still stored in the shared pool with
     * their team-page affiliation, just not attached to this campaign.
     * "all": the old behaviour, link every listed person.
     */
    linkTeamPage?: "matching" | "all";
  },
): Promise<ContactDiscoveryResult> {
  const {
    organizationId,
    campaignId,
    numResults = 5,
    linkTeamPage = "matching",
  } = args;
  let teamPageUnlinked = 0;
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
    departedCount: 0,
    affiliationUnchanged: 0,
    teamPageUnlinked: 0,
    error,
  });

  // Without a domain we cannot tell this company apart from any other with the
  // same name, so attaching people to it is how contact lists get pooled across
  // unrelated businesses. Refuse, and say what would fix it.
  if (!canHoldPeople(org)) {
    return empty(
      `"${org.name}" has no domain on record, so contacts cannot be attached to it: two different companies with this name would be indistinguishable. Resolve the company's website first, then retry.`,
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
  const { data: orgPeople, error: orgPeopleError } = await supabase
    .from("people")
    .select("id, name, title, work_email, personal_email, linkedin_url")
    .eq("organization_id", organizationId);
  // A failed roster read is not an empty roster. Proceeding with an empty
  // dedup set re-fetches, re-judges and re-bills every contact we already
  // hold, then reports them all as newly added.
  if (orgPeopleError) {
    return empty(
      `Could not load the people already attached to this company (${orgPeopleError.message}), so the search was not run: without that list, every known contact would be re-fetched and re-billed as new. Retry.`,
    );
  }
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
    const { data: links, error: linksError } = await supabase
      .from("campaign_people")
      .select("person:people(linkedin_url)")
      .eq("campaign_id", campaignId);
    if (linksError) {
      return empty(
        `Could not load the campaign's linked contacts (${linksError.message}), so the search was not run: without that list, every known contact would be re-fetched and re-billed as new. Retry.`,
      );
    }
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
  let departedCount = 0;
  let affiliationUnchanged = 0;

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

        const person = await findOrCreatePerson({
          name: dp.name,
          title: dp.title,
          linkedin_url: linkedinUrl,
          work_email: dp.email,
          organization_id: organizationId,
          source: "website",
        });

        const evidence = `listed on ${org.domain}`;
        // Even here the write can be refused: someone already on file at
        // email_domain (0.95) or user_entered (1.0) outranks a team page, and
        // so does anyone attached elsewhere at 0.9 or better. Counting them as
        // verified would be reporting a write that did not happen.
        const write = await recordAffiliation(supabase, {
          personId: person.id,
          organizationId,
          source: "team_page",
          evidence,
        });

        // Filed under a DIFFERENT company on evidence outranking even the
        // team page. Not a contact here, so nothing below applies to them:
        // recording their email, linking them to the campaign, or listing
        // them would all act on an affiliation the database just refused.
        if (!write.written && write.attachedElsewhere) {
          rejectedAsWrongCompany++;
          continue;
        }

        if (dp.email) {
          await recordVerifiedEmail(supabase, {
            personId: person.id,
            email: dp.email,
            source: "team_page",
          });
        }

        if (linkedinUrl) existingUrls.add(linkedinUrl);

        // The page lists the whole company; the campaign asked for some
        // roles. Everyone is kept in the pool with their affiliation (that
        // evidence is the point of the scrape), but only role matches join
        // the campaign, or a growth search fills it with the finance team.
        const wanted =
          linkTeamPage === "all" || titleMatchesAny(person.title, titles);
        if (!wanted) {
          teamPageUnlinked++;
          continue;
        }

        if (campaignId) await linkPersonToCampaign(person.id, campaignId);

        if (write.written) verifiedCount++;
        else affiliationUnchanged++;

        contacts.push({
          id: person.id,
          name: person.name,
          title: person.title,
          work_email: person.work_email,
          personal_email: person.personal_email,
          linkedinUrl: person.linkedin_url,
          source: "website",
          affiliation: write.written ? "team_page" : AFFILIATION_UNCHANGED,
          affiliationEvidence: write.written
            ? evidence
            : unchangedEvidence(write.reason, evidence),
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
        pageText: result.text ?? null,
        pageDate: result.publishedDate ?? null,
        searchTitle: search.title,
      });
    }
  }

  if (candidates.length > 0) {
    for (const judged of await filterContactsByCompany(company, candidates)) {
      const candidate = candidates[judged.index];
      if (!candidate) continue;

      const detaching =
        judged.verdict === "rejected" || judged.verdict === "former_employee";

      // A detached candidate is a real person who works somewhere else, or
      // used to work here. Keep them, unattached, rather than pretending they
      // are an employee, but only when we can actually identify them.
      // findOrCreatePerson dedups by LinkedIn URL, or by name within an
      // organization; a detached candidate has no organization, so one with no
      // profile URL matches neither path and would be INSERTED fresh on every
      // run, leaving the mis-filed original untouched and adding an orphan
      // each time.
      if (detaching && !candidate.linkedinUrl) {
        if (judged.verdict === "rejected") rejectedAsWrongCompany++;
        else departedCount++;
        continue;
      }

      const attachTo = detaching ? null : organizationId;
      const source: AffiliationSource =
        judged.verdict === "verified"
          ? "llm_verified"
          : judged.verdict === "former_employee"
            ? "former_employee"
            : judged.verdict === "rejected"
              ? "employer_mismatch"
              : "search_stamp";

      // Fold what the judge saw into the stored evidence. Without it the row
      // says "profile names a different employer" and the user has to go and
      // look up which one.
      const evidence = judged.employerSeen
        ? `${judged.evidence} (saw: ${judged.employerSeen}${judged.datesSeen ? `, ${judged.datesSeen}` : ""})`
        : judged.evidence;

      const person = await findOrCreatePerson({
        name: judged.name,
        title: judged.title,
        linkedin_url: candidate.linkedinUrl,
        organization_id: attachTo,
        source: "exa",
        // The judge reads this off the person's own headline or page text and
        // returns null otherwise. The team-page phase above passes none: a
        // staff listing carries no person-level location, and org HQ is
        // already the send-time fallback, so copying it here would only dress
        // it up as person data.
        location: judged.location ?? null,
      });

      const write = await recordAffiliation(supabase, {
        personId: person.id,
        organizationId: attachTo,
        source,
        evidence,
        // The judge was asked about THIS company and answered about it. Without
        // saying so, a detaching write means "detach from wherever you are", so
        // correctly rejecting someone here unlinks them from the unrelated
        // company they actually work at.
        detachedFrom: detaching ? organizationId : null,
      });

      // The verdict is what the judge concluded; the write is what actually
      // happened to the row. They diverge whenever the stored evidence outranks
      // this search, and counting the verdict regardless produced two opposite
      // lies: a refused attach reported as a verified contact (organization_id
      // still null, blocked at the send gate), and a refused detach reported as
      // departed and dropped from the list while the person stayed attached and
      // fully sendable.
      //
      // The refusals that do NOT mean "leave them in the list": the person is
      // filed under a different company, so nothing here was ever about them.
      // They are not a contact at this company, and reporting them as an
      // unchanged one is the same lie in a quieter voice. attachedElsewhere is
      // the attach-side flavour: the judge said verified or uncertain, but the
      // row says they work somewhere else on stronger evidence.
      if (!write.written && write.attachedElsewhere) {
        rejectedAsWrongCompany++;
        continue;
      }
      if (!write.written && write.notAtJudgedOrg) {
        if (judged.verdict === "rejected") rejectedAsWrongCompany++;
        else departedCount++;
        continue;
      }

      if (!write.written) {
        affiliationUnchanged++;
      } else if (judged.verdict === "rejected") {
        rejectedAsWrongCompany++;
        continue;
      } else if (judged.verdict === "former_employee") {
        departedCount++;
        continue;
      } else if (judged.verdict === "verified") {
        verifiedCount++;
      } else {
        uncertainCount++;
      }

      // Only ever link someone this search meant to keep. A refused detach
      // still belongs in `contacts` (they are attached, and hiding that is the
      // bug), but adding them to the campaign would act on the judgement the
      // database just refused.
      if (campaignId && !detaching) {
        await linkPersonToCampaign(person.id, campaignId);
      }

      contacts.push({
        id: person.id,
        name: person.name,
        title: person.title,
        work_email: person.work_email,
        personal_email: person.personal_email,
        linkedinUrl: person.linkedin_url,
        source: "exa",
        affiliation: write.written ? source : AFFILIATION_UNCHANGED,
        affiliationEvidence: write.written
          ? evidence
          : unchangedEvidence(write.reason, evidence),
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
    departedCount,
    affiliationUnchanged,
    teamPageUnlinked,
  };
}
