import type { SupabaseClient } from "@supabase/supabase-js";

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

/**
 * Company enrichment as a service, extracted from /api/enrich-company so the
 * QStash target-list processor can run it under the admin client. Every
 * function takes an explicit SupabaseClient — nothing here builds its own.
 *
 * Cost attribution (`withAction`) deliberately stays with the CALLERS: the
 * enrich-company route and the QStash route each wrap this in their own
 * action so spend lands on the right label.
 */

/** Signal slugs that map to company-level enrichment operations */
const SIGNAL_SLUG_PRODUCT = "product-launches";
const SIGNAL_SLUG_FUNDING = "funding-news";
const SIGNAL_SLUG_EXECUTIVE = "executive-changes";
const SIGNAL_SLUG_GOOGLE_REVIEWS = "google-reviews";

export interface CompanyEnrichmentResult {
  /** False when the 7-day recency check skipped re-enrichment. */
  enriched: boolean;
  contactsFound: number;
  errors: string[];
  /**
   * The freshly built enrichment payload, or the organization's stored
   * enrichment_data when the recency check skipped. Surfaced so the route
   * can keep its exact response shape.
   */
  enrichmentData: unknown;
}

/** Returns active signal slugs, or null if signals haven't been configured for this campaign */
async function getActiveSignalSlugs(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<Set<string> | null> {
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

/**
 * Thin wrapper over the shared discovery path.
 *
 * This function used to be a third near-identical copy of the contact-finding
 * logic (alongside the findContacts tool and /api/find-contacts), so a fix in
 * any one of them left the same bug live in the other two.
 */
async function findContactsForCompany(
  supabase: SupabaseClient,
  orgId: string,
  company: CompanyContext,
  campaignId: string,
): Promise<{ totalFound: number }> {
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("icp")
    .eq("id", campaignId)
    .single();

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
      console.warn(`[company-enrichment] ${company.name}: ${result.error}`);
    }
    return { totalFound: result.totalFound };
  } catch (err) {
    console.error("[company-enrichment] contact discovery failed:", err);
    return { totalFound: 0 };
  }
}

export interface EnrichmentOptions {
  /**
   * Skip contact discovery and only run company enrichment — for accounts
   * whose imported contacts already match the ICP. Deliberately a separate
   * flag rather than `campaignId: null`: the campaign also gates which
   * signal searches run, and that gating must survive a contacts-only skip.
   */
  skipContactFinding?: boolean;
}

/**
 * Enrich an organization (website extraction + signal-gated Exa searches +
 * Google reviews) and, when campaign context exists, find contacts for it.
 *
 * The 7-day recency skip applies only to enrichment — contact-finding still
 * runs on the skip path.
 */
export async function enrichAndFindContacts(
  supabase: SupabaseClient,
  organizationId: string,
  campaignId: string | null,
  options?: EnrichmentOptions,
): Promise<CompanyEnrichmentResult> {
  const { data: orgRow, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", organizationId)
    .single();

  if (orgError || !orgRow) {
    throw new Error(
      `Organization not found: ${orgError?.message ?? "unknown"}`,
    );
  }

  const org = orgRow as Record<string, unknown>;
  const orgId = organizationId;
  const findContactsEnabled = !options?.skipContactFinding;

  // Resolve active signal slugs for this campaign
  const activeSlugs = campaignId
    ? await getActiveSignalSlugs(supabase, campaignId)
    : null; // null = run all (no campaign context)

  // Check recency
  const recent = await isRecentlyEnriched("organizations", orgId, 7, supabase);
  if (recent) {
    // Still find contacts even if enrichment is cached
    let contactsFound = 0;
    if (campaignId && findContactsEnabled) {
      const companyCtx: CompanyContext = {
        name: org.name as string,
        domain: (org.domain as string) || null,
        industry: (org.industry as string) || null,
        location: (org.location as string) || null,
        description: (org.description as string) || null,
      };
      const result = await findContactsForCompany(
        supabase,
        orgId,
        companyCtx,
        campaignId,
      );
      contactsFound = result.totalFound;
    }
    return {
      enriched: false,
      contactsFound,
      errors: [],
      enrichmentData: org.enrichment_data,
    };
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

  const searchEntries: Array<[string, boolean, PromiseSettledResult<unknown>]> =
    [
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

  await mergeEnrichmentData(
    "organizations",
    orgId,
    enrichmentData,
    "enriched",
    supabase,
  );

  // Also find contacts if we have campaign context
  let contactsFound = 0;
  if (campaignId && findContactsEnabled) {
    try {
      const companyCtx: CompanyContext = {
        name: org.name as string,
        domain: (org.domain as string) || null,
        industry: (org.industry as string) || null,
        location: (org.location as string) || null,
        description: (org.description as string) || null,
      };
      const result = await findContactsForCompany(
        supabase,
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

  return {
    enriched: true,
    contactsFound,
    errors,
    enrichmentData,
  };
}
