/**
 * Event-first company discovery for the Revenue Agent motion.
 *
 * Instead of re-checking a fixed list (which yields the same companies every
 * day), this queries the SIGNALS themselves across the fintech space with a
 * recency window, then uses the model to extract the subject company from each
 * news hit. Whatever just triggered an event this window becomes the list, so
 * the universe churns and grows over time. The pipeline dedups by domain
 * against the DB, so only genuinely new companies persist.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import type { DiscoveredCompany } from "./pipeline";

const EXA_API_KEY = process.env.EXA_API_KEY;
const EXA_BASE = "https://api.exa.ai/search";

interface EventQuery {
  signalType: string;
  query: string;
  daysBack: number;
}

// Signal-first: each query is an EVENT across the ICP space, not a company name.
const EVENT_QUERIES: EventQuery[] = [
  {
    signalType: "M&A / book transfer",
    daysBack: 30,
    query:
      'fintech OR payments OR neobank OR benefits OR retirement company (acquires OR "acquisition of" OR "book of business" OR "portfolio of" OR "migrates customers") (customers OR merchants OR plans OR accounts OR policyholders) 2026',
  },
  {
    signalType: "New market / license",
    daysBack: 30,
    query:
      'fintech OR payments OR remittance OR neobank ("granted license" OR "payments license" OR "banking license" OR "e-money licence" OR "EMI licence" OR "FCA authorisation" OR "Bank of Lithuania" OR "BaFin" OR "Central Bank of Ireland" OR "launches in" OR "expands to" OR "money transmitter" OR "new corridor" OR "EU passport") 2026',
  },
  {
    signalType: "New market / license",
    daysBack: 30,
    query:
      'European fintech OR "UK fintech" OR EMI OR "payment institution" (authorised OR authorized OR "granted licence" OR "launches" OR "expands into") (UK OR Europe OR Germany OR France OR Ireland OR Lithuania OR Netherlands) 2026',
  },
  {
    signalType: "Onboarding / KYB hiring",
    daysBack: 21,
    query:
      '(hiring OR "we\'re hiring" OR "join our team") ("Onboarding Specialist" OR "Implementation Manager" OR "KYB Analyst" OR "Merchant Underwriting" OR "Merchant Operations" OR "Activation Manager") fintech OR payments OR banking OR benefits 2026',
  },
  {
    signalType: "Verification / activation complaints",
    daysBack: 30,
    query:
      '(site:trustpilot.com OR site:reddit.com OR site:consumerfinance.gov) (neobank OR fintech OR remittance OR "digital bank" OR wallet) ("account verification" OR "waiting weeks" OR "cannot open account" OR "KYC" OR "documents rejected" OR "account still pending") 2026',
  },
  {
    signalType: "Dormant / activation-metric",
    daysBack: 45,
    query:
      'fintech OR payments OR lending company ("activation rate" OR "time to revenue" OR "approved but not transacting" OR "onboarding backlog" OR "merchant ramp" OR "unfunded accounts") 2026',
  },
  {
    signalType: "Sponsor bank / BaaS change",
    daysBack: 60,
    query:
      '("sponsor bank" OR "banking partner" OR "BaaS" OR "banking-as-a-service") (change OR transition OR "wind down" OR switch OR exit) fintech (re-KYC OR re-onboard OR migrate customers) 2026',
  },
];

interface ExaHit { title?: string; url?: string; text?: string; publishedDate?: string | null }

async function exaSearch(query: string, numResults: number, daysBack: number): Promise<ExaHit[]> {
  if (!EXA_API_KEY) return [];
  const start = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0];
  try {
    const res = await fetch(EXA_BASE, {
      method: "POST",
      headers: { "x-api-key": EXA_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        query, numResults, useAutoprompt: true, type: "auto",
        startPublishedDate: start, contents: { text: { maxCharacters: 500 } },
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: ExaHit[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

const NEWS_HOSTS = /businesswire|prnewswire|globenewswire|techcrunch|techcabal|finextra|pymnts|reuters|bloomberg|forbes|crunchbase|linkedin|trustpilot|reddit|consumerfinance|apple|medium|substack|wikipedia/i;
function domainFromUrl(url?: string): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

const ExtractSchema = z.object({
  companies: z.array(
    z.object({
      company: z.string().describe("The fintech operator that is the SUBJECT of the event"),
      domain: z.string().nullable().describe("Best-guess primary website domain, e.g. 'acme.com', or null"),
      isRevenueGatedFintech: z.boolean().describe("True only if this is a fintech whose revenue is gated behind onboarding/activation/KYC/KYB/underwriting/enrollment"),
      segment: z.string().describe("e.g. Payment infra, Neobank, Remittance, Benefits/HSA, Retirement, Lending, Wealth"),
      evidence: z.string().describe("One sentence: what happened and why it gates revenue"),
    }),
  ),
});

/**
 * Run the event queries, extract the subject fintech from each hit, ICP-filter,
 * and dedupe by domain. Returns DiscoveredCompany[] for the pipeline to insert
 * (the DB insert dedupes against companies already seen).
 */
export async function discoverRevenueAgentCompanies(
  targetCount = 30,
): Promise<DiscoveredCompany[]> {
  const out: DiscoveredCompany[] = [];
  const seen = new Set<string>();

  for (const eq of EVENT_QUERIES) {
    if (out.length >= targetCount) break;
    const hits = (await exaSearch(eq.query, 10, eq.daysBack)).filter((h) => h.publishedDate);
    if (hits.length === 0) continue;

    const digest = hits
      .map((h, i) => `[${i}] ${h.title ?? ""}\n${domainFromUrl(h.url) ?? ""}\n${(h.text ?? "").slice(0, 350)}`)
      .join("\n\n");

    let extracted;
    try {
      const res = await generateObject({
        model: anthropic("claude-haiku-4-5-20251001"),
        schema: ExtractSchema,
        prompt: `These are web results about a "${eq.signalType}" event in fintech. For each DISTINCT fintech OPERATOR that is the SUBJECT of one of these events, return a row.

Rules:
- Only include a company if its revenue is gated behind onboarding/activation (KYC, KYB, licensing, underwriting, enrollment, implementation) — set isRevenueGatedFintech accordingly.
- For M&A, the subject is the ACQUIRER absorbing a book of customers/merchants/plans — NOT a product/tech/talent target and NOT the news publisher.
- Ignore vendors, publishers (businesswire, techcrunch, etc.), consultancies, and non-fintechs.
- Do not invent companies. If a hit has no clear fintech operator, skip it.

Results:
${digest}`,
      });
      extracted = res.object.companies;
    } catch {
      continue;
    }

    for (const c of extracted) {
      if (!c.isRevenueGatedFintech) continue;
      const domain = (c.domain ?? "").trim().toLowerCase().replace(/^www\./, "");
      if (!domain || seen.has(domain) || NEWS_HOSTS.test(domain)) continue;
      seen.add(domain);
      out.push({
        name: c.company.trim(),
        domain,
        source: "exa_event",
        evidence: `[${eq.signalType}] ${c.evidence}`.slice(0, 200),
      });
      if (out.length >= targetCount) break;
    }
  }

  return out;
}
