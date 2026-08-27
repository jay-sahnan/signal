import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, tool } from "ai";
import { z } from "zod";
import { apiSafeSchema } from "@/lib/ai/api-safe-schema";
import { MODELS } from "@/lib/ai/models";
import { llmTimeout } from "@/lib/utils/timeout";
import { createClient } from "@/lib/supabase/server";
import {
  callerHoldsOrganization,
  notFound,
  toolSession,
} from "@/lib/tools/ownership";
import {
  brandFromDomain,
  isDirectoryDomain,
  isDirectoryTitle,
} from "@/lib/services/directory-domains";
import { ExaService, type SearchCategory } from "@/lib/services/exa-service";
import { resolveOrganizationDomain } from "@/lib/services/domain-resolver";
import { WebExtractionService } from "@/lib/services/web-extraction-service";
import {
  estimateClaudeCostFromUsage,
  trackUsage,
} from "@/lib/services/cost-tracker";
import {
  findOrCreateOrganization,
  linkOrganizationToCampaign,
  mergeEnrichmentData,
  normalizeDomain,
} from "@/lib/services/knowledge-base";
import {
  UNTRUSTED_NOTICE,
  stringify,
  wrapUntrusted,
} from "@/lib/prompt-safety";

/** Parallel website lookups per batch. One paid lookup each, so keep it low. */
/** Paging defaults for the list tools; shared with getContacts. */
export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 200;
/** Long free text is clipped in list rows; the detail tools return it whole. */
export const LIST_TEXT_CLIP = 240;
export function clipText(value: unknown): unknown {
  if (typeof value !== "string" || value.length <= LIST_TEXT_CLIP) return value;
  return value.slice(0, LIST_TEXT_CLIP - 1) + "\u2026";
}

const DOMAIN_RESOLVE_CONCURRENCY = 4;

export const searchCompanies = tool({
  description:
    "Search for companies using Exa semantic search. Stores results in the shared knowledge base. When campaignId is provided, links results to the campaign and deduplicates against existing campaign companies.",
  inputSchema: z.object({
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign to associate results with. Omit for ad-hoc search."),
    query: z.string().min(1).describe("Search query for finding companies"),
    numResults: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Number of results to return"),
    category: z
      .enum([
        "company",
        "research paper",
        "news",
        "pdf",
        "tweet",
        "personal site",
        "financial report",
        "people",
      ])
      .optional()
      .describe("Filter results by category"),
    includeText: z
      .boolean()
      .default(false)
      .describe("Include full page text for richer context"),
  }),
  execute: async (input) => {
    const exa = new ExaService();
    const supabase = await createClient();

    const searchResponse = await exa.search(input.query, {
      numResults: input.numResults,
      category: input.category as SearchCategory | undefined,
      includeText: input.includeText,
    });

    // Fetch existing organizations already linked to this campaign for dedup
    const existingDomains = new Set<string>();
    if (input.campaignId) {
      const { data: existingLinks } = await supabase
        .from("campaign_organizations")
        .select("organization:organizations(domain)")
        .eq("campaign_id", input.campaignId);
      for (const l of existingLinks || []) {
        const d = (
          l.organization as unknown as { domain: string | null } | null
        )?.domain;
        if (d) existingDomains.add(d);
      }
    }

    const results: Array<{
      name: string;
      domain: string | null;
      url: string;
      description: string | null;
    }> = [];
    let duplicatesSkipped = 0;
    const seenDomains = new Set<string>();

    let directoriesFiltered = 0;

    for (const result of searchResponse.results) {
      let domain: string | null = null;
      try {
        domain = normalizeDomain(new URL(result.url).hostname);
      } catch {
        // skip
      }

      // Skip directory / aggregator sites
      if (isDirectoryDomain(domain)) {
        directoriesFiltered++;
        continue;
      }

      // Dedup within batch and against campaign
      if (domain) {
        if (existingDomains.has(domain) || seenDomains.has(domain)) {
          duplicatesSkipped++;
          continue;
        }
        seenDomains.add(domain);
      }

      // Prefer a brand label derived from the apex domain over Exa's raw page
      // <title>, which is often messy ("Mintlify - The Intelligent Knowledge
      // Platform", "Introduction - Mintlify"). Title falls back to identifying
      // directory listings only.
      const name = domain ? brandFromDomain(domain) : result.title || "Unknown";

      if (isDirectoryTitle(result.title || name)) {
        directoriesFiltered++;
        continue;
      }
      const summary = result.summary || result.text?.slice(0, 500) || null;
      const description =
        result.title && summary && !summary.includes(result.title)
          ? `${result.title}: ${summary}`
          : summary || result.title || null;

      const org = await findOrCreateOrganization({
        name,
        domain,
        url: result.url,
        description,
        source: "exa",
      });

      if (input.campaignId) {
        await linkOrganizationToCampaign(org.id, input.campaignId);
      }

      results.push({ name, domain, url: result.url, description });
    }

    return {
      companies: results,
      totalFound: searchResponse.resultCount,
      newCompanies: results.length,
      duplicatesSkipped,
      directoriesFiltered,
      query: input.query,
    };
  },
});

export const getCompanies = tool({
  description:
    "Fetch stored companies for a campaign, best relevance first, with optional status filter. Paginated: default 50 rows, pass offset for the next page (hasMore tells you). Thin rows only (no enrichment_data); for deep detail on one company call getCompanyDetail(organizationId).",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
    status: z
      .enum(["discovered", "qualified", "disqualified"])
      .optional()
      .describe("Filter by company status"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIST_MAX_LIMIT)
      .optional()
      .describe(
        `Rows per page, default ${LIST_DEFAULT_LIMIT}, max ${LIST_MAX_LIMIT}.`,
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Rows to skip (for paging). Default 0."),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const limit = input.limit ?? LIST_DEFAULT_LIMIT;
    const offset = input.offset ?? 0;

    // Name the columns: `organizations(*)` used to pull every row's
    // enrichment_data blob out of Postgres only for the flatten below to
    // drop it, which made a 145-company campaign a multi-megabyte read.
    let query = supabase
      .from("campaign_organizations")
      .select(
        "id, organization_id, campaign_id, relevance_score, score_reason, status, created_at, updated_at, organization:organizations(name, domain, url, industry, location, description, enrichment_status, source)",
        { count: "exact" },
      )
      .eq("campaign_id", input.campaignId)
      .order("relevance_score", { ascending: false });

    if (input.status) {
      query = query.eq("status", input.status);
    }

    const { data, error, count } = await query.range(
      offset,
      offset + limit - 1,
    );

    if (error) throw new Error(`Failed to get companies: ${error.message}`);

    // Flatten for backwards compat with agent expectations
    const companies = (data || []).map((row) => {
      const org = row.organization as unknown as Record<string, unknown>;
      return {
        id: row.id,
        organization_id: row.organization_id,
        campaign_id: row.campaign_id,
        name: org.name,
        domain: org.domain,
        url: org.url,
        industry: org.industry,
        location: org.location,
        description: clipText(org.description),
        enrichment_status: org.enrichment_status,
        relevance_score: row.relevance_score,
        score_reason: clipText(row.score_reason),
        status: row.status,
        source: org.source,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    const total = count ?? offset + companies.length;
    return {
      companies,
      total,
      limit,
      offset,
      hasMore: offset + companies.length < total,
    };
  },
});

export const getCompanyDetail = tool({
  description:
    "Fetch full enrichment detail for ONE company (website extract, Exa results, team data). Use when drafting email content that references the company specifically. Call per-draft, not in a loop.",
  inputSchema: z.object({
    organizationId: z
      .string()
      .uuid()
      .describe("organizations.id (not campaign_organizations.id)."),
  }),
  execute: async ({ organizationId }) => {
    // `organizations` is a shared pool with no owner column, so reading the
    // row says nothing about whether the caller may have it. The campaign link
    // is the only thing that does.
    const session = await toolSession();
    if (!session) {
      return {
        error:
          "No authenticated session available in tool context. Ask the user to sign in.",
      };
    }
    const { supabase, userId } = session;

    if (!(await callerHoldsOrganization(supabase, userId, organizationId))) {
      return notFound("Company");
    }

    const { data, error } = await supabase
      .from("organizations")
      .select(
        "id, name, domain, url, industry, location, description, enrichment_data, enrichment_status",
      )
      .eq("id", organizationId)
      .single();

    if (error || !data) {
      return { error: `Company not found: ${error?.message ?? "no rows"}` };
    }

    return data;
  },
});

export const getCampaignSummary = tool({
  description:
    "Get summary stats for a campaign: companies found, contacts enriched, status breakdown.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    const [campaignResult, companiesResult, contactsResult] = await Promise.all(
      [
        supabase
          .from("campaigns")
          .select("*")
          .eq("id", input.campaignId)
          .single(),
        supabase
          .from("campaign_organizations")
          .select("id, status")
          .eq("campaign_id", input.campaignId),
        supabase
          .from("campaign_people")
          .select("id, person:people(enrichment_status)")
          .eq("campaign_id", input.campaignId),
      ],
    );

    if (campaignResult.error)
      throw new Error(`Campaign not found: ${campaignResult.error.message}`);

    const companies = companiesResult.data || [];
    const contacts = contactsResult.data || [];

    const companyStatusCounts = companies.reduce(
      (acc, c) => {
        acc[c.status] = (acc[c.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const contactStatusCounts = contacts.reduce(
      (acc, c) => {
        const status =
          (c.person as unknown as { enrichment_status: string } | null)
            ?.enrichment_status || "pending";
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      campaign: campaignResult.data,
      stats: {
        totalCompanies: companies.length,
        companiesByStatus: companyStatusCounts,
        totalContacts: contacts.length,
        contactsByStatus: contactStatusCounts,
      },
    };
  },
});

// ── Industry directory knowledge base ─────────────────────────────────────
// Maps business categories to well-known directory domains that list them.
// The tool uses these to build targeted site: queries and direct scrape URLs,
// producing much higher-quality results than generic "directory list" queries.
const INDUSTRY_DIRECTORIES: Record<string, string[]> = {
  // Property / Real estate
  "estate agent": [
    "rightmove.co.uk",
    "zoopla.co.uk",
    "onthemarket.com",
    "yell.com",
  ],
  "estate agency": [
    "rightmove.co.uk",
    "zoopla.co.uk",
    "onthemarket.com",
    "yell.com",
  ],
  "letting agent": [
    "rightmove.co.uk",
    "zoopla.co.uk",
    "openrent.com",
    "yell.com",
  ],
  "property management": ["rightmove.co.uk", "zoopla.co.uk", "yell.com"],
  // Healthcare
  "dental practice": [
    "nhs.uk",
    "dentalguide.co.uk",
    "mydentist.co.uk",
    "yell.com",
  ],
  dentist: ["nhs.uk", "dentalguide.co.uk", "bda.org", "yell.com"],
  doctor: ["nhs.uk", "iwantgreatcare.org", "yell.com"],
  "gp surgery": ["nhs.uk", "yell.com"],
  physiotherapist: ["csp.org.uk", "physio-pedia.com", "yell.com"],
  chiropractor: ["gcc-uk.org", "yell.com"],
  optician: ["yell.com", "specsavers.co.uk"],
  veterinary: ["rcvs.org.uk", "yell.com", "vets-now.com"],
  // Legal
  solicitor: ["lawsociety.org.uk", "solicitors.guru", "yell.com"],
  lawyer: ["lawsociety.org.uk", "solicitors.guru", "yell.com"],
  "law firm": ["lawsociety.org.uk", "chambers.com", "legal500.com", "yell.com"],
  // Finance
  accountant: ["icaew.com", "acca.com", "yell.com"],
  "financial adviser": ["unbiased.co.uk", "vouchedfor.co.uk", "yell.com"],
  "mortgage broker": ["unbiased.co.uk", "yell.com"],
  // Trades / Home services
  plumber: ["checkatrade.com", "trustatrader.com", "mybuilder.com", "yell.com"],
  electrician: [
    "checkatrade.com",
    "trustatrader.com",
    "mybuilder.com",
    "yell.com",
  ],
  builder: ["checkatrade.com", "trustatrader.com", "mybuilder.com", "yell.com"],
  roofer: ["checkatrade.com", "trustatrader.com", "yell.com"],
  locksmith: ["checkatrade.com", "yell.com"],
  // Food / Hospitality
  restaurant: [
    "tripadvisor.co.uk",
    "thefork.co.uk",
    "opentable.co.uk",
    "google.com/maps",
  ],
  cafe: ["tripadvisor.co.uk", "yell.com"],
  hotel: ["tripadvisor.co.uk", "booking.com", "hotels.com"],
  "wedding venue": ["hitched.co.uk", "bridebook.com", "yell.com"],
  // Automotive
  "car dealer": ["autotrader.co.uk", "motors.co.uk", "yell.com"],
  garage: ["goodgaragescheme.com", "checkatrade.com", "yell.com"],
  "mot centre": ["goodgaragescheme.com", "yell.com"],
  // Education / Childcare
  nursery: ["daynurseries.co.uk", "ofsted.gov.uk", "yell.com"],
  "driving school": ["approveddriving.co.uk", "yell.com"],
  tutor: ["thetutorwebsite.co.uk", "firsttutors.com", "yell.com"],
  // Beauty / Wellness
  "beauty salon": ["treatwell.co.uk", "fresha.com", "yell.com"],
  "hair salon": ["treatwell.co.uk", "fresha.com", "yell.com"],
  gym: ["hussle.com", "puregym.com", "yell.com"],
  spa: ["treatwell.co.uk", "spabreaks.com", "yell.com"],
  // Recruitment
  "recruitment agency": ["rec.uk.com", "yell.com", "reed.co.uk"],
  // Marketing / Creative
  "marketing agency": ["clutch.co", "themanifest.com", "sortlist.co.uk"],
  "web design": ["clutch.co", "themanifest.com", "sortlist.co.uk"],
  "seo agency": ["clutch.co", "themanifest.com"],
  // IT
  "it support": ["clutch.co", "techradar.com", "yell.com"],
  "managed service provider": ["clutch.co", "channele2e.com"],
};

/**
 * Look up directory domains for an industry string. Tries exact match first,
 * then falls back to partial keyword matching.
 */
function findDirectoriesForIndustry(industry: string): string[] {
  const lower = industry.toLowerCase();
  // Exact match
  if (INDUSTRY_DIRECTORIES[lower]) return INDUSTRY_DIRECTORIES[lower];
  // Partial: check if any key is contained in the input or vice-versa
  for (const [key, dirs] of Object.entries(INDUSTRY_DIRECTORIES)) {
    if (lower.includes(key) || key.includes(lower)) return dirs;
  }
  return [];
}

export const discoverCompanies = tool({
  description:
    "Smart company discovery that searches for directories and lists of businesses first, then scrapes those pages to extract individual companies. Knows about industry-specific directories (Rightmove for estate agents, Checkatrade for tradespeople, Law Society for solicitors, etc.) and targets them directly. Much more effective than direct search for local/regional businesses. Use this as the PRIMARY tool when the user asks to find companies in a specific area or industry. Works with or without a campaign.",
  inputSchema: z.object({
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign to associate results with. Omit for ad-hoc search."),
    industry: z
      .string()
      .describe(
        "Industry or business type, e.g. 'estate agents', 'dental practices', 'plumbers'",
      ),
    location: z
      .string()
      .describe(
        "Geographic area, e.g. 'West Midlands', 'Birmingham', 'Manchester'",
      ),
    additionalContext: z
      .string()
      .optional()
      .describe("Extra context for search, e.g. 'independent agencies only'"),
  }),
  execute: async (input) => {
    const exa = new ExaService();
    const extractor = new WebExtractionService();
    const supabase = await createClient();

    // Fetch existing domains linked to this campaign for dedup
    const existingDomains = new Set<string>();
    if (input.campaignId) {
      const { data: existingLinks } = await supabase
        .from("campaign_organizations")
        .select("organization:organizations(domain)")
        .eq("campaign_id", input.campaignId);
      for (const l of existingLinks || []) {
        const d = (
          l.organization as unknown as { domain: string | null } | null
        )?.domain;
        if (d) existingDomains.add(d);
      }
    }

    // Step 1: Build smart directory queries
    const knownDirs = findDirectoriesForIndustry(input.industry);

    const directoryQueries: string[] = [];

    // Targeted site: queries for known directories (highest signal)
    for (const dir of knownDirs.slice(0, 3)) {
      directoryQueries.push(`${input.industry} ${input.location} site:${dir}`);
    }

    // Generic fallback queries
    directoryQueries.push(
      `${input.industry} in ${input.location} directory list`,
      `best ${input.industry} ${input.location}`,
    );

    if (directoryQueries.length < 5) {
      directoryQueries.push(`${input.industry} near ${input.location} reviews`);
    }

    const directoryResults = await Promise.allSettled(
      directoryQueries.map((q) =>
        exa.search(q, { numResults: 5, includeText: true }),
      ),
    );

    // Collect all directory/list pages to scrape
    const pagesToScrape: Array<{
      url: string;
      title: string;
      text: string | null;
    }> = [];
    const seenUrls = new Set<string>();

    for (const result of directoryResults) {
      if (result.status !== "fulfilled") continue;
      for (const r of result.value.results) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        pagesToScrape.push({ url: r.url, title: r.title, text: r.text });
      }
    }

    // Step 2: Scrape directory pages for richer content
    const scrapedContent: Array<{ url: string; content: string }> = [];

    const toScrape = pagesToScrape.slice(0, 6);
    const scrapeResults = await Promise.allSettled(
      toScrape.map(async (page) => {
        if (page.text && page.text.length > 500) {
          return { url: page.url, content: page.text };
        }
        const extracted = await extractor.extract(page.url, {
          includeLinks: true,
        });
        if (extracted.success) {
          return {
            url: page.url,
            content: extracted.data.content.slice(0, 5000),
          };
        }
        return { url: page.url, content: page.text || "" };
      }),
    );

    for (const result of scrapeResults) {
      if (result.status === "fulfilled" && result.value.content) {
        scrapedContent.push(result.value);
      }
    }

    if (scrapedContent.length === 0) {
      return {
        companies: [],
        totalFound: 0,
        newCompanies: 0,
        duplicatesSkipped: 0,
        directoriesSearched: pagesToScrape.length,
        message:
          "No directory pages could be scraped. Try a different location or industry.",
      };
    }

    // Step 3: Use LLM to extract individual companies from the scraped content
    const combinedContent = scrapedContent
      .map((s) => `--- Source: ${s.url} ---\n${s.content}`)
      .join("\n\n");

    const { object: extracted, usage } = await generateObject({
      // K17: without a timeout a hung extraction pins the whole tool call.
      abortSignal: llmTimeout(),
      model: anthropic(MODELS.LIGHT),
      schema: apiSafeSchema(
        z.object({
          companies: z.array(
            z.object({
              name: z.string().describe("Business name"),
              domain: z
                .string()
                .nullable()
                .describe("Website domain without protocol, e.g. 'acme.co.uk'"),
              url: z.string().nullable().describe("Full website URL if found"),
              location: z
                .string()
                .nullable()
                .describe("Specific location/address if mentioned"),
              industry: z
                .string()
                .nullable()
                .describe("Industry or specialization"),
              description: z
                .string()
                .nullable()
                .describe("Brief description if available"),
            }),
          ),
        }),
      ),
      prompt: `Extract individual ${stringify(input.industry)} businesses from the following directory/list pages. Only extract businesses that are actually located in or near ${stringify(input.location)}.${input.additionalContext ? ` Additional filter: ${stringify(input.additionalContext)}` : ""}

${UNTRUSTED_NOTICE}

Rules:
- Only extract ACTUAL individual businesses, not directory sites or aggregator platforms
- Each business should be a distinct entity (not a duplicate with a slightly different name)
- Clean up names: remove "| Dentist in ..." suffixes, remove "Ltd" unless it's part of the brand
- Extract the business's own website domain, NOT the directory URL
- If a business appears multiple times across sources, only include it once
- Skip any business that doesn't match the target industry or location

Scraped directory content:
${wrapUntrusted(combinedContent.slice(0, 15000))}`,
    });

    trackUsage({
      service: "claude",
      operation: "discoverCompanies-extract",
      tokens_input: usage.inputTokens ?? 0,
      tokens_output: usage.outputTokens ?? 0,
      estimated_cost_usd: estimateClaudeCostFromUsage("haiku", usage),
      metadata: { model: "claude-haiku-4-5" },
    });

    // Step 4: Deduplicate and store via knowledge base
    const seenDomains = new Set<string>();
    const newCompanies: typeof extracted.companies = [];
    let duplicatesSkipped = 0;

    for (const c of extracted.companies) {
      const domain = c.domain ? normalizeDomain(c.domain) : null;

      // Skip directory/aggregator domains that the LLM mistakenly extracted
      if (isDirectoryDomain(domain)) continue;
      // Skip names that look like directory listings
      if (isDirectoryTitle(c.name)) continue;

      if (domain) {
        if (existingDomains.has(domain) || seenDomains.has(domain)) {
          duplicatesSkipped++;
          continue;
        }
        seenDomains.add(domain);
      }
      newCompanies.push(c);
    }

    // Resolve the ones the directory listed without a website.
    //
    // A listing routinely carries no site for the business, and a company with
    // no domain cannot hold contacts at all, so storing them as-is created
    // campaigns that were structurally incapable of holding a lead. Bounded
    // concurrency because this is one paid lookup per company, and every
    // failure is swallowed inside the resolver: an unresolved company is still
    // a real lead, and the campaign page can fix it by hand.
    const needResolving = newCompanies.filter((c) => !c.domain);
    let domainsResolved = 0;
    for (let i = 0; i < needResolving.length; i += DOMAIN_RESOLVE_CONCURRENCY) {
      const batch = needResolving.slice(i, i + DOMAIN_RESOLVE_CONCURRENCY);
      const found = await Promise.all(
        batch.map((c) =>
          resolveOrganizationDomain({
            name: c.name,
            location: c.location,
            industry: c.industry || input.industry,
          }),
        ),
      );
      for (const [index, resolved] of found.entries()) {
        if (!resolved) continue;
        batch[index].domain = resolved.domain;
        batch[index].url = resolved.url;
        domainsResolved++;
      }
    }
    const domainsStillMissing = needResolving.length - domainsResolved;
    if (needResolving.length > 0) {
      console.log(
        `[discoverCompanies] ${domainsResolved}/${needResolving.length} missing websites resolved; ${domainsStillMissing} still unusable for contacts.`,
      );
    }

    // Create orgs and link to campaign
    for (const c of newCompanies) {
      const domain = c.domain ? normalizeDomain(c.domain) : null;
      const org = await findOrCreateOrganization({
        name: c.name,
        domain,
        url: c.url || (domain ? `https://${domain}` : null),
        location: c.location,
        industry: c.industry || input.industry,
        description: c.description,
        source: "directory_discovery",
      });
      if (input.campaignId) {
        await linkOrganizationToCampaign(org.id, input.campaignId);
      }
    }

    return {
      companies: newCompanies.map((c) => ({
        name: c.name,
        domain: c.domain,
        url: c.url,
        location: c.location,
        industry: c.industry,
        description: c.description,
      })),
      totalFound: extracted.companies.length,
      newCompanies: newCompanies.length,
      duplicatesSkipped,
      directoriesSearched: scrapedContent.length,
      queries: directoryQueries,
      domainsResolved,
      // Companies that still cannot hold a contact. Silence here reads as "12
      // companies found" when none of the 12 is usable, which is the report
      // this whole change came from.
      domainsStillMissing,
    };
  },
});

export const searchYCCompanies = tool({
  description:
    "Search Y Combinator's company directory for startups by batch, industry, region, or keywords. Checks the local database first for cached results. If not cached, scrapes the YC directory with a browser. Stores results in the knowledge base. When campaignId is provided, links results to the campaign.",
  inputSchema: z.object({
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign to associate results with. Omit for ad-hoc search."),
    batch: z
      .string()
      .optional()
      .describe(
        "YC batch filter, e.g. 'Winter 2025', 'Summer 2025'. Use full season + year format.",
      ),
    industry: z
      .string()
      .optional()
      .describe(
        "Industry filter, e.g. 'B2B', 'Consumer', 'Fintech', 'Healthcare', 'Education', 'Industrials'",
      ),
    region: z
      .string()
      .optional()
      .describe(
        "Region filter, e.g. 'America / Canada', 'Europe', 'South Asia', 'Remote'",
      ),
    teamSize: z
      .string()
      .optional()
      .describe("Team size filter, e.g. '1-10', '11-50', '51-200'"),
    isHiring: z
      .boolean()
      .optional()
      .describe("Only show companies that are currently hiring"),
    query: z
      .string()
      .optional()
      .describe("Free text search query, e.g. 'AI infrastructure'"),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(30)
      .describe("Maximum number of companies to return"),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    // ── Step 1: Check cache ──────────────────────────────────────────────
    // The cache stores only what it can filter on (batch, industry). A
    // request carrying region, teamSize, isHiring, or a query MUST scrape:
    // the old path matched every cached row for the batch regardless of the
    // finer filters, auto-linked the non-matching companies to the campaign,
    // and reported them as matches. And a partial cache must not
    // short-circuit either: one cached row for a batch used to suppress the
    // scrape for a 30-company request with no hint more exist.
    const cacheable =
      !input.region &&
      !input.teamSize &&
      input.isHiring === undefined &&
      !input.query;

    interface CachedOrg {
      id: string;
      name: string;
      domain: string | null;
      url: string | null;
      industry: string | null;
      location: string | null;
      description: string | null;
      enrichment_data: Record<string, unknown> | null;
    }
    let cachedOrgs: CachedOrg[] = [];
    if (cacheable) {
      let cacheQuery = supabase
        .from("organizations")
        .select("*")
        .eq("source", "yc_directory");

      if (input.batch) {
        cacheQuery = cacheQuery.eq(
          "enrichment_data->yc->>batch",
          input.batch.toUpperCase(),
        );
      }
      if (input.industry) {
        cacheQuery = cacheQuery.ilike("industry", `%${input.industry}%`);
      }

      const { data: cached } = await cacheQuery.limit(input.maxResults);
      cachedOrgs = (cached || []) as CachedOrg[];
    }

    if (cachedOrgs.length >= input.maxResults) {
      let newlyLinked = 0;
      if (input.campaignId) {
        const { data: existingLinks } = await supabase
          .from("campaign_organizations")
          .select("organization_id")
          .eq("campaign_id", input.campaignId);

        const alreadyLinked = new Set(
          (existingLinks || []).map((l) => l.organization_id),
        );

        for (const org of cachedOrgs) {
          if (!alreadyLinked.has(org.id)) {
            await linkOrganizationToCampaign(org.id, input.campaignId);
            newlyLinked++;
          }
        }
      }

      return {
        source: "cache" as const,
        companies: cachedOrgs.map((org) => ({
          name: org.name,
          domain: org.domain,
          url: org.url,
          industry: org.industry,
          location: org.location,
          description: org.description,
          yc: (org.enrichment_data as Record<string, unknown>)?.yc || null,
        })),
        totalFound: cachedOrgs.length,
        newlyLinked,
      };
    }

    // ── Step 2: Cache miss -- scrape ─────────────────────────────────────
    const { scrapeYCCompanies } = await import("@/lib/services/yc-scraper");

    const result = await scrapeYCCompanies(
      {
        batch: input.batch,
        industry: input.industry,
        region: input.region,
        teamSize: input.teamSize,
        isHiring: input.isHiring,
        query: input.query,
      },
      input.maxResults,
    );

    // Dedup against existing campaign orgs
    const existingDomains = new Set<string>();
    if (input.campaignId) {
      const { data: existingLinks } = await supabase
        .from("campaign_organizations")
        .select("organization:organizations(domain)")
        .eq("campaign_id", input.campaignId);
      for (const l of existingLinks || []) {
        const d = (
          l.organization as unknown as { domain: string | null } | null
        )?.domain;
        if (d) existingDomains.add(d);
      }
    }

    const seenDomains = new Set<string>();
    const stored: typeof result.companies = [];
    let duplicatesSkipped = 0;

    for (const company of result.companies) {
      const domain = company.url
        ? normalizeDomain(
            company.url.replace(/^https?:\/\//, "").replace(/\/+$/, ""),
          )
        : null;

      if (domain) {
        if (existingDomains.has(domain) || seenDomains.has(domain)) {
          duplicatesSkipped++;
          continue;
        }
        seenDomains.add(domain);
      }

      const org = await findOrCreateOrganization({
        name: company.name,
        domain,
        url: company.url,
        industry: company.industry,
        location: company.location,
        description: company.oneLiner,
        source: "yc_directory",
      });

      await mergeEnrichmentData("organizations", org.id, {
        yc: {
          batch: company.batch,
          ycUrl: company.ycUrl,
          longDescription: company.longDescription,
          founders: company.founders,
          teamSize: company.teamSize,
          isHiring: company.isHiring,
          scrapedAt: new Date().toISOString(),
        },
      });

      if (input.campaignId) {
        await linkOrganizationToCampaign(org.id, input.campaignId);
      }
      stored.push(company);
    }

    return {
      source: "scrape" as const,
      companies: stored.map((c) => ({
        name: c.name,
        domain: c.url
          ? normalizeDomain(
              c.url.replace(/^https?:\/\//, "").replace(/\/+$/, ""),
            )
          : null,
        url: c.url,
        industry: c.industry,
        location: c.location,
        description: c.oneLiner,
        yc: {
          batch: c.batch,
          ycUrl: c.ycUrl,
          longDescription: c.longDescription,
          founders: c.founders,
          teamSize: c.teamSize,
          isHiring: c.isHiring,
        },
      })),
      totalFound: result.totalCards,
      newCompanies: stored.length,
      duplicatesSkipped,
      directoryUrl: result.directoryUrl,
    };
  },
});
