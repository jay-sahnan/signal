import { tool } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseLinkedInTitle } from "@/lib/utils";
import { ExaService } from "@/lib/services/exa-service";
import { filterRelevantResults } from "@/lib/services/relevance-filter";
import { LinkedinService } from "@/lib/services/linkedin-service";
import { XService } from "@/lib/services/x-service";
import { WebExtractionService } from "@/lib/services/web-extraction-service";
import { GooglePlacesService } from "@/lib/services/google-places-service";
import {
  findOrCreatePerson,
  linkPersonToCampaign,
  mergeEnrichmentData,
  isRecentlyEnriched,
  normalizeLinkedInUrl,
} from "@/lib/services/knowledge-base";
import {
  findPeopleOnDomain,
  filterContactsByCompany,
  type CandidateContact,
} from "@/lib/services/contact-filter";

export const searchPeople = tool({
  description:
    "Search for people at companies using Exa semantic search with LinkedIn-focused queries. Stores results in the shared knowledge base. When campaignId is provided, links results to the campaign and deduplicates against existing campaign contacts.",
  inputSchema: z.object({
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign to associate results with. Omit for ad-hoc search."),
    companyId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign-organization link ID to associate contacts with"),
    query: z
      .string()
      .min(1)
      .describe(
        'Search query for finding people, e.g. "CTO at Acme Corp site:linkedin.com"',
      ),
    numResults: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe("Number of results to return"),
  }),
  execute: async (input) => {
    const exa = new ExaService();
    const supabase = await createClient();

    const searchResponse = await exa.search(input.query, {
      numResults: input.numResults,
      category: "people",
      includeText: true,
    });

    // Resolve organization_id if companyId (campaign_organizations link) is provided
    let organizationId: string | null = null;
    if (input.companyId) {
      const { data: link } = await supabase
        .from("campaign_organizations")
        .select("organization_id")
        .eq("id", input.companyId)
        .single();
      organizationId = link?.organization_id || null;
    }

    // Fetch existing linkedin_urls already linked to this campaign for dedup
    const existingUrls = new Set<string>();
    if (input.campaignId) {
      const { data: existingLinks } = await supabase
        .from("campaign_people")
        .select("person:people(linkedin_url)")
        .eq("campaign_id", input.campaignId);
      for (const l of existingLinks || []) {
        const url = (
          l.person as unknown as { linkedin_url: string | null } | null
        )?.linkedin_url;
        if (url) existingUrls.add(url);
      }
    }

    const storedContacts: Array<{
      id: string;
      name: string;
      title: string | null;
      linkedin_url: string | null;
    }> = [];
    let duplicatesSkipped = 0;
    const seenUrls = new Set<string>();

    for (const result of searchResponse.results) {
      const { name, title } = parseLinkedInTitle(result.title);
      const rawLinkedinUrl = result.url.includes("linkedin.com")
        ? result.url
        : null;
      const linkedinUrl = rawLinkedinUrl
        ? normalizeLinkedInUrl(rawLinkedinUrl)
        : null;

      // Dedup
      if (linkedinUrl) {
        if (existingUrls.has(linkedinUrl) || seenUrls.has(linkedinUrl)) {
          duplicatesSkipped++;
          continue;
        }
        seenUrls.add(linkedinUrl);
      }

      const person = await findOrCreatePerson({
        name,
        title,
        linkedin_url: linkedinUrl,
        organization_id: organizationId,
        source: "exa",
      });

      // Store initial search data if person is new (no enrichment yet)
      if (person.enrichment_status === "pending") {
        await supabase
          .from("people")
          .update({
            enrichment_data: {
              searchQuery: input.query,
              rawTitle: result.title,
              text: result.text?.slice(0, 1000),
            },
          })
          .eq("id", person.id);
      }

      if (input.campaignId) {
        await linkPersonToCampaign(person.id, input.campaignId);
      }

      storedContacts.push({
        id: person.id,
        name: person.name,
        title: person.title,
        linkedin_url: person.linkedin_url,
      });
    }

    return {
      contacts: storedContacts.map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        linkedinUrl: c.linkedin_url,
      })),
      totalFound: searchResponse.resultCount,
      newContacts: storedContacts.length,
      duplicatesSkipped,
      query: input.query,
    };
  },
});

export function summarizeContactEnrichment(
  data: Record<string, unknown>,
): Record<string, number | boolean> {
  const s: Record<string, number | boolean> = {};
  if (data.linkedin) s.hasLinkedin = true;
  if (data.twitter) s.hasTwitter = true;
  if (Array.isArray(data.news)) s.news = data.news.length;
  if (Array.isArray(data.articles)) s.articles = data.articles.length;
  if (Array.isArray(data.background)) s.background = data.background.length;
  if (data.discoveredEmail) s.discoveredEmail = true;
  return s;
}

async function enrichContactById(
  personId: string,
  linkedinUrl?: string,
  twitterUrl?: string,
): Promise<{
  contactId: string;
  status: string;
  summary: Record<string, number | boolean>;
  skipped?: boolean;
  errors?: string[];
}> {
  const supabase = await createClient();

  // Check recency -- skip if recently enriched
  const recent = await isRecentlyEnriched("people", personId);
  if (recent) {
    const { data: person } = await supabase
      .from("people")
      .select("enrichment_data")
      .eq("id", personId)
      .single();
    return {
      contactId: personId,
      status: "enriched",
      summary: summarizeContactEnrichment(
        (person?.enrichment_data as Record<string, unknown>) || {},
      ),
      skipped: true,
    };
  }

  const { data: person } = await supabase
    .from("people")
    .select(
      "name, title, linkedin_url, twitter_url, organization:organizations(name)",
    )
    .eq("id", personId)
    .single();

  const contactName = person?.name || "Unknown";
  const companyName =
    (person?.organization as unknown as { name?: string } | null)?.name || null;
  const linkedinFinal = linkedinUrl || person?.linkedin_url || undefined;
  const twitterFinal = twitterUrl || person?.twitter_url || undefined;

  await supabase
    .from("people")
    .update({ enrichment_status: "in_progress" })
    .eq("id", personId);

  const enrichmentData: Record<string, unknown> = {};
  const errors: string[] = [];
  const promises: Promise<void>[] = [];

  if (linkedinFinal) {
    promises.push(
      (async () => {
        try {
          const linkedin = new LinkedinService();
          const scrapeResult = await linkedin.scrapeProfile(linkedinFinal);
          enrichmentData.linkedin = {
            profileInfo: scrapeResult.profile || null,
            posts: scrapeResult.posts.slice(0, 10),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error(`[enrichContact] LinkedIn scrape failed: ${msg}`);
          errors.push(`LinkedIn: ${msg}`);
        }
      })(),
    );
  }

  if (twitterFinal) {
    promises.push(
      (async () => {
        try {
          const x = new XService();
          const result = await x.enrichTwitterProfile(twitterFinal);
          enrichmentData.twitter = {
            user: result.user,
            tweets: result.tweets.slice(0, 10),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error(`[enrichContact] Twitter enrich failed: ${msg}`);
          errors.push(`Twitter: ${msg}`);
        }
      })(),
    );
  }

  if (contactName !== "Unknown") {
    const exa = new ExaService();
    const contactTitle = person?.title || null;
    const queryParts = [`"${contactName}"`];
    if (companyName) queryParts.push(`"${companyName}"`);
    if (contactTitle) queryParts.push(contactTitle);
    const specificQuery = queryParts.join(" ");

    // Collect URLs already in the company's enrichment data so we don't
    // show the same links on both the company and contact cards.
    const companyUrls = new Set<string>();
    if (person?.organization) {
      const orgName = (person.organization as unknown as { name?: string })
        ?.name;
      if (orgName) {
        const { data: orgRow } = await supabase
          .from("organizations")
          .select("enrichment_data")
          .eq("name", orgName)
          .maybeSingle();

        const orgEnrichment = orgRow?.enrichment_data as Record<
          string,
          unknown
        > | null;
        if (orgEnrichment) {
          const searches = orgEnrichment.searches as
            | Array<{ results: Array<{ url: string }> }>
            | undefined;
          if (searches) {
            for (const s of searches) {
              for (const r of s.results) {
                if (r.url) companyUrls.add(r.url);
              }
            }
          }
        }
      }
    }

    const dedup = (
      results: Array<{
        title: string;
        url: string;
        publishedDate: string | null;
        text: string | null;
      }>,
    ) => results.filter((r) => !companyUrls.has(r.url));

    promises.push(
      (async () => {
        try {
          const result = await exa.search(
            `${specificQuery} news announcement`,
            { numResults: 3, includeText: true, category: "news" },
          );
          enrichmentData.news = dedup(
            result.results.map((r) => ({
              title: r.title,
              url: r.url,
              publishedDate: r.publishedDate,
              text: r.text || null,
            })),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          errors.push(`News: ${msg}`);
        }
      })(),
    );

    promises.push(
      (async () => {
        try {
          const result = await exa.search(
            `${specificQuery} article talk interview podcast`,
            { numResults: 3, includeText: true },
          );
          enrichmentData.articles = dedup(
            result.results.map((r) => ({
              title: r.title,
              url: r.url,
              publishedDate: r.publishedDate,
              text: r.text || null,
            })),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          errors.push(`Articles: ${msg}`);
        }
      })(),
    );

    promises.push(
      (async () => {
        try {
          const result = await exa.search(
            `${specificQuery} background bio profile`,
            { numResults: 3, includeText: true },
          );
          enrichmentData.background = dedup(
            result.results.map((r) => ({
              title: r.title,
              url: r.url,
              publishedDate: r.publishedDate,
              text: r.text || null,
            })),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          errors.push(`Background: ${msg}`);
        }
      })(),
    );
  }

  await Promise.all(promises);

  const status = Object.keys(enrichmentData).length > 0 ? "enriched" : "failed";

  await mergeEnrichmentData(
    "people",
    personId,
    enrichmentData,
    status as "enriched" | "failed",
  );

  // ── Email discovery ──────────────────────────────────────────────────
  // If the contact has no email after enrichment, try to find one.
  const { data: personAfter } = await supabase
    .from("people")
    .select("work_email, personal_email")
    .eq("id", personId)
    .single();

  if (!personAfter?.work_email && !personAfter?.personal_email) {
    try {
      const { findEmailForPerson } = await import("@/lib/tools/email-tools");
      const emailResult = await findEmailForPerson(personId);
      if (emailResult.email) {
        enrichmentData.discoveredEmail = emailResult.email;
      }
    } catch {
      // Email discovery is best-effort -- don't fail enrichment
    }
  }

  return {
    contactId: personId,
    status,
    summary: summarizeContactEnrichment(enrichmentData),
    errors: errors.length > 0 ? errors : undefined,
  };
}

export const enrichContact = tool({
  description:
    "Enrich a single contact and write results to the DB. Returns a THIN summary (counts of news/articles, has-linkedin flags) -- NOT the full enrichment payload. If you need to read the enriched content (e.g. to personalize an email), call getContactDetail(personId). For multiple contacts, use enrichContacts (parallel). Skips if recently enriched (<7 days).",
  inputSchema: z.object({
    contactId: z.string().uuid().describe("Person ID to enrich"),
    linkedinUrl: z
      .string()
      .optional()
      .describe(
        "LinkedIn profile URL (if omitted, uses the one stored on the person)",
      ),
    twitterUrl: z
      .string()
      .optional()
      .describe(
        "Twitter/X profile URL (if omitted, uses the one stored on the person)",
      ),
  }),
  execute: async (input) =>
    enrichContactById(input.contactId, input.linkedinUrl, input.twitterUrl),
});

export const enrichContacts = tool({
  description:
    "Enrich multiple contacts IN PARALLEL. Much faster than calling enrichContact one by one. Skips any person recently enriched (within 7 days).",
  inputSchema: z.object({
    contactIds: z
      .array(z.string().uuid())
      .min(1)
      .max(10)
      .describe("Array of person IDs to enrich (max 10)"),
  }),
  execute: async (input) => {
    const succeeded: Array<{
      contactId: string;
      status: string;
      skipped?: boolean;
    }> = [];
    const failed: Array<{ contactId: string; error: string }> = [];

    // Process in chunks of 3 to stay under Exa's 10 QPS limit
    // (each contact makes 3-4 Exa searches)
    const CHUNK_SIZE = 3;
    for (let i = 0; i < input.contactIds.length; i += CHUNK_SIZE) {
      const chunk = input.contactIds.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map((id) => enrichContactById(id)),
      );

      results.forEach((result, j) => {
        if (result.status === "fulfilled") {
          succeeded.push({
            contactId: result.value.contactId,
            status: result.value.status,
            skipped: result.value.skipped,
          });
        } else {
          failed.push({
            contactId: chunk[j],
            error:
              result.reason instanceof Error
                ? result.reason.message
                : "Unknown error",
          });
        }
      });
    }

    return {
      total: input.contactIds.length,
      succeeded: succeeded.length,
      failed: failed.length,
      results: succeeded,
      errors: failed.length > 0 ? failed : undefined,
    };
  },
});

export const fetchSitemap = tool({
  description:
    "Fetch and parse a website's sitemap to discover available pages. Returns a list of URLs with last-modified dates. Use this to understand what content a company has on their site, then selectively fetch the most relevant pages with extractWebContent.",
  inputSchema: z.object({
    domain: z
      .string()
      .describe(
        "Domain to fetch sitemap from (e.g. 'acme.com'). Will try /sitemap.xml and /sitemap_index.xml.",
      ),
  }),
  execute: async (input) => {
    const domain = input.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const urls: Array<{ url: string; lastmod?: string; priority?: string }> =
      [];
    const errors: string[] = [];

    const sitemapUrls = [
      `https://${domain}/sitemap.xml`,
      `https://${domain}/sitemap_index.xml`,
    ];

    for (const sitemapUrl of sitemapUrls) {
      try {
        const response = await fetch(sitemapUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; FridayBot/1.0)",
            Accept: "application/xml, text/xml, */*",
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) continue;

        const text = await response.text();
        if (!text.includes("<urlset") && !text.includes("<sitemapindex"))
          continue;

        const cheerio = await import("cheerio");
        const $ = cheerio.load(text, { xmlMode: true });

        // Handle sitemap index -- collect child sitemap URLs
        const childSitemaps: string[] = [];
        $("sitemapindex > sitemap > loc").each((_, el) => {
          childSitemaps.push($(el).text().trim());
        });

        if (childSitemaps.length > 0) {
          // Fetch up to 3 child sitemaps
          const childResults = await Promise.allSettled(
            childSitemaps.slice(0, 3).map(async (childUrl) => {
              const res = await fetch(childUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (compatible; FridayBot/1.0)",
                },
                signal: AbortSignal.timeout(10000),
              });
              if (!res.ok) return;
              const childText = await res.text();
              const child$ = cheerio.load(childText, { xmlMode: true });
              child$("url").each((_, el) => {
                urls.push({
                  url: child$(el).find("loc").text().trim(),
                  lastmod:
                    child$(el).find("lastmod").text().trim() || undefined,
                  priority:
                    child$(el).find("priority").text().trim() || undefined,
                });
              });
            }),
          );
          for (const r of childResults) {
            if (r.status === "rejected") {
              errors.push(r.reason?.message || "Child sitemap failed");
            }
          }
        }

        // Handle regular sitemap
        $("urlset > url").each((_, el) => {
          urls.push({
            url: $(el).find("loc").text().trim(),
            lastmod: $(el).find("lastmod").text().trim() || undefined,
            priority: $(el).find("priority").text().trim() || undefined,
          });
        });

        if (urls.length > 0) break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`${sitemapUrl}: ${msg}`);
      }
    }

    // If no sitemap found, fall back to fetching homepage links
    if (urls.length === 0) {
      try {
        const extractor = new WebExtractionService();
        const result = await extractor.extract(`https://${domain}`, {
          includeLinks: true,
        });
        if (result.success && result.data.links) {
          const sameDomainLinks = result.data.links.filter((link) => {
            try {
              return new URL(link).hostname.endsWith(domain);
            } catch {
              return false;
            }
          });
          return {
            domain,
            source: "homepage_links",
            urls: sameDomainLinks.slice(0, 50).map((url) => ({ url })),
            total: sameDomainLinks.length,
            errors: errors.length > 0 ? errors : undefined,
          };
        }
      } catch {
        // ignore
      }
    }

    return {
      domain,
      source: urls.length > 0 ? "sitemap" : "none",
      urls: urls.slice(0, 100),
      total: urls.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
});

export const extractWebContent = tool({
  description:
    "Extract content from a web page. Three-tier fallback: (1) direct HTTP fetch, (2) Browserbase Fetch with proxies, (3) full browser session. Returns TRUNCATED content (first 3000 chars) and up to 20 links to keep context small. `truncated` flags indicate if more exists — if you need more, refine the URL or call a different page. Use for About/Team/Leadership pages when finding contacts.",
  inputSchema: z.object({
    url: z.string().url().describe("URL to extract content from"),
    includeLinks: z
      .boolean()
      .default(false)
      .describe("Include all links found on the page"),
  }),
  execute: async (input, { toolCallId, experimental_context }) => {
    const ctx = experimental_context as
      | { writer?: { write: (chunk: unknown) => void } }
      | undefined;
    const writer = ctx?.writer;

    const extractor = new WebExtractionService();
    const raw = await extractor.extract(input.url, {
      includeLinks: input.includeLinks,
      onLiveView: writer
        ? (liveViewUrl) =>
            writer.write({
              type: "data-browserbaseLiveView",
              id: toolCallId,
              data: { url: liveViewUrl },
              transient: true,
            })
        : undefined,
    });

    if (!raw.success) return raw;

    const MAX_CONTENT = 3000;
    const MAX_LINKS = 20;
    const fullContent = raw.data.content ?? "";
    const fullLinks = raw.data.links ?? [];
    const truncated = {
      content: fullContent.length > MAX_CONTENT,
      links: fullLinks.length > MAX_LINKS,
    };

    return {
      ...raw,
      data: {
        ...raw.data,
        content: fullContent.slice(0, MAX_CONTENT),
        links: input.includeLinks ? fullLinks.slice(0, MAX_LINKS) : undefined,
      },
      truncated,
    };
  },
});

export const scrapeJobListings = tool({
  description:
    "Research a single company's hiring activity by navigating their website with a real browser. For multiple companies, use scrapeJobListingsBatch instead -- it runs them in parallel.",
  inputSchema: z.object({
    organizationId: z
      .string()
      .uuid()
      .describe("Organization ID to attach hiring data to"),
    domain: z
      .string()
      .describe(
        "Company domain (e.g. 'stripe.com'). The browser will navigate to the site and find the careers page.",
      ),
    maxJobs: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe("Maximum number of jobs to extract"),
  }),
  execute: async (input) => {
    const { scrapeHiringData } = await import("@/lib/services/hiring-scraper");
    const result = await scrapeHiringData(
      input.organizationId,
      input.domain,
      input.maxJobs,
    );
    return {
      organizationId: input.organizationId,
      domain: input.domain,
      careersUrl: result.careersUrl,
      totalJobs: result.totalJobs,
      jobs: result.jobs,
      ...(!result.careersUrl
        ? { message: "No careers page found on this website." }
        : {}),
    };
  },
});

export const scrapeJobListingsBatch = tool({
  description:
    "Research hiring activity for multiple companies IN PARALLEL. Much faster than calling scrapeJobListings one by one. Each company gets its own browser session running concurrently.",
  inputSchema: z.object({
    companies: z
      .array(
        z.object({
          organizationId: z.string().uuid().describe("Organization ID"),
          domain: z.string().describe("Company domain (e.g. 'stripe.com')"),
        }),
      )
      .min(1)
      .max(10)
      .describe("Array of companies to scrape (max 10)"),
    maxJobs: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe("Maximum number of jobs to extract per company"),
  }),
  execute: async (input) => {
    const { scrapeHiringData } = await import("@/lib/services/hiring-scraper");

    const results = await Promise.allSettled(
      input.companies.map(async (company) => {
        const result = await scrapeHiringData(
          company.organizationId,
          company.domain,
          input.maxJobs,
        );
        return {
          organizationId: company.organizationId,
          domain: company.domain,
          careersUrl: result.careersUrl,
          totalJobs: result.totalJobs,
          jobs: result.jobs,
        };
      }),
    );

    const succeeded: Array<{
      organizationId: string;
      domain: string;
      totalJobs: number;
      careersUrl: string | null;
    }> = [];
    const failed: Array<{
      organizationId: string;
      domain: string;
      error: string;
    }> = [];

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        succeeded.push({
          organizationId: result.value.organizationId,
          domain: result.value.domain,
          totalJobs: result.value.totalJobs,
          careersUrl: result.value.careersUrl,
        });
      } else {
        failed.push({
          organizationId: input.companies[i].organizationId,
          domain: input.companies[i].domain,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : "Unknown error",
        });
      }
    });

    return {
      total: input.companies.length,
      succeeded: succeeded.length,
      failed: failed.length,
      results: succeeded,
      errors: failed.length > 0 ? failed : undefined,
    };
  },
});

async function resolveOrganizationId(idOrLinkId: string): Promise<string> {
  const supabase = await createClient();

  // Try as organization ID first
  const { data: directOrg } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", idOrLinkId)
    .maybeSingle();

  if (directOrg) return directOrg.id;

  // Try as campaign_organizations link ID
  const { data: link } = await supabase
    .from("campaign_organizations")
    .select("organization_id")
    .eq("id", idOrLinkId)
    .maybeSingle();

  if (link) return link.organization_id;

  throw new Error(`Organization not found for ID: ${idOrLinkId}`);
}

export function summarizeCompanyEnrichment(
  data: Record<string, unknown>,
): Record<string, number | boolean> {
  const s: Record<string, number | boolean> = {};
  const site = data.website as Record<string, unknown> | undefined;
  if (site) {
    s.hasWebsite = true;
    const contact = site.emails as string[] | undefined;
    if (Array.isArray(contact)) s.websiteEmails = contact.length;
  }
  const searches = data.searches as
    | Array<{ category?: string; results: unknown[] }>
    | undefined;
  if (Array.isArray(searches)) {
    for (const sr of searches) {
      const cat = sr.category;
      const n = Array.isArray(sr.results) ? sr.results.length : 0;
      if (cat) s[`${cat}Results`] = n;
    }
  }
  return s;
}

async function enrichCompanyById(
  companyIdOrLinkId: string,
  campaignId?: string,
): Promise<{
  companyId: string;
  companyName: string;
  domain: string | null;
  summary: Record<string, number | boolean>;
  skipped?: boolean;
  icp?: Record<string, unknown>;
  errors?: string[];
}> {
  const supabase = await createClient();
  const organizationId = await resolveOrganizationId(companyIdOrLinkId);

  // Check recency -- skip if recently enriched
  const recent = await isRecentlyEnriched("organizations", organizationId);
  if (recent) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name, domain, enrichment_data")
      .eq("id", organizationId)
      .single();
    return {
      companyId: organizationId,
      companyName: org?.name || "Unknown",
      domain: org?.domain || null,
      summary: summarizeCompanyEnrichment(
        (org?.enrichment_data as Record<string, unknown>) || {},
      ),
      skipped: true,
    };
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", organizationId)
    .single();

  if (orgError || !org) {
    throw new Error(
      `Organization not found: ${orgError?.message || "Unknown"}`,
    );
  }

  let icp: Record<string, unknown> | null = null;
  if (campaignId) {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("icp")
      .eq("id", campaignId)
      .single();
    icp = (campaign?.icp as Record<string, unknown>) || null;
  }

  const exa = new ExaService();
  const extractor = new WebExtractionService();
  const errors: string[] = [];

  const companyUrl = org.url || (org.domain ? `https://${org.domain}` : null);

  const contextParts: string[] = [];
  if (org.industry) contextParts.push(org.industry as string);
  if (org.location) contextParts.push(org.location as string);
  const context = contextParts.length > 0 ? ` ${contextParts.join(" ")}` : "";
  const domainHint = org.domain ? ` ${org.domain}` : "";
  const specificName = `"${org.name}"${domainHint}${context}`;

  const companyDomain =
    org.domain || (companyUrl ? new URL(companyUrl).hostname : null);

  const [websiteResult, productResult, fundingResult, teamResult] =
    await Promise.allSettled([
      companyUrl
        ? extractor.extract(companyUrl, { includeLinks: false })
        : Promise.resolve(null),
      exa.search(
        companyDomain
          ? `${org.name} products services`
          : `${specificName} product services offering`,
        {
          numResults: 5,
          includeText: true,
          ...(companyDomain ? { includeDomains: [companyDomain] } : {}),
        },
      ),
      exa.search(`${specificName} funding news announcement`, {
        numResults: 5,
        includeText: true,
        category: "news",
      }),
      exa.search(`${specificName} team employees company size`, {
        numResults: 5,
        includeText: true,
      }),
    ]);

  const enrichmentData: Record<string, unknown> = {
    enrichedAt: new Date().toISOString(),
  };

  if (websiteResult.status === "fulfilled" && websiteResult.value?.success) {
    const wd = websiteResult.value.data;
    enrichmentData.website = {
      title: wd.title,
      description: wd.description,
      content: wd.content.slice(0, 3000),
      openGraph: wd.openGraph,
      emails: wd.contactInfo?.emails,
      phones: wd.contactInfo?.phones,
      address: wd.contactInfo?.address,
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

  const searchEntries = [
    ["product", productResult],
    ["funding", fundingResult],
    ["team", teamResult],
  ] as const;

  for (const [label, result] of searchEntries) {
    if (result.status === "fulfilled") {
      const mapped = result.value.results.map(
        (r: {
          title: string;
          url: string;
          publishedDate: string | null;
          text: string | null;
        }) => ({
          title: r.title,
          url: r.url,
          publishedDate: r.publishedDate,
          text: r.text?.slice(0, 2000) || null,
        }),
      );
      const filtered = await filterRelevantResults(
        org.name as string,
        companyDomain,
        mapped,
      );
      searches.push({
        category: label,
        query: `${org.name} ${label}`,
        results: filtered.slice(0, 3),
      });
    } else {
      errors.push(`Search (${label}): ${result.reason?.message || "Failed"}`);
    }
  }

  enrichmentData.searches = searches;
  if (errors.length > 0) enrichmentData.errors = errors;

  await mergeEnrichmentData("organizations", organizationId, enrichmentData);

  return {
    companyId: organizationId,
    companyName: org.name as string,
    domain: org.domain as string | null,
    summary: summarizeCompanyEnrichment(enrichmentData),
    icp: icp || undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export const enrichCompany = tool({
  description:
    "Deeply research a single company and write results to the DB. Returns a THIN summary (counts of searches by category, has-website flag) -- NOT the raw enrichment payload. To read the actual enrichment (website content, Exa results), call getCompanyDetail(organizationId). For multiple companies use enrichCompanies. Skips if recently enriched (<7 days).",
  inputSchema: z.object({
    companyId: z
      .string()
      .uuid()
      .describe("Organization ID or campaign-organization link ID to enrich"),
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign ID to load ICP context for scoring."),
  }),
  execute: async (input) =>
    enrichCompanyById(input.companyId, input.campaignId),
});

export const enrichCompanies = tool({
  description:
    "Deeply research multiple companies IN PARALLEL. Much faster than calling enrichCompany one by one. Skips any organization recently enriched (within 7 days).",
  inputSchema: z.object({
    companyIds: z
      .array(z.string().uuid())
      .min(1)
      .max(10)
      .describe(
        "Array of organization IDs or campaign-organization link IDs to enrich (max 10)",
      ),
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign ID to load ICP context for scoring."),
  }),
  execute: async (input) => {
    const succeeded: Array<{
      companyId: string;
      companyName: string;
      domain: string | null;
      skipped?: boolean;
    }> = [];
    const failed: Array<{ companyId: string; error: string }> = [];

    // Process in chunks of 3 to stay under Exa's 10 QPS limit
    // (each company makes 3-4 Exa searches)
    const CHUNK_SIZE = 3;
    for (let i = 0; i < input.companyIds.length; i += CHUNK_SIZE) {
      const chunk = input.companyIds.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map((id) => enrichCompanyById(id, input.campaignId)),
      );

      results.forEach((result, j) => {
        if (result.status === "fulfilled") {
          succeeded.push({
            companyId: result.value.companyId,
            companyName: result.value.companyName,
            domain: result.value.domain,
            skipped: result.value.skipped,
          });
        } else {
          failed.push({
            companyId: chunk[j],
            error:
              result.reason instanceof Error
                ? result.reason.message
                : "Unknown error",
          });
        }
      });
    }

    return {
      total: input.companyIds.length,
      succeeded: succeeded.length,
      failed: failed.length,
      results: succeeded,
      errors: failed.length > 0 ? failed : undefined,
    };
  },
});

export const findContacts = tool({
  description:
    "Find contacts at a specific company by searching for target titles on LinkedIn. When campaignId is provided, uses the campaign's ICP target titles and links contacts to the campaign. When used without a campaign, requires explicit titles. Pass either companyId (campaign-organization link) or organizationId (direct).",
  inputSchema: z.object({
    companyId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Campaign-organization link ID. Use when working within a campaign.",
      ),
    organizationId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Organization ID from the shared knowledge base. Use for ad-hoc search without a campaign.",
      ),
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Campaign ID to get ICP target titles and associate contacts with. Omit for ad-hoc search.",
      ),
    titles: z
      .array(z.string())
      .optional()
      .describe(
        "Target titles to search for. Required when no campaignId is provided. If omitted, uses campaign ICP targetTitles.",
      ),
    numResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3)
      .describe("Number of results per title search"),
  }),
  execute: async (input) => {
    if (!input.companyId && !input.organizationId) {
      throw new Error(
        "Either companyId (campaign-organization link ID) or organizationId (organization ID) is required.",
      );
    }

    const supabase = await createClient();
    const exa = new ExaService();

    // Resolve target titles from campaign ICP or explicit input
    let targetTitles: string[] = input.titles || [];
    if (targetTitles.length === 0 && input.campaignId) {
      const { data: campaign } = await supabase
        .from("campaigns")
        .select("icp")
        .eq("id", input.campaignId)
        .single();
      const campaignIcp = campaign?.icp as Record<string, unknown> | null;
      targetTitles = (campaignIcp?.targetTitles as string[] | undefined) || [];
    }

    if (targetTitles.length === 0) {
      return {
        contacts: [],
        error:
          "No target titles provided. Pass titles explicitly or use a campaign with ICP targetTitles set.",
      };
    }

    // Resolve organization — either from campaign link or directly
    let orgId: string;
    let org: {
      name: string;
      domain: string | null;
      industry: string | null;
      location: string | null;
      description: string | null;
    };

    if (input.companyId) {
      const { data: link, error: linkError } = await supabase
        .from("campaign_organizations")
        .select(
          "organization_id, organization:organizations(name, domain, industry, location, description)",
        )
        .eq("id", input.companyId)
        .single();
      if (linkError || !link) {
        throw new Error(
          `Company not found: ${linkError?.message || "Unknown"}`,
        );
      }
      orgId = link.organization_id;
      org = link.organization as unknown as typeof org;
    } else {
      const { data: orgData, error: orgError } = await supabase
        .from("organizations")
        .select("id, name, domain, industry, location, description")
        .eq("id", input.organizationId!)
        .single();
      if (orgError || !orgData) {
        throw new Error(
          `Organization not found: ${orgError?.message || "Unknown"}`,
        );
      }
      orgId = orgData.id;
      org = orgData;
    }

    // Dedup against existing contacts (by LinkedIn URL)
    const existingUrls = new Set<string>();
    if (input.campaignId) {
      const { data: existingLinks } = await supabase
        .from("campaign_people")
        .select("person:people(linkedin_url)")
        .eq("campaign_id", input.campaignId);
      for (const l of existingLinks || []) {
        const url = (
          l.person as unknown as { linkedin_url: string | null } | null
        )?.linkedin_url;
        if (url) existingUrls.add(url);
      }
    }

    const storedContacts: Array<{
      id: string;
      name: string;
      title: string | null;
      work_email: string | null;
      personal_email: string | null;
      linkedin_url: string | null;
      source: string;
    }> = [];

    // ── Phase 1: Search the company's own website ────────────────────
    if (org.domain) {
      try {
        const domainPeople = await findPeopleOnDomain(org.domain, org.name);
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

          if (input.campaignId) {
            await linkPersonToCampaign(person.id, input.campaignId);
          }
          if (dp.linkedinUrl) existingUrls.add(dp.linkedinUrl);

          storedContacts.push({
            id: person.id,
            name: person.name,
            title: person.title,
            work_email: person.work_email,
            personal_email: person.personal_email,
            linkedin_url: person.linkedin_url,
            source: "website",
          });
        }
      } catch (err) {
        console.error("[findContacts] Domain scrape failed:", err);
      }
    }

    // ── Phase 2: LinkedIn search with LLM filtering ──────────────────
    const searchResults = await Promise.all(
      targetTitles.map(async (title: string) => {
        const query = `"${org.name}" ${title} site:linkedin.com`;
        try {
          const result = await exa.search(query, {
            numResults: input.numResults,
            category: "people",
            includeText: true,
          });
          return { title, query, results: result.results };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error(`[findContacts] Search failed for "${query}": ${msg}`);
          return { title, query, results: [], error: msg };
        }
      }),
    );

    const seenUrls = new Set<string>();
    const candidates: Array<
      CandidateContact & { searchTitle: string; linkedinUrl: string | null }
    > = [];
    let duplicatesSkipped = 0;

    for (const search of searchResults) {
      for (const result of search.results) {
        if (seenUrls.has(result.url)) {
          duplicatesSkipped++;
          continue;
        }
        seenUrls.add(result.url);

        const linkedinUrl = result.url.includes("linkedin.com")
          ? result.url
          : null;
        if (linkedinUrl && existingUrls.has(linkedinUrl)) {
          duplicatesSkipped++;
          continue;
        }

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
      const company = {
        name: org.name,
        domain: org.domain,
        industry: org.industry,
        location: org.location,
        description: org.description,
      };
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

        if (input.campaignId) {
          await linkPersonToCampaign(person.id, input.campaignId);
        }

        storedContacts.push({
          id: person.id,
          name: person.name,
          title: person.title,
          work_email: person.work_email,
          personal_email: person.personal_email,
          linkedin_url: person.linkedin_url,
          source: "exa",
        });
      }
    }

    return {
      companyId: input.companyId,
      companyName: org.name,
      targetTitles,
      contacts: storedContacts.map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        work_email: c.work_email,
        personal_email: c.personal_email,
        linkedinUrl: c.linkedin_url,
        source: c.source,
      })),
      searchesRun: searchResults.map((s) => ({
        title: s.title,
        query: s.query,
        resultsFound: s.results.length,
        error: "error" in s ? (s as { error?: string }).error : undefined,
      })),
      totalFound: storedContacts.length,
      duplicatesSkipped,
    };
  },
});

export const getContacts = tool({
  description:
    "Fetch stored contacts for a campaign with optional filtering. Returns a THIN list (no enrichment_data) so context stays small. For deep detail on one contact (bio, Twitter, etc.), call getContactDetail(personId).",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
    enrichmentStatus: z
      .enum(["pending", "in_progress", "enriched", "failed"])
      .optional()
      .describe("Filter by enrichment status"),
    companyId: z
      .string()
      .uuid()
      .optional()
      .describe("Filter by campaign-organization link ID"),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    const query = supabase
      .from("campaign_people")
      .select(
        "id, person_id, campaign_id, outreach_status, priority_score, score_reason, created_at, updated_at, person:people(name, title, work_email, personal_email, linkedin_url, twitter_url, enrichment_status, source, organization_id, organization:organizations(name, domain, industry))",
      )
      .eq("campaign_id", input.campaignId)
      .order("priority_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    const { data, error } = await query;

    if (error) throw new Error(`Failed to get contacts: ${error.message}`);

    let results = data || [];

    // Filter by enrichment status (lives on the person record)
    if (input.enrichmentStatus) {
      results = results.filter(
        (r) =>
          (r.person as unknown as { enrichment_status: string } | null)
            ?.enrichment_status === input.enrichmentStatus,
      );
    }

    // Filter by company (campaign_organizations link)
    if (input.companyId) {
      // Get the organization_id for this campaign_organizations link
      const { data: link } = await supabase
        .from("campaign_organizations")
        .select("organization_id")
        .eq("id", input.companyId)
        .single();

      if (link) {
        results = results.filter(
          (r) =>
            (r.person as unknown as { organization_id: string | null } | null)
              ?.organization_id === link.organization_id,
        );
      }
    }

    // Flatten for backwards compat
    const contacts = results.map((row) => {
      const person = row.person as unknown as Record<string, unknown>;
      return {
        id: row.id,
        person_id: row.person_id,
        campaign_id: row.campaign_id,
        name: person.name,
        title: person.title,
        work_email: person.work_email,
        personal_email: person.personal_email,
        linkedin_url: person.linkedin_url,
        twitter_url: person.twitter_url,
        enrichment_status: person.enrichment_status,
        outreach_status: row.outreach_status,
        priority_score: row.priority_score,
        score_reason: row.score_reason,
        source: person.source,
        company: person.organization || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    return { contacts };
  },
});

export const getContactDetail = tool({
  description:
    "Fetch full enrichment detail for ONE contact (LinkedIn, Twitter, email discovery, plus their company's enrichment). Use this per-draft when composing a personalized email. Do NOT call in a loop to 'preload' multiple contacts — call once per email you are writing, then discard. Keeps context small and prevents mixing details across contacts.",
  inputSchema: z.object({
    personId: z
      .string()
      .uuid()
      .describe("People table ID (person_id, not campaign_people.id)."),
  }),
  execute: async ({ personId }) => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("people")
      .select(
        "id, name, title, work_email, personal_email, linkedin_url, twitter_url, enrichment_status, enrichment_data, organization:organizations(id, name, domain, industry, location, description, enrichment_data, enrichment_status)",
      )
      .eq("id", personId)
      .single();

    if (error || !data) {
      return { error: `Contact not found: ${error?.message ?? "no rows"}` };
    }

    return {
      id: data.id,
      name: data.name,
      title: data.title,
      work_email: data.work_email,
      personal_email: data.personal_email,
      linkedin_url: data.linkedin_url,
      twitter_url: data.twitter_url,
      enrichment_status: data.enrichment_status,
      enrichment_data: data.enrichment_data,
      company: data.organization ?? null,
    };
  },
});

export const deleteCompanies = tool({
  description:
    "Unlink one or more companies from a campaign. The shared organization data is preserved for other campaigns. Also unlinks contacts at those companies from this campaign.",
  inputSchema: z.object({
    companyIds: z
      .array(z.string().uuid())
      .min(1)
      .describe("Array of campaign-organization link IDs to remove"),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    // Get organization_ids to unlink their people too
    const { data: links } = await supabase
      .from("campaign_organizations")
      .select("organization_id, campaign_id")
      .in("id", input.companyIds);

    if (links && links.length > 0) {
      const campaignId = links[0].campaign_id;
      const orgIds = links.map((l) => l.organization_id);

      // Get person_ids at these orgs
      const { data: people } = await supabase
        .from("people")
        .select("id")
        .in("organization_id", orgIds);

      if (people && people.length > 0) {
        const personIds = people.map((p) => p.id);
        await supabase
          .from("campaign_people")
          .delete()
          .eq("campaign_id", campaignId)
          .in("person_id", personIds);
      }
    }

    const { error } = await supabase
      .from("campaign_organizations")
      .delete()
      .in("id", input.companyIds);

    if (error) throw new Error(`Failed to unlink companies: ${error.message}`);

    return {
      deleted: input.companyIds.length,
      companyIds: input.companyIds,
    };
  },
});

export const deleteContacts = tool({
  description:
    "Unlink one or more contacts from a campaign. The shared person data is preserved for other campaigns.",
  inputSchema: z.object({
    contactIds: z
      .array(z.string().uuid())
      .min(1)
      .describe("Array of campaign-people link IDs to remove"),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    const { error } = await supabase
      .from("campaign_people")
      .delete()
      .in("id", input.contactIds);

    if (error) throw new Error(`Failed to unlink contacts: ${error.message}`);

    return {
      deleted: input.contactIds.length,
      contactIds: input.contactIds,
    };
  },
});

export const scoreCompany = tool({
  description:
    "Store a priority score (1-10) and reasoning for a company in this campaign. Call this after enriching a company, after analyzing enrichment data against the ICP and user profile.",
  inputSchema: z.object({
    companyId: z
      .string()
      .uuid()
      .describe("Campaign-organization link ID to score"),
    score: z
      .number()
      .min(1)
      .max(10)
      .describe(
        "Priority score 1-10. 8-10: strong fit with active signals. 5-7: moderate fit. 1-4: weak fit.",
      ),
    reason: z
      .string()
      .min(10)
      .describe(
        "2-3 sentence explanation of WHY this score. Reference specific data points: ICP fit, timing signals, offering alignment, company stage.",
      ),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("campaign_organizations")
      .update({
        relevance_score: input.score,
        score_reason: input.reason,
      })
      .eq("id", input.companyId);

    if (error) throw new Error(`Failed to score company: ${error.message}`);
    return {
      companyId: input.companyId,
      score: input.score,
      reason: input.reason,
    };
  },
});

export const scoreContact = tool({
  description:
    "Store a priority score (1-10) and reasoning for a contact in this campaign. Call this after enriching a contact, after analyzing their profile, activity, and connection to the user.",
  inputSchema: z.object({
    contactId: z.string().uuid().describe("Campaign-people link ID to score"),
    score: z
      .number()
      .min(1)
      .max(10)
      .describe(
        "Priority score 1-10. 8-10: strong personal connection + active timing signals. 5-7: good fit, some signals. 1-4: low priority.",
      ),
    reason: z
      .string()
      .min(10)
      .describe(
        "2-3 sentence explanation of WHY to reach out to this person first. Reference specific signals: recent posts, job changes, shared connections, topic alignment with user's offering.",
      ),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("campaign_people")
      .update({
        priority_score: input.score,
        score_reason: input.reason,
      })
      .eq("id", input.contactId);

    if (error) throw new Error(`Failed to score contact: ${error.message}`);
    return {
      contactId: input.contactId,
      score: input.score,
      reason: input.reason,
    };
  },
});

export const updateCompanyStatus = tool({
  description:
    "Update the qualification status of one or more companies in this campaign. Use 'qualified' for good ICP fits, 'disqualified' for poor fits.",
  inputSchema: z.object({
    companyIds: z
      .array(z.string().uuid())
      .min(1)
      .describe("Array of campaign-organization link IDs to update"),
    status: z
      .enum(["discovered", "qualified", "disqualified"])
      .describe("New status to set"),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    const { error } = await supabase
      .from("campaign_organizations")
      .update({ status: input.status })
      .in("id", input.companyIds);

    if (error) throw new Error(`Failed to update companies: ${error.message}`);

    return {
      updated: input.companyIds.length,
      status: input.status,
    };
  },
});

export const getGoogleReviews = tool({
  description:
    "Fetch Google Reviews for a company using the Google Places API. Returns rating, review count, and recent review text. Use this to gauge customer sentiment and find outreach hooks.",
  inputSchema: z.object({
    organizationId: z
      .string()
      .uuid()
      .describe("Organization ID to attach review data to"),
    companyName: z
      .string()
      .describe("Company name to search for on Google Places"),
    location: z
      .string()
      .optional()
      .describe("Optional location hint (city, state) to disambiguate"),
    domain: z
      .string()
      .optional()
      .describe("Company domain for cross-verification"),
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign ID for signal result tracking"),
  }),
  execute: async (input) => {
    const service = new GooglePlacesService();
    const result = await service.getPlaceReviews(
      input.companyName,
      input.location,
      input.domain,
    );

    if (result.found) {
      await mergeEnrichmentData("organizations", input.organizationId, {
        googleReviews: {
          rating: result.rating,
          reviewCount: result.userRatingCount,
          googleMapsUrl: result.googleMapsUri,
          topReviews: result.reviews.slice(0, 5),
          fetchedAt: new Date().toISOString(),
        },
      });
    }

    if (input.campaignId) {
      const supabase = await createClient();
      const { data: signal } = await supabase
        .from("signals")
        .select("id")
        .eq("slug", "google-reviews")
        .maybeSingle();

      if (signal) {
        await supabase.from("signal_results").insert({
          signal_id: signal.id,
          campaign_id: input.campaignId,
          organization_id: input.organizationId,
          output: result,
          status: result.found ? "success" : "failed",
        });
      }
    }

    return result;
  },
});
