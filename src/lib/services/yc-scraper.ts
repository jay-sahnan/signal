import { chromium } from "playwright-core";
import Browserbase from "@browserbasehq/sdk";
import { trackUsage, PRICING } from "@/lib/services/cost-tracker";
import { withTimeout } from "@/lib/utils/timeout";

// ── Types ────────────────────────────────────────────────────────────────

export interface YCCompanyRaw {
  name: string;
  oneLiner: string | null;
  ycUrl: string;
  batch: string | null;
  industry: string | null;
  location: string | null;
}

export interface YCCompanyDetail {
  name: string;
  oneLiner: string | null;
  longDescription: string | null;
  url: string | null;
  ycUrl: string;
  batch: string | null;
  industry: string | null;
  location: string | null;
  teamSize: string | null;
  founders: Array<{
    name: string;
    title: string | null;
    linkedin: string | null;
  }>;
  isHiring: boolean;
}

export interface YCScrapeResult {
  companies: YCCompanyDetail[];
  totalCards: number;
  directoryUrl: string;
}

export interface YCFilters {
  batch?: string;
  industry?: string;
  region?: string;
  teamSize?: string;
  isHiring?: boolean;
  query?: string;
}

// ── URL builder ──────────────────────────────────────────────────────────

/**
 * Build the YC directory URL with query-param filters.
 */
export function buildYCDirectoryUrl(filters: YCFilters): string {
  const base = "https://www.ycombinator.com/companies";
  const params = new URLSearchParams();

  if (filters.batch) params.set("batch", filters.batch);
  if (filters.industry) params.set("industry", filters.industry);
  if (filters.region) params.set("regions", filters.region);
  if (filters.teamSize) params.set("team_size", filters.teamSize);
  if (filters.isHiring) params.set("is_hiring", "true");
  if (filters.query) params.set("q", filters.query);

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// ── Phase 1: Directory listing ───────────────────────────────────────────

/**
 * Scrape the YC directory listing page. Scrolls until all companies load,
 * then extracts card data directly from the DOM.
 */
async function scrapeDirectoryListing(filters: YCFilters): Promise<{
  cards: YCCompanyRaw[];
  directoryUrl: string;
  sessionDurationSec: number;
}> {
  const { bb, projectId } = getBrowserbase();
  const session = await withTimeout(
    bb.sessions.create({ projectId }),
    60_000,
    "bb.sessions.create (yc-scraper-listing)",
  );
  const sessionStart = Date.now();
  const browser = await chromium.connectOverCDP(session.connectUrl);

  try {
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    const directoryUrl = buildYCDirectoryUrl(filters);

    await page.goto(directoryUrl, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Scroll to load all lazy-loaded companies.
    // Keep scrolling until no new cards appear for 2 consecutive passes.
    let previousCount = 0;
    let stableRounds = 0;

    while (stableRounds < 2) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);

      const currentCount = await page.evaluate(() => {
        const anchors = document.querySelectorAll('a[href^="/companies/"]');
        let count = 0;
        for (const a of anchors) {
          const href = a.getAttribute("href") || "";
          if (
            !href.includes("?") &&
            href !== "/companies/" &&
            href !== "/companies"
          ) {
            count++;
          }
        }
        return count;
      });

      if (currentCount === previousCount) {
        stableRounds++;
      } else {
        stableRounds = 0;
        previousCount = currentCount;
      }
    }

    // Extract company cards from the DOM
    const cards: YCCompanyRaw[] = await page.evaluate(() => {
      const anchors = document.querySelectorAll<HTMLAnchorElement>(
        'a[href^="/companies/"]',
      );
      const results: Array<{
        name: string;
        oneLiner: string | null;
        ycUrl: string;
        batch: string | null;
        industry: string | null;
        location: string | null;
      }> = [];
      const seen = new Set<string>();

      for (const anchor of anchors) {
        const href = anchor.getAttribute("href") || "";
        if (
          href.includes("?") ||
          href === "/companies/" ||
          href === "/companies"
        )
          continue;
        if (seen.has(href)) continue;
        seen.add(href);

        const text = anchor.innerText || "";
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        if (lines.length === 0) continue;

        // The first line often has name + location concatenated, e.g.
        // "Paratus HealthMenlo Park, CA, USA". Split on the location pattern.
        let name = lines[0];
        let location: string | null = null;

        // Match a city/state/country suffix like "San Francisco, CA, USA"
        const locMatch = name.match(
          /^(.+?)([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2}(?:,\s*\w+)?)$/,
        );
        if (locMatch) {
          name = locMatch[1].trim();
          location = locMatch[2].trim();
        }

        // Also check if there's a standalone location line
        if (!location) {
          const locationLine = lines.find(
            (l) =>
              l !== lines[0] &&
              (/,\s*[A-Z]{2}/.test(l) || /,\s*\w+,\s*\w+/.test(l)),
          );
          if (locationLine) location = locationLine;
        }

        const oneLiner = lines.length > 1 ? lines[1] : null;

        // Batch: "WINTER 2025", "SUMMER 2024", etc.
        const batchLine = lines.find((l) =>
          /^(WINTER|SUMMER|SPRING|FALL)\s+\d{4}$/i.test(l),
        );

        // Industry: uppercase lines that aren't batch tags
        const industryLines = lines
          .slice(2)
          .filter(
            (l) =>
              l === l.toUpperCase() &&
              l.length > 2 &&
              !/^(WINTER|SUMMER|SPRING|FALL)\s+\d{4}$/i.test(l),
          );

        results.push({
          name,
          oneLiner,
          ycUrl: `https://www.ycombinator.com${href}`,
          batch: batchLine || null,
          industry: industryLines[0] || null,
          location,
        });
      }

      return results;
    });

    const sessionDurationSec = (Date.now() - sessionStart) / 1000;
    return { cards, directoryUrl, sessionDurationSec };
  } finally {
    await browser.close();
  }
}

// ── Phase 2: Company detail pages ────────────────────────────────────────

/**
 * Visit each company's YC profile page to extract website URL,
 * long description, founders, team size, and hiring status.
 */
async function scrapeCompanyDetails(
  cards: YCCompanyRaw[],
  maxDetails: number = 50,
): Promise<{ details: YCCompanyDetail[]; sessionDurationSec: number }> {
  const { bb, projectId } = getBrowserbase();
  const session = await withTimeout(
    bb.sessions.create({ projectId }),
    60_000,
    "bb.sessions.create (yc-scraper-details)",
  );
  const sessionStart = Date.now();
  const browser = await chromium.connectOverCDP(session.connectUrl);

  const details: YCCompanyDetail[] = [];

  try {
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    const toVisit = cards.slice(0, maxDetails);

    for (const card of toVisit) {
      try {
        await page.goto(card.ycUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await page.waitForTimeout(2000);

        const detail = await page.evaluate(() => {
          // Website URL: first external link that isn't social/nav
          const excludedDomains = [
            "ycombinator.com",
            "linkedin.com",
            "twitter.com",
            "x.com",
            "github.com",
            "facebook.com",
            "instagram.com",
            "startupschool.org",
            "workatastartup.com",
            "bookface.ycombinator.com",
          ];
          const links = Array.from(document.querySelectorAll("a[href]"));
          const websiteLink = links.find((a) => {
            const href = a.getAttribute("href") || "";
            if (!href.startsWith("http")) return false;
            try {
              const hostname = new URL(href).hostname.toLowerCase();
              return !excludedDomains.some(
                (d) => hostname === d || hostname.endsWith(`.${d}`),
              );
            } catch {
              return false;
            }
          });
          const url = websiteLink?.getAttribute("href") || null;

          // Long description
          const descEl =
            document.querySelector("[class*='prose']") ||
            document.querySelector("section p");
          const longDescription = descEl?.textContent?.trim() || null;

          // Team size
          const bodyText = document.body.innerText;
          const teamMatch = bodyText.match(
            /(?:Team Size|Employees?):\s*(\d[\d\-+]*)/i,
          );
          const teamSize = teamMatch ? teamMatch[1] : null;

          // Hiring
          const isHiring =
            !!document.querySelector(
              '[href*="jobs"], [href*="careers"], [class*="hiring"]',
            ) || /currently hiring/i.test(bodyText);

          // Founders
          const founders: Array<{
            name: string;
            title: string | null;
            linkedin: string | null;
          }> = [];

          // Try founder/team sections first
          const founderSections = document.querySelectorAll(
            '[class*="founder"], [class*="team"] > div',
          );

          if (founderSections.length > 0) {
            for (const section of founderSections) {
              const name =
                section
                  .querySelector("h3, h4, [class*='name']")
                  ?.textContent?.trim() || "";
              if (!name || name.length < 2 || name.length > 60) continue;
              const title =
                section
                  .querySelector("p, [class*='title'], [class*='role']")
                  ?.textContent?.trim() || null;
              const linkedinEl = section.querySelector(
                'a[href*="linkedin.com"]',
              );
              const linkedin = linkedinEl?.getAttribute("href") || null;
              founders.push({ name, title, linkedin });
            }
          }

          // Fallback: look for "Founders" heading
          if (founders.length === 0) {
            const headings = document.querySelectorAll("h2, h3, h4");
            for (const h of headings) {
              if (!h.textContent?.toLowerCase().includes("founder")) continue;
              const container = h.parentElement;
              if (!container) continue;
              const nameEls = container.querySelectorAll(
                "a, h3, h4, [class*='name']",
              );
              for (const el of nameEls) {
                const n = el.textContent?.trim() || "";
                if (
                  n &&
                  n.length > 2 &&
                  n.length < 60 &&
                  !n.toLowerCase().includes("founder")
                ) {
                  const li = el
                    .closest("div")
                    ?.querySelector('a[href*="linkedin.com"]');
                  founders.push({
                    name: n,
                    title: null,
                    linkedin: li?.getAttribute("href") || null,
                  });
                }
              }
              break;
            }
          }

          return { url, longDescription, teamSize, isHiring, founders };
        });

        details.push({
          name: card.name,
          oneLiner: card.oneLiner,
          longDescription: detail.longDescription,
          url: detail.url,
          ycUrl: card.ycUrl,
          batch: card.batch,
          industry: card.industry,
          location: card.location,
          teamSize: detail.teamSize,
          founders: detail.founders,
          isHiring: detail.isHiring,
        });
      } catch {
        // Single company failure -> continue with fallback data
        details.push({
          name: card.name,
          oneLiner: card.oneLiner,
          longDescription: null,
          url: null,
          ycUrl: card.ycUrl,
          batch: card.batch,
          industry: card.industry,
          location: card.location,
          teamSize: null,
          founders: [],
          isHiring: false,
        });
      }
    }

    const sessionDurationSec = (Date.now() - sessionStart) / 1000;
    return { details, sessionDurationSec };
  } finally {
    await browser.close();
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Scrape YC's company directory and detail pages.
 *
 * Phase 1: Directory listing -- scroll to load all cards, extract from DOM.
 * Phase 2: Detail pages -- visit each company's YC profile for website, founders, etc.
 *
 * Uses two Browserbase sessions (one per phase).
 */
export async function scrapeYCCompanies(
  filters: YCFilters,
  maxCompanies: number = 50,
): Promise<YCScrapeResult> {
  // Phase 1: Directory listing
  const listing = await scrapeDirectoryListing(filters);

  trackUsage({
    service: "browserbase",
    operation: "yc_directory_listing",
    estimated_cost_usd:
      (listing.sessionDurationSec / 3600) * PRICING.browserbase_session_per_hr,
    metadata: { url: listing.directoryUrl, cards: listing.cards.length },
  });

  const cardsToDetail = listing.cards.slice(0, maxCompanies);

  if (cardsToDetail.length === 0) {
    return {
      companies: [],
      totalCards: 0,
      directoryUrl: listing.directoryUrl,
    };
  }

  // Phase 2: Company detail pages
  const detailResult = await scrapeCompanyDetails(cardsToDetail, maxCompanies);

  trackUsage({
    service: "browserbase",
    operation: "yc_company_details",
    estimated_cost_usd:
      (detailResult.sessionDurationSec / 3600) *
      PRICING.browserbase_session_per_hr,
    metadata: { companiesVisited: detailResult.details.length },
  });

  return {
    companies: detailResult.details,
    totalCards: listing.cards.length,
    directoryUrl: listing.directoryUrl,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getBrowserbase() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    throw new Error(
      "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required for YC scraping.",
    );
  }

  return { bb: new Browserbase({ apiKey }), projectId };
}
