import { isHostedMode } from "@/lib/auth/workspace";
import { executePaidAction, hasPaidAction } from "@/lib/billing/paid-action";
import { CreditExecutionError } from "@/lib/billing/credit-execution";
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
} from "@/lib/services/knowledge-base";
import { findContactsForOrganization } from "@/lib/services/contact-discovery";
import { type CompanyContext } from "@/lib/services/contact-filter";
import { extractClaims } from "@/lib/services/claim-extractor";
import { reconcileClaims } from "@/lib/services/claim-reconciler";
import {
  HIRING_SCRAPE_TIMEOUT_MS,
  tryScrapeHiringData,
} from "@/lib/services/hiring-scraper";
import type { CompanyClaim } from "@/lib/types/claims";
import { withTimeout } from "@/lib/utils/timeout";

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
  const { data: allSignals, error: allSignalsError } = await supabase
    .from("campaign_signals")
    .select("id")
    .eq("campaign_id", campaignId)
    .limit(1);

  if (isHostedMode() && allSignalsError)
    throw new Error("Could not read campaign signals");

  // No signal config at all -- run everything (not configured yet)
  if (!allSignals || allSignals.length === 0) return null;

  const { data, error } = await supabase
    .from("campaign_signals")
    .select("signal_id, signals(slug)")
    .eq("campaign_id", campaignId)
    .eq("enabled", true);

  if (isHostedMode() && error)
    throw new Error("Could not read enabled signals");
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
  try {
    return await enrichRequest(request);
  } catch (error) {
    if (error instanceof CreditExecutionError)
      return Response.json({ error: error.message }, { status: error.status });
    console.error("[enrich-company] Request failed", error);
    return Response.json(
      { error: "Company enrichment failed. Retry the same request." },
      { status: 500 },
    );
  }
}

async function enrichRequest(request: Request) {
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

  const { companyId, campaignId } = (body ?? {}) as {
    companyId: string;
    campaignId?: string;
  };
  if (
    typeof companyId !== "string" ||
    !companyId.trim() ||
    (campaignId !== undefined &&
      (typeof campaignId !== "string" || !campaignId.trim()))
  ) {
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

  // No link, no claim. This used to retry the id against `organizations`
  // directly and enrich whatever came back. Organizations are shared and carry
  // no owner, so that read can never establish ownership: any id would run,
  // writing to the row and spending search credits on it. The optional
  // campaignId check above is not a substitute either -- it proves the caller
  // owns that campaign, not that this company has anything to do with it.
  // Every caller in the app sends a link id, so there is nothing to keep.
  if (linkError || !link) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  // Ownership check via the link's parent campaign.
  const linkCampaign = link.campaign as unknown as { user_id: string } | null;
  if (!linkCampaign) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }
  if (linkCampaign.user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (isHostedMode() && campaignId && campaignId !== link.campaign_id)
    return Response.json(
      { error: "Company does not belong to the requested campaign" },
      { status: 400 },
    );

  if (!link.organization) {
    return Response.json(
      { error: "Organization data missing" },
      { status: 404 },
    );
  }

  const org = link.organization as unknown as Record<string, unknown>;
  const orgId = link.organization_id;

  // When the body carried no campaignId, the link's parent campaign IS the
  // campaign context: the comment above always promised this derivation, but
  // link.campaign_id was fetched and never used, so callers without an
  // explicit campaignId ran all four signal searches (spending Exa/Places on
  // signals the campaign disabled) and skipped contact discovery entirely.
  const effectiveCampaignId = campaignId ?? (link.campaign_id as string);
  const activeSlugs = effectiveCampaignId
    ? await getActiveSignalSlugs(effectiveCampaignId)
    : null; // null = run all (no campaign context)

  if (!isHostedMode()) {
    return enrichOrganization(
      org,
      orgId,
      activeSlugs,
      user.id,
      effectiveCampaignId,
      companyId,
    );
  }
  const paidInput = {
    identity: { userId: user.id, source: "web" as const },
    key: request.headers.get("Idempotency-Key"),
    kind: "company.enrich.web",
    request: { organizationId: orgId, campaignId: effectiveCampaignId },
  };
  const recent = await isRecentlyEnriched("organizations", orgId, 7, true);
  // Without a domain there is no contact-discovery work to run on a cached profile.
  const existing = recent && !org.domain && await hasPaidAction(paidInput);
  if (recent && !org.domain && !existing)
    return Response.json({
      companyId: orgId,
      enrichmentData: org.enrichment_data,
      skipped: true,
      contactsFound: 0,
    });
  const result = await executePaidAction(
    paidInput,
    async () => {
      const response = await enrichOrganization(
        org,
        orgId,
        activeSlugs,
        user.id,
        effectiveCampaignId,
        companyId,
        recent && !existing,
      );
      if (!response.ok) throw new Error("Company research failed");
      return response.json();
    },
  );
  return Response.json(result);
}

/**
 * Thin wrapper over the shared discovery path.
 *
 * This function used to be a third near-identical copy of the contact-finding
 * logic (alongside the findContacts tool and /api/find-contacts), so a fix in
 * any one of them left the same bug live in the other two.
 */
async function findContactsForCompany(
  orgId: string,
  company: CompanyContext,
  campaignId: string,
): Promise<{ totalFound: number }> {
  const supabase = await createClient();

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("icp")
    .eq("id", campaignId)
    .single();

  if (isHostedMode() && campaignError)
    throw new Error("Could not read contact discovery settings");
  const icp = campaign?.icp as Record<string, unknown> | null;
  const targetTitles = (icp?.targetTitles as string[] | undefined) || [];
  // Bound to avoid per-user Exa spend blowouts.
  const boundedTitles = targetTitles.slice(0, 5);

  try {
    const result = await findContactsForOrganization(supabase, {
      organizationId: orgId,
      campaignId,
      titles: boundedTitles,
      numResults: 3,
    });
    if (result.error) {
      if (isHostedMode()) throw new Error(result.error);
      console.warn(`[enrich-company] ${company.name}: ${result.error}`);
    }
    return { totalFound: result.totalFound };
  } catch (err) {
    if (isHostedMode()) throw err;
    console.error("[enrich-company] contact discovery failed:", err);
    return { totalFound: 0 };
  }
}

async function enrichOrganization(
  org: Record<string, unknown>,
  orgId: string,
  activeSlugs: Set<string> | null,
  userId: string,
  campaignId?: string,
  linkId?: string,
  preparedRecent?: boolean,
) {
  return withAction(
    `Enrich company: ${org.name}`,
    async () => {
      // Check recency
      const recent =
        preparedRecent ?? (await isRecentlyEnriched("organizations", orgId));
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
      const runExecutive =
        !activeSlugs || activeSlugs.has(SIGNAL_SLUG_EXECUTIVE);
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
      const context =
        contextParts.length > 0 ? ` ${contextParts.join(" ")}` : "";
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
        // Bounded: Stagehand's observe/act/extract steps have no timeouts of
        // their own, and an unbounded scrape would blow past the route's
        // maxDuration. On timeout allSettled records a rejection, careers
        // stays null, and hiring is reported unknown, which is the designed
        // fail-open behavior.
        org.domain
          ? withTimeout(
              tryScrapeHiringData(orgId, org.domain as string),
              HIRING_SCRAPE_TIMEOUT_MS,
              `Careers scrape ${org.domain}`,
            )
          : Promise.resolve(null),
      ]);

      const [
        websiteResult,
        productResult,
        fundingResult,
        executiveResult,
        googleReviewsResult,
        hiringResult,
      ] = operations;

      const enrichmentData: Record<string, unknown> = {
        enrichedAt: new Date().toISOString(),
      };

      if (
        websiteResult.status === "fulfilled" &&
        websiteResult.value?.success
      ) {
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
          errors.push(
            `Search (${label}): ${result.reason?.message || "Failed"}`,
          );
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

      // Typed claims: extract from raw pulls, then reconcile against the
      // careers scrape (ground truth for hiring) and recency rules. Runs
      // regardless of which signal-gated searches ran; extractClaims handles
      // empty or partial input. Fail-open at every stage; a claims failure
      // never blocks storing the raw enrichment.
      const careers =
        hiringResult.status === "fulfilled" && hiringResult.value
          ? {
              careersUrl: hiringResult.value.careersUrl,
              jobs: hiringResult.value.jobs,
              scrapedAt: new Date().toISOString(),
            }
          : null;

      if (
        isHostedMode() &&
        !searches.length &&
        !enrichmentData.website &&
        !enrichmentData.googleReviews &&
        !careers
      )
        throw new Error("All company research sources failed");
      const extracted = await extractClaims({
        companyName: org.name as string,
        companyDomain,
        websiteContent:
          websiteResult.status === "fulfilled" && websiteResult.value?.success
            ? websiteResult.value.data.content
            : null,
        searches,
      });

      // Scraped jobs become verified hiring claims directly; no LLM needed.
      const hiringClaims: CompanyClaim[] = careers?.careersUrl
        ? careers.jobs.map((j) => ({
            type: "hiring_role" as const,
            statement: `Hiring: ${j.title}${j.location ? ` (${j.location})` : ""}`,
            sourceUrl: careers.careersUrl as string,
            publishedDate: careers.scrapedAt,
            confidence: 1,
            extractedAt: careers.scrapedAt,
            status: "verified" as const,
          }))
        : [];

      enrichmentData.claims = [
        ...reconcileClaims(extracted, { now: new Date(), careers }),
        ...hiringClaims,
      ];

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
    },
    userId,
  ); // end withAction
}
