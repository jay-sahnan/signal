import { z } from "zod";
import { mergeEnrichmentData } from "@/lib/services/knowledge-base";
import { withTimeout } from "@/lib/utils/timeout";

const STAGEHAND_INIT_TIMEOUT_MS = 60_000;

export interface HiringScrapeResult {
  careersUrl: string | null;
  jobs: Array<{
    title: string;
    department?: string;
    location?: string;
    url?: string;
  }>;
  totalJobs: number;
}

/**
 * Scrape a company's careers page using Stagehand (Browserbase + GPT-4o).
 * Finds the careers page automatically, extracts structured job listings,
 * and saves the hiring data to the organization's enrichment_data.
 *
 * Used by both the `scrapeJobListings` agent tool and the tracking run route.
 */
export async function scrapeHiringData(
  organizationId: string,
  domain: string,
  maxJobs: number = 20,
): Promise<HiringScrapeResult> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || !projectId || !anthropicKey) {
    const missing = [
      !apiKey && "BROWSERBASE_API_KEY",
      !projectId && "BROWSERBASE_PROJECT_ID",
      !anthropicKey && "ANTHROPIC_API_KEY",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Missing required env vars for job scraping: ${missing}`);
  }

  const { Stagehand } = await import("@browserbasehq/stagehand");

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    model: { modelName: "anthropic/claude-sonnet-4-6", apiKey: anthropicKey },
    disablePino: true,
  });

  try {
    await withTimeout(
      stagehand.init(),
      STAGEHAND_INIT_TIMEOUT_MS,
      "stagehand.init (hiring-scraper)",
    );

    const page = stagehand.context.pages()[0];
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");

    // Step 1: Navigate to the company's website
    await page.goto(`https://${cleanDomain}`, {
      waitUntil: "domcontentloaded",
      timeoutMs: 30000,
    });
    await page.waitForTimeout(2000);

    // Step 2: Find and click on careers/jobs link
    const careersLinks = await stagehand.observe(
      "Find any link to a careers page, jobs page, hiring page, or 'work with us' page. Look in navigation, footer, and page body.",
    );

    let careersUrl: string | null = null;

    if (careersLinks.length > 0) {
      await stagehand.act(
        "Click on the careers, jobs, hiring, or 'work with us' link.",
      );
      await page.waitForTimeout(3000);
      careersUrl = page.url();
    } else {
      const commonPaths = [
        "/careers",
        "/jobs",
        "/hiring",
        "/work-with-us",
        "/join-us",
        "/about/careers",
        "/company/careers",
      ];

      for (const path of commonPaths) {
        try {
          const response = await page.goto(`https://${cleanDomain}${path}`, {
            waitUntil: "domcontentloaded",
            timeoutMs: 10000,
          });
          if (response && response.ok()) {
            careersUrl = page.url();
            await page.waitForTimeout(2000);
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!careersUrl) {
      await mergeEnrichmentData("organizations", organizationId, {
        hiring: {
          careersUrl: null,
          jobs: [],
          scrapedAt: new Date().toISOString(),
        },
      });
      return { careersUrl: null, jobs: [], totalJobs: 0 };
    }

    // Step 3: Extract job listings
    const jobs = await stagehand.extract(
      `Extract up to ${maxJobs} job listings from this careers/jobs page. For each job, get the title, department or category, location, and the direct URL to the job posting if available.`,
      z.array(
        z.object({
          title: z.string().describe("Job title"),
          department: z.string().optional().describe("Department or category"),
          location: z.string().optional().describe("Job location"),
          url: z.string().optional().describe("Direct link to the job posting"),
        }),
      ),
    );

    const trimmed = jobs.slice(0, maxJobs);

    // Step 4: Save hiring data to the organization
    await mergeEnrichmentData("organizations", organizationId, {
      hiring: {
        careersUrl,
        jobs: trimmed,
        scrapedAt: new Date().toISOString(),
      },
    });

    return { careersUrl, jobs: trimmed, totalJobs: jobs.length };
  } finally {
    try {
      await stagehand.close();
    } catch {
      // ignore close errors
    }
  }
}
