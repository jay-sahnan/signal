import { KnownDiscoveryFailure } from "./discovery-failure";
import { readBodyCapped, safeFetch } from "@/lib/safe-fetch";
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { llmTimeout } from "@/lib/utils/timeout";
import { z } from "zod";
import { apiSafeSchema } from "@/lib/ai/api-safe-schema";
import { MODELS } from "@/lib/ai/models";
import { WebExtractionService } from "@/lib/services/web-extraction-service";
import {
  estimateClaudeCostFromUsage,
  trackUsage,
} from "@/lib/services/cost-tracker";
import {
  UNTRUSTED_NOTICE,
  stringify,
  wrapUntrusted,
} from "@/lib/prompt-safety";

// ── Types ────────────────────────────────────────────────────────────────

export interface CompanyContext {
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  description: string | null;
}

export interface CandidateContact {
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  rawHeadline: string | null;
  /**
   * Text scraped from the result page. Exa returns this on every people search
   * we already run (measured: 39 of 39 candidates on Browserbase), and it
   * usually carries a dated experience section. Judging without it is why every
   * candidate at a company whose staff do not name their employer in their
   * headline came back `uncertain`.
   */
  pageText?: string | null;
  /** When the scraped page was published. Null when the source is undated. */
  pageDate?: string | null;
}

/**
 * Four outcomes, not three.
 *
 * The binary version forced every candidate into "employee" or "not", and the
 * honest answer for a large share of them is "the evidence does not say". On
 * the dev database, 19 of 41 contacts at one company had a headline that never
 * mentions their employer, so a filter that must choose either keeps
 * provably-wrong people or deletes real ones.
 *
 * `former_employee` is separate from `rejected` because the two mean different
 * things to a salesperson and to the org chart: one is a person who really did
 * work here and left, the other was never here at all. Both detach.
 */
export type ContactVerdict =
  | "verified"
  | "former_employee"
  | "uncertain"
  | "rejected";

export interface VerifiedContact {
  index: number;
  name: string;
  title: string | null;
  verdict: ContactVerdict;
  /** One line explaining the call, stored as affiliation_evidence. */
  evidence: string;
  /** The employer the evidence actually named, so a human can audit the call. */
  employerSeen?: string | null;
  /** The date range the evidence gave for that employer, when it gave one. */
  datesSeen?: string | null;
  /**
   * The person's own location, when the headline or page text states one.
   * Never inferred from the company HQ: org location is already the send-time
   * fallback, so a copy of it here would only masquerade as person-level data.
   */
  location?: string | null;
}

/**
 * How old a scraped page may be and still support a `verified` call.
 *
 * A snapshot saying "Present" only proves where someone worked on the day it
 * was taken. Measured on Browserbase, 38 of 39 pages were within three weeks
 * and the one outlier at four months was the single wrong `verified` in the
 * batch, so this threshold costs almost nothing and catches exactly the case
 * it is aimed at.
 */
export const STALE_PROFILE_DAYS = 120;

export interface DomainPerson {
  name: string;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
}

// ── Team page paths to try ───────────────────────────────────────────────

const TEAM_KEYWORDS = [
  "team",
  "our-team",
  "meet-the-team",
  "about",
  "about-us",
  "staff",
  "people",
  "leadership",
  "management",
  "who-we-are",
  "contact",
  "contact-us",
];

/**
 * Fetch sitemap.xml and return the list of URLs.
 * Returns empty array on failure (no sitemap = fall back to guessing).
 */
async function fetchSitemapUrls(domain: string): Promise<string[]> {
  try {
    const response = await safeFetch(
      `https://${domain}/sitemap.xml`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
      { timeoutMs: 5000 },
    );

    if (!response.ok) return [];
    const xml = await readBodyCapped(response);
    const urls: string[] = [];
    const locRegex = /<loc>(.*?)<\/loc>/g;
    let match;
    while ((match = locRegex.exec(xml)) !== null) {
      urls.push(match[1]);
    }
    return urls;
  } catch {
    return [];
  }
}

// ── Domain-based people finding ──────────────────────────────────────────

/**
 * Scrape a company's website for team/about/staff pages and extract people.
 * Fetches the sitemap first to find real URLs instead of guessing paths.
 * Falls back to a short guess list if no sitemap exists.
 */
export async function findPeopleOnDomain(
  domain: string,
  orgName: string,
  options: { strict?: boolean } = {},
): Promise<DomainPerson[]> {
  const extractor = new WebExtractionService();
  const scrapedContent: Array<{ url: string; content: string }> = [];

  // Step 1: Try sitemap to find team/about pages
  const sitemapUrls = await fetchSitemapUrls(domain);
  const commonPaths = ["/team", "/about", "/about-us", "/people"].map(
    (p) => `https://${domain}${p}`,
  );
  let urlsToTry: string[];

  if (sitemapUrls.length > 0) {
    // Filter sitemap URLs to only those matching team-related keywords
    const lowerKeywords = TEAM_KEYWORDS;
    urlsToTry = sitemapUrls.filter((url) => {
      const path = url.toLowerCase();
      return lowerKeywords.some((kw) => path.includes(`/${kw}`));
    });
    console.log(
      `[contact-filter] Sitemap found ${sitemapUrls.length} URLs, ${urlsToTry.length} match team keywords`,
    );
    // Zero matches is not proof the site has no team page. A sitemap INDEX
    // guarantees it: its <loc> entries are sub-sitemap files, which match no
    // keyword, so this used to return [] for every site behind one.
    if (urlsToTry.length === 0) {
      urlsToTry = commonPaths;
      console.log(
        `[contact-filter] No sitemap URL matched, trying ${urlsToTry.length} common paths`,
      );
    }
  } else {
    // No sitemap -- fall back to top 4 most common paths only
    urlsToTry = commonPaths;
    console.log(
      `[contact-filter] No sitemap for ${domain}, trying ${urlsToTry.length} common paths`,
    );
  }

  // Step 2: Fetch matching URLs (cap at 4 to avoid spraying requests)
  const toFetch = urlsToTry.slice(0, 4);
  let uncertainFetch = false;
  const results = await Promise.allSettled(
    toFetch.map(async (url) => {
      const result = await extractor.extract(url, {
        includeLinks: false,
        timeout: 8000,
      });
      if (!result.success) uncertainFetch = true;
      if (
        result.success &&
        (options.strict ? result.data.content.trim().length > 0 : result.data.content.length > 200) &&
        !result.url.includes("/404")
      ) {
        return { url: result.url, content: result.data.content };
      }
      return null;
    }),
  );

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      scrapedContent.push(r.value);
    }
  }

  if (scrapedContent.length === 0) {
    if (options.strict) {
      if (uncertainFetch || results.some(result => result.status === "rejected"))
        throw new Error("Domain pages unavailable");
      throw new KnownDiscoveryFailure("Domain pages unavailable");
    }
    return [];
  }

  // Use Haiku to extract people from the scraped content
  const combinedContent = scrapedContent
    .map((s) => `--- ${s.url} ---\n${s.content.slice(0, 4000)}`)
    .join("\n\n");

  try {
    const { object, usage } = await generateObject({
      abortSignal: llmTimeout(),
      model: anthropic(MODELS.LIGHT),
      schema: apiSafeSchema(
        z.object({
          people: z.array(
            z.object({
              name: z.string().describe("Full name of the person"),
              title: z
                .string()
                .nullable()
                .describe("Job title or role at the company"),
              email: z
                .string()
                .nullable()
                .describe("Work email if found on the page"),
              linkedinUrl: z
                .string()
                .nullable()
                .describe("LinkedIn profile URL if found"),
            }),
          ),
        }),
      ),
      prompt: `Extract all staff members / team members from scraped website pages for a specific company.

${UNTRUSTED_NOTICE}

Target company name: ${stringify(orgName)}
Target domain: ${stringify(domain)}

Rules:
- Only extract REAL people who work at this company (not testimonials, clients, or partners)
- Each person should have a real human name (skip generic entries like "The Team" or company names)
- Clean up names: remove credentials/suffixes unless they're part of how the person is known
- Extract their job title/role at this company
- Extract their work email if listed
- Extract their LinkedIn URL if linked
- Skip duplicate people (same name appearing on multiple pages)

Scraped page content:
${wrapUntrusted(combinedContent.slice(0, 12000))}`,
    });

    trackUsage({
      service: "claude",
      operation: "domain-people-extract",
      tokens_input: usage.inputTokens ?? 0,
      tokens_output: usage.outputTokens ?? 0,
      estimated_cost_usd: estimateClaudeCostFromUsage("haiku", usage),
      metadata: {
        model: "claude-haiku-4-5",
        domain,
        pagesScraped: scrapedContent.length,
        peopleFound: object.people.length,
      },
    });

    return object.people;
  } catch (err) {
    console.error("[contact-filter] Domain people extraction failed:", err);
    if (options.strict) throw err;
    return [];
  }
}

// ── Company name matching ────────────────────────────────────────────────

/**
 * Normalize a company name for comparison: lowercase, strip common suffixes
 * (Ltd, Inc, LLC, etc.), and collapse whitespace/punctuation.
 */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(ltd|limited|inc|incorporated|llc|plc|corp|corporation|co|company|group|holdings)\b\.?/g,
      "",
    )
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check whether a LinkedIn headline references the target company name.
 * Uses normalized substring matching — the headline must contain the core
 * company name (minus legal suffixes) to pass.
 */
function headlineMentionsCompany(
  headline: string | null,
  companyName: string,
): boolean {
  if (!headline) return false;
  const normHeadline = normalizeCompanyName(headline);
  const normCompany = normalizeCompanyName(companyName);
  if (!normCompany) return false;
  return normHeadline.includes(normCompany);
}

// ── LLM-based LinkedIn result filtering ──────────────────────────────────

/** Milliseconds in the staleness window, computed once. */
const STALE_PROFILE_MS = STALE_PROFILE_DAYS * 24 * 60 * 60 * 1000;

/**
 * A `verified` call resting on an old snapshot is downgraded to `uncertain`.
 *
 * Only `verified` is affected. "They worked somewhere else in January" is still
 * evidence they were not here in January, and re-running the search will not
 * produce a fresher page, so downgrading a rejection would just re-admit the
 * stranger it correctly excluded.
 */
function downgradeStale(
  verdict: VerifiedContact,
  pageDate: string | null | undefined,
  now: number,
): VerifiedContact {
  if (verdict.verdict !== "verified" || !pageDate) return verdict;
  const t = Date.parse(pageDate);
  if (Number.isNaN(t)) return verdict;
  const age = now - t;
  if (age <= STALE_PROFILE_MS) return verdict;

  const months = Math.round(age / (30 * 24 * 60 * 60 * 1000));
  return {
    ...verdict,
    verdict: "uncertain",
    evidence: `${verdict.evidence} (evidence is ${months} months old, so it does not prove they are still there)`,
  };
}

/**
 * Judge which search results genuinely work at the target company.
 *
 * The headline check used to be a hard pre-filter, and anything that failed it
 * was dropped before the LLM ever saw it, returning `[]` outright when nothing
 * matched. That is why searchPeople stopped calling this at all: at small
 * companies most people's LinkedIn headline never names their employer, so the
 * filter deleted real employees in bulk. Measured on the dev database, it would
 * have discarded 22 of 41 genuine contacts.
 *
 * So the headline match is now a *hint passed to the LLM*, not a gate. Every
 * candidate is judged, and the ones the evidence cannot settle come back
 * `uncertain` rather than being silently dropped or silently trusted.
 *
 * The judge also reads the scraped page text, which usually carries a dated
 * experience section. A headline alone cannot tell a current employee from
 * someone who left two years ago, and on Browserbase it left all 39 candidates
 * `uncertain` because not one headline names the company.
 */
export async function filterContactsByCompany(
  company: CompanyContext,
  candidates: CandidateContact[],
): Promise<VerifiedContact[]> {
  if (candidates.length === 0) return [];

  const indexed = candidates.map((c, originalIndex) => ({
    ...c,
    originalIndex,
  }));
  const hintedCount = indexed.filter((c) =>
    headlineMentionsCompany(c.rawHeadline, company.name),
  ).length;

  console.log(
    `[contact-filter] Judging ${candidates.length} candidates for "${company.name}" (${hintedCount} name-matched headlines)`,
  );

  const summaries = indexed
    .map((c, i) => {
      const text = (c.pageText ?? "").replace(/\s+/g, " ").slice(0, 1800);
      return [
        `[${i}] headline: ${c.rawHeadline || c.name}${c.title ? ` (parsed role: ${c.title})` : ""}`,
        `    headline names the target company: ${
          headlineMentionsCompany(c.rawHeadline, company.name) ? "yes" : "no"
        }`,
        `    page dated: ${c.pageDate ?? "unknown"}`,
        `    page text: ${text || "(none)"}`,
      ].join("\n");
    })
    .join("\n\n");

  try {
    const { object, usage } = await generateObject({
      abortSignal: llmTimeout(),
      model: anthropic(MODELS.LIGHT),
      schema: apiSafeSchema(
        z.object({
          judged: z.array(
            z.object({
              index: z
                .number()
                .int()
                .describe("Index of the candidate from the input list"),
              name: z.string().describe("Cleaned full name"),
              title: z
                .string()
                .nullable()
                .describe("Cleaned job title without company name"),
              verdict: z
                .enum(["verified", "former_employee", "uncertain", "rejected"])
                .describe(
                  "verified = evidence says they work there now; former_employee = they worked there and the role has an end date; rejected = evidence places them at a different company; uncertain = the evidence does not settle it",
                ),
              evidence: z
                .string()
                .describe(
                  "One short sentence citing what decided it, e.g. \"headline reads 'Wafer'\" or 'headline names no employer'",
                ),
              employerSeen: z
                .string()
                .nullable()
                .describe("The employer the evidence actually names, if any"),
              datesSeen: z
                .string()
                .nullable()
                .describe(
                  "The date range the evidence gives for that employer, e.g. 'May 2024 - Present'",
                ),
              location: z
                .string()
                .nullable()
                .describe(
                  "The person's own location exactly as the headline or page text states it, e.g. 'San Francisco Bay Area'. Null when no source states where THIS person is. NEVER fill it from the target company's location or guess it from context.",
                ),
            }),
          ),
        }),
      ),
      prompt: `You are judging whether each LinkedIn search result actually works at a specific company.

${UNTRUSTED_NOTICE}

Target company:
- Name: ${stringify(company.name)}
- Domain: ${stringify(company.domain || "unknown")}
- Industry: ${stringify(company.industry || "unknown")}
- Location: ${stringify(company.location || "unknown")}

Candidates (scraped from LinkedIn results):
${wrapUntrusted(summaries)}

Today's date: ${new Date().toISOString().slice(0, 10)}

Each candidate gives you a headline plus whatever text was scraped from their profile page. The text usually contains a dated experience section. Read it: the headline is the weakest evidence available and often names no employer at all.

Return a verdict for EVERY candidate. Use exactly four verdicts:

- "verified": the evidence places them at the target company with no end date, or an explicit Present or Current.
- "former_employee": the evidence places them at the target company with an END DATE in the past, or the text says prev or ex. They really did work there, and they do not now.
- "rejected": the evidence positively places them at a DIFFERENT employer and never mentions the target company. A full experience listing that names other companies and never names the target is positive evidence of absence, not missing evidence. Similarly-named but different companies belong here ("Dixons Carphone" is NOT "Dixons Estate Agents"). Use the domain and industry to disambiguate.
- "uncertain": the evidence does not settle it. Use this when the page text is "(none)" or is only a headline naming no employer. Do not reach for "rejected" on thin evidence: at small companies most people never mention their employer anywhere we can see.

When the page shows several roles, prefer the most recent. If the headline names one employer and a dated block names another, the one marked Present or Current wins.

Do not guess in order to avoid "uncertain". An honest "uncertain" is more useful than a confident mistake in either direction: uncertain contacts are kept and queued for human review, while rejected ones are detached from the company.

Also report which employer you actually saw and what dates, so a human can audit the call, and clean up the display fields:
- names: remove LinkedIn suffixes, emoji, excessive credentials
- titles: extract just the role ("Branch Manager", not "Branch Manager at Dixons")
- location: only what a source states for the person themselves, e.g. "San Francisco Bay Area". Where the company sits says nothing about where this person is, so never copy the target company's location, and return null rather than guessing.`,
    });

    trackUsage({
      service: "claude",
      operation: "contact-filter",
      tokens_input: usage.inputTokens ?? 0,
      tokens_output: usage.outputTokens ?? 0,
      estimated_cost_usd: estimateClaudeCostFromUsage("haiku", usage),
      metadata: {
        model: "claude-haiku-4-5",
        companyName: company.name,
        candidateCount: indexed.length,
        verifiedCount: object.judged.filter((v) => v.verdict === "verified")
          .length,
        formerEmployeeCount: object.judged.filter(
          (v) => v.verdict === "former_employee",
        ).length,
        uncertainCount: object.judged.filter((v) => v.verdict === "uncertain")
          .length,
        rejectedCount: object.judged.filter((v) => v.verdict === "rejected")
          .length,
      },
    });

    // Drop hallucinated indices, then map back to the caller's numbering.
    const seen = new Set<number>();
    const judged: VerifiedContact[] = [];
    for (const v of object.judged) {
      const original = indexed[v.index];
      if (!original || seen.has(v.index)) continue;
      seen.add(v.index);
      judged.push({
        index: original.originalIndex,
        name: v.name,
        title: v.title,
        verdict: v.verdict,
        evidence: v.evidence,
        employerSeen: v.employerSeen ?? null,
        datesSeen: v.datesSeen ?? null,
        location: v.location ?? null,
      });
    }

    // Anything the model failed to return a verdict for is unknown, not bad.
    // `seen` holds positions in `indexed`, which nothing reorders, so checking
    // it by position replaces the old O(n^2) indexOf-plus-rescan of `judged`.
    indexed.forEach((c, position) => {
      if (seen.has(position)) return;
      judged.push({
        index: c.originalIndex,
        name: c.name,
        title: c.title,
        verdict: "uncertain",
        evidence: "no verdict returned for this candidate",
      });
    });

    // `judged[].index` is the caller's originalIndex, which happens to equal
    // the position in `indexed` only because nothing reorders that array. Look
    // the candidate up by originalIndex so a future reordering cannot silently
    // pair a verdict with someone else's page date.
    const byOriginalIndex = new Map(
      indexed.map((c) => [c.originalIndex, c] as const),
    );
    const now = Date.now();
    return judged.map((v) =>
      downgradeStale(v, byOriginalIndex.get(v.index)?.pageDate, now),
    );
  } catch (err) {
    console.error(
      "[contact-filter] LLM judge failed; returning all candidates as uncertain:",
      err,
    );
    // The old fallback discarded every candidate on an LLM error, which turns a
    // transient outage into silent data loss. Uncertain keeps them, visibly
    // unproven, and the send gate still refuses them until something confirms.
    return candidates.map((c, index) => ({
      index,
      name: c.name,
      title: c.title,
      verdict: "uncertain" as const,
      evidence: "affiliation check unavailable",
    }));
  }
}
