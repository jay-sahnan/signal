import { withAction } from "@/lib/services/cost-tracker";
import { createClient, getSupabaseAndUser } from "@/lib/supabase/server";
import {
  summarizeSearchResults,
  summarizeWebsite,
} from "@/lib/services/enrichment-summarizer";
import { ExaService } from "@/lib/services/exa-service";
import { filterRelevantResults } from "@/lib/services/relevance-filter";
import { WebExtractionService } from "@/lib/services/web-extraction-service";
import {
  mergeEnrichmentData,
  isRecentlyEnriched,
  findOrCreatePerson,
  linkPersonToCampaign,
} from "@/lib/services/knowledge-base";
import {
  findPeopleOnDomain,
  filterContactsByCompany,
  type CompanyContext,
  type CandidateContact,
} from "@/lib/services/contact-filter";
import { parseLinkedInTitle } from "@/lib/utils";

export const maxDuration = 120;

/** Signal slugs that map to company-level enrichment operations */
const SIGNAL_SLUG_PRODUCT = "product-launches";
const SIGNAL_SLUG_FUNDING = "funding-news";
const SIGNAL_SLUG_EXECUTIVE = "executive-changes";
const SIGNAL_SLUG_GOOGLE_REVIEWS = "google-reviews";

/** Returns active signal slugs, or null if signals haven't been configured for this campaign */
async function getActiveSignalSlugs(
  campaignId: string,
): Promise<Set<string> | null> {
  const supabase = await createClient();

  // Check if any campaign_signals records exist at all
  const { data: allSignals } = await supabase
    .from("campaign_signals")
    .select("id")
    .eq("campaign_id", campaignId)
    .limit(1);

  // No signal config at all -- run everything (not configured yet)
  if (!allSignals || allSignals.length === 0) return null;

  const { data } = await supabase
    .from("campaign_signals")
    .select("signal_id, signals(slug)")
    .eq("campaign_id", campaignId)
    .eq("enabled", true);

  if (!data) return new Set();
  return new Set(
    data
      .map((row: Record<string, unknown>) => {
        const signal = row.signals as { slug: string } | null;
        return signal?.slug;
      })
      .filter((s): s is string => !!s),
  );
}

export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { companyId, campaignId } = body as {
    companyId: string;
    campaignId?: string;
  };
  if (!companyId) {
    return Response.json({ error: "companyId is required" }, { status: 400 });
  }

  // Defense-in-depth ownership check. If campaignId is supplied, verify
  // it belongs to the signed-in user directly. Otherwise we'll derive it
  // from the campaign_organizations row below.
  if (campaignId) {
    const { data: campaignRow, error: campaignError } = await supabase
      .from("campaigns")
      .select("user_id")
      .eq("id", campaignId)
      .single();
    if (campaignError || !campaignRow) {
      return Response.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (campaignRow.user_id !== user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Resolve active signal slugs for this campaign
  const activeSlugs = campaignId
    ? await getActiveSignalSlugs(campaignId)
    : null; // null = run all (no campaign context)

  // companyId is a campaign_organizations link ID -- resolve the organization.
  // Join through campaigns.user_id so we can also verify ownership when
  // campaignId wasn't explicitly supplied.
  const { data: link, error: linkError } = await supabase
    .from("campaign_organizations")
    .select(
      "organization_id, campaign_id, organization:organizations(*), campaign:campaigns(user_id)",
    )
    .eq("id", companyId)
    .single();

  if (linkError || !link) {
    // Try as a direct organization ID. Organizations are not user-scoped,
    // so the only ownership signal here is the campaignId check above (if
    // supplied). Without a campaign context, fall back to RLS + the
    // authenticated session.
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", companyId)
      .single();

    if (orgError || !org) {
      return Response.json({ error: "Company not found" }, { status: 404 });
    }

    return enrichOrganization(
      org as Record<string, unknown>,
      companyId,
      activeSlugs,
      campaignId,
    );
  }

  // Ownership check via the link's parent campaign.
  const linkCampaign = link.campaign as unknown as { user_id: string } | null;
  if (!linkCampaign) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }
  if (linkCampaign.user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!link.organization) {
    return Response.json(
      { error: "Organization data missing" },
      { status: 404 },
    );
  }

  const org = link.organization as unknown as Record<string, unknown>;
  const orgId = link.organization_id;

  return enrichOrganization(org, orgId, activeSlugs, campaignId, companyId);
}

async function findContactsForCompany(
  orgId: string,
  company: CompanyContext,
  campaignId: string,
  linkId?: string,
): Promise<{ totalFound: number }> {
  const supabase = await createClient();
  let totalFound = 0;

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("icp")
    .eq("id", campaignId)
    .single();

  const icp = campaign?.icp as Record<string, unknown> | null;
  const targetTitles = (icp?.targetTitles as string[] | undefined) || [];
  // Bound to avoid per-user Exa spend blowouts.
  const boundedTitles = targetTitles.slice(0, 5);

  // Dedup against existing campaign contacts (by LinkedIn URL only -- name
  // matching is too fragile with first-name-only entries from team pages)
  const { data: existingLinks } = await supabase
    .from("campaign_people")
    .select("person:people(linkedin_url)")
    .eq("campaign_id", campaignId);

  const existingUrls = new Set(
    (existingLinks || [])
      .map(
        (l) =>
          (l.person as unknown as { linkedin_url: string | null } | null)
            ?.linkedin_url,
      )
      .filter(Boolean) as string[],
  );

  // ── Phase 1: Search the company's own website for team/staff ───────
  if (company.domain) {
    try {
      const domainPeople = await findPeopleOnDomain(
        company.domain,
        company.name,
      );
      for (const dp of domainPeople) {
        if (dp.linkedinUrl && existingUrls.has(dp.linkedinUrl)) continue;

        const person = await findOrCreatePerson({
          name: dp.name,
          title: dp.title,
          linkedin_url: dp.linkedinUrl,
          work_email: dp.email,
          organization_id: orgId,
          source: "website",
        });

        await linkPersonToCampaign(person.id, campaignId);
        if (dp.linkedinUrl) existingUrls.add(dp.linkedinUrl);
        totalFound++;
      }
    } catch (err) {
      console.error("[findContactsForCompany] Domain scrape failed:", err);
    }
  }

  // ── Phase 2: LinkedIn search with LLM filtering ────────────────────
  if (boundedTitles.length > 0) {
    const exa = new ExaService();

    const searchResults = await Promise.all(
      boundedTitles.map(async (title: string) => {
        const query = `"${company.name}" ${title} site:linkedin.com`;
        try {
          const result = await exa.search(query, {
            numResults: 3,
            category: "people" as const,
            includeText: true,
          });
          return { title, results: result.results };
        } catch {
          return { title, results: [] };
        }
      }),
    );

    // Collect deduplicated candidates for LLM filtering
    const seenUrls = new Set<string>();
    const candidates: Array<
      CandidateContact & { searchTitle: string; linkedinUrl: string | null }
    > = [];

    for (const search of searchResults) {
      for (const result of search.results) {
        if (seenUrls.has(result.url)) continue;
        seenUrls.add(result.url);

        const linkedinUrl = result.url.includes("linkedin.com")
          ? result.url
          : null;
        if (linkedinUrl && existingUrls.has(linkedinUrl)) continue;

        const parsed = parseLinkedInTitle(result.title);

        candidates.push({
          name: parsed.name,
          title: parsed.title || search.title,
          linkedinUrl,
          rawHeadline: result.title,
          searchTitle: search.title,
        });
      }
    }

    if (candidates.length > 0) {
      // LLM filter: verify each candidate actually works at this company
      const verified = await filterContactsByCompany(company, candidates);

      for (const v of verified) {
        const candidate = candidates[v.index];
        if (!candidate) continue;

        const person = await findOrCreatePerson({
          name: v.name,
          title: v.title,
          linkedin_url: candidate.linkedinUrl,
          organization_id: orgId,
          source: "exa",
        });

        await linkPersonToCampaign(person.id, campaignId);
        totalFound++;
      }
    }
  }

  return { totalFound };
}

async function enrichOrganization(
  org: Record<string, unknown>,
  orgId: string,
  activeSlugs: Set<string> | null,
  campaignId?: string,
  linkId?: string,
) {
  return withAction(`Enrich company: ${org.name}`, async () => {
    // Check recency
    const recent = await isRecentlyEnriched("organizations", orgId);
    if (recent) {
      // Still find contacts even if enrichment is cached
      let contactsFound = 0;
      if (campaignId) {
        const companyCtx: CompanyContext = {
          name: org.name as string,
          domain: (org.domain as string) || null,
          industry: (org.industry as string) || null,
          location: (org.location as string) || null,
          description: (org.description as string) || null,
        };
        const result = await findContactsForCompany(
          orgId,
          companyCtx,
          campaignId,
          linkId,
        );
        contactsFound = result.totalFound;
      }
      return Response.json({
        companyId: orgId,
        enrichmentData: org.enrichment_data,
        skipped: true,
        contactsFound,
      });
    }

    // Website extraction always runs -- it's core enrichment, not a signal.
    // Exa searches are gated by active signals when configured.
    const runProduct = !activeSlugs || activeSlugs.has(SIGNAL_SLUG_PRODUCT);
    const runFunding = !activeSlugs || activeSlugs.has(SIGNAL_SLUG_FUNDING);
    const runExecutive = !activeSlugs || activeSlugs.has(SIGNAL_SLUG_EXECUTIVE);
    const runGoogleReviews =
      !activeSlugs || activeSlugs.has(SIGNAL_SLUG_GOOGLE_REVIEWS);

    const exa = new ExaService();
    const extractor = new WebExtractionService();
    const errors: string[] = [];

    const companyUrl =
      (org.url as string) || (org.domain ? `https://${org.domain}` : null);

    const contextParts: string[] = [];
    if (org.industry) contextParts.push(org.industry as string);
    if (org.location) contextParts.push(org.location as string);
    const context = contextParts.length > 0 ? ` ${contextParts.join(" ")}` : "";
    const domainHint = org.domain ? ` ${org.domain}` : "";
    const specificName = `"${org.name}"${domainHint}${context}`;

    const companyDomain =
      (org.domain as string) ||
      (companyUrl ? new URL(companyUrl).hostname : null);

    // Website extraction always runs; Exa searches gated by signals
    const operations = await Promise.allSettled([
      companyUrl
        ? extractor.extract(companyUrl, { includeLinks: false })
        : Promise.resolve(null),
      runProduct
        ? exa.search(
            companyDomain
              ? `${org.name} products services`
              : `${specificName} product services offering`,
            {
              numResults: 5,
              includeText: true,
              ...(companyDomain ? { includeDomains: [companyDomain] } : {}),
            },
          )
        : Promise.resolve({ results: [] }),
      runFunding
        ? exa.search(`${specificName} funding news announcement`, {
            numResults: 5,
            includeText: true,
            category: "news",
          })
        : Promise.resolve({ results: [] }),
      runExecutive
        ? exa.search(`${specificName} executive leadership team changes`, {
            numResults: 5,
            includeText: true,
          })
        : Promise.resolve({ results: [] }),
      runGoogleReviews
        ? (async () => {
            const { GooglePlacesService } =
              await import("@/lib/services/google-places-service");
            const service = new GooglePlacesService();
            return service.getPlaceReviews(
              org.name as string,
              (org.location as string) || undefined,
              (org.domain as string) || undefined,
            );
          })()
        : Promise.resolve(null),
    ]);

    const [
      websiteResult,
      productResult,
      fundingResult,
      executiveResult,
      googleReviewsResult,
    ] = operations;

    const enrichmentData: Record<string, unknown> = {
      enrichedAt: new Date().toISOString(),
    };

    if (websiteResult.status === "fulfilled" && websiteResult.value?.success) {
      const wd = websiteResult.value.data;
      const summary = await summarizeWebsite({
        companyName: org.name as string,
        title: wd.title,
        description: wd.description,
        content: wd.content,
      });
      enrichmentData.website = {
        title: wd.title,
        description: wd.description,
        content: wd.content.slice(0, 3000),
        summary: summary ?? undefined,
        openGraph: wd.openGraph,
      };
    } else if (websiteResult.status === "rejected") {
      errors.push(`Website: ${websiteResult.reason?.message || "Failed"}`);
    }

    const searches: Array<{
      category: string;
      query: string;
      results: Array<{
        title: string;
        url: string;
        publishedDate: string | null;
        text: string | null;
      }>;
    }> = [];

    const searchEntries: Array<
      [string, boolean, PromiseSettledResult<unknown>]
    > = [
      ["product", runProduct, productResult],
      ["funding", runFunding, fundingResult],
      ["executive", runExecutive, executiveResult],
    ];

    for (const [label, enabled, result] of searchEntries) {
      if (!enabled) continue;
      if (result.status === "fulfilled") {
        const value = result.value as {
          results: Array<{
            title: string;
            url: string;
            publishedDate: string | null;
            text: string | null;
          }>;
        };
        const mapped = value.results.map((r) => ({
          title: r.title,
          url: r.url,
          publishedDate: r.publishedDate,
          text: r.text?.slice(0, 2000) || null,
        }));
        const filtered = await filterRelevantResults(
          org.name as string,
          companyDomain,
          mapped,
        );
        const topResults = filtered.slice(0, 3);
        const summarized = await summarizeSearchResults(
          org.name as string,
          label,
          topResults,
        );
        searches.push({
          category: label,
          query: `${org.name} ${label}`,
          results: summarized,
        });
      } else {
        errors.push(`Search (${label}): ${result.reason?.message || "Failed"}`);
      }
    }

    enrichmentData.searches = searches;

    // Google Reviews
    if (
      googleReviewsResult.status === "fulfilled" &&
      googleReviewsResult.value?.found
    ) {
      const gr = googleReviewsResult.value;
      enrichmentData.googleReviews = {
        rating: gr.rating,
        reviewCount: gr.userRatingCount,
        googleMapsUrl: gr.googleMapsUri,
        topReviews: gr.reviews.slice(0, 5),
        fetchedAt: new Date().toISOString(),
      };
    } else if (googleReviewsResult.status === "rejected") {
      errors.push(
        `Google Reviews: ${googleReviewsResult.reason?.message || "Failed"}`,
      );
    }

    if (errors.length > 0) enrichmentData.errors = errors;

    await mergeEnrichmentData("organizations", orgId, enrichmentData);

    // Also find contacts if we have campaign context
    let contactsFound = 0;
    if (campaignId) {
      try {
        const companyCtx: CompanyContext = {
          name: org.name as string,
          domain: (org.domain as string) || null,
          industry: (org.industry as string) || null,
          location: (org.location as string) || null,
          description: (org.description as string) || null,
        };
        const result = await findContactsForCompany(
          orgId,
          companyCtx,
          campaignId,
          linkId,
        );
        contactsFound = result.totalFound;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        errors.push(`Find contacts: ${msg}`);
      }
    }

    return Response.json({
      companyId: orgId,
      enrichmentData,
      contactsFound,
      errors: errors.length > 0 ? errors : undefined,
    });
  }); // end withAction
}
