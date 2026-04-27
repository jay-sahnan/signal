/**
 * Signal Engine — problem-first company discovery & signal enrichment.
 *
 * Design principles:
 *  1. Every signal must answer: "Why should I call THIS company THIS week?"
 *  2. Signals must be VERIFIABLE — click a link and see the evidence.
 *  3. Signals must be DIFFERENTIATING — separates a target from 100 other companies.
 *  4. Scoring is tiered: compelled > triggered > active > latent. No participation trophies.
 *  5. Seed companies from targeting docs are the first source of truth.
 *
 * Signal tiers:
 *  Tier 1 (score 10): Compelled buyer — consent order, active enforcement
 *  Tier 2 (score 9):  Triggered buyer — new CCO hire, rising CFPB complaints, PE acquisition
 *  Tier 3 (score 8):  Active buyer — compliance/QA job posting, AI deployment, vendor evaluation
 *  Tier 4 (score 6):  Latent buyer — ICP match with no dynamic signal
 *  Tier 5 (score ≤4): Not ready — doesn't match ICP or has counter-signals
 */

const EXA_API_KEY = process.env.EXA_API_KEY;
const EXA_BASE = "https://api.exa.ai/search";

interface ExaResult {
  title: string;
  url: string;
  publishedDate: string | null;
  text: string | null;
  highlights?: string[];
}

async function exaSearch(
  query: string,
  numResults = 5,
  daysBack = 14,
): Promise<ExaResult[]> {
  if (!EXA_API_KEY) return [];
  const startDate = new Date(Date.now() - daysBack * 86400000)
    .toISOString()
    .split("T")[0];

  try {
    const res = await fetch(EXA_BASE, {
      method: "POST",
      headers: { "x-api-key": EXA_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        numResults,
        useAutoprompt: false,
        type: "neural",
        startPublishedDate: startDate,
        contents: { text: { maxCharacters: 500 } },
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data as { results: ExaResult[] }).results ?? [];
  } catch {
    return [];
  }
}

// ── Known high-value seed companies ─────────────────────────────────
// Extracted from targeting docs — these are the NAMED targets.

interface SeedCompany {
  name: string;
  domain: string;
  presets: string[];
  context: string; // why this company is a target
}

const SEED_COMPANIES: SeedCompany[] = [
  // Complaints & Sales Compliance — Auto Finance
  {
    name: "Westlake Financial",
    domain: "westlakefinancial.com",
    presets: ["complaints", "sales-compliance"],
    context:
      "Independent subprime auto lender, $44M CFPB consent order history, highest-risk profile",
  },
  {
    name: "Credit Acceptance",
    domain: "creditacceptance.com",
    presets: ["complaints", "sales-compliance"],
    context:
      "Subprime auto finance, heavy CFPB scrutiny, high complaint volumes",
  },
  {
    name: "DT Acceptance",
    domain: "dtacceptance.com",
    presets: ["complaints", "sales-compliance"],
    context: "Independent subprime auto lender, deep subprime focus",
  },
  {
    name: "DriveTime",
    domain: "drivetime.com",
    presets: ["complaints", "sales-compliance"],
    context:
      "BHPH dealer group, aggressive collections, vulnerable consumer base",
  },
  {
    name: "CarMax Auto Finance",
    domain: "carmax.com",
    presets: ["complaints", "sales-compliance"],
    context: "Major auto finance, high volume servicing",
  },
  {
    name: "Ally Financial",
    domain: "ally.com",
    presets: ["complaints", "sales-compliance"],
    context:
      "Major auto lender, $98M consent order history, high public complaint volume",
  },
  {
    name: "GM Financial",
    domain: "gmfinancial.com",
    presets: ["complaints", "sales-compliance"],
    context:
      "Captive finance, massive origination volume, regulatory spotlight",
  },
  {
    name: "Toyota Motor Credit",
    domain: "toyotafinancial.com",
    presets: ["complaints", "sales-compliance"],
    context: "Captive finance, high volume, CFPB supervised",
  },
  {
    name: "Ford Motor Credit",
    domain: "ford.com",
    presets: ["complaints", "sales-compliance"],
    context: "Captive finance, high volume, CFPB supervised",
  },
  {
    name: "Lendbuzz",
    domain: "lendbuzz.com",
    presets: ["complaints", "sales-compliance"],
    context:
      "Digital auto lender, fast-growing, compliance infrastructure lagging growth",
  },
  {
    name: "Caribou",
    domain: "caribou.com",
    presets: ["complaints", "sales-compliance"],
    context: "Digital auto lending, fast-growing fintech",
  },

  // Complaints & Sales Compliance — Consumer Lending / Mortgage
  {
    name: "LendingClub",
    domain: "lendingclub.com",
    presets: ["complaints", "sales-compliance"],
    context: "High origination volume personal loans, CFPB supervised",
  },
  {
    name: "Upgrade",
    domain: "upgrade.com",
    presets: ["complaints", "sales-compliance"],
    context: "Personal loan/installment lender, high volume",
  },
  {
    name: "Avant",
    domain: "avant.com",
    presets: ["complaints", "sales-compliance"],
    context: "Near-prime personal loans, high complaint risk",
  },
  {
    name: "Best Egg",
    domain: "bestegg.com",
    presets: ["complaints", "sales-compliance"],
    context: "Personal loan originator, consumer lending",
  },
  {
    name: "Oportun",
    domain: "oportun.com",
    presets: ["complaints", "sales-compliance"],
    context: "Community lending, CFPB scrutiny",
  },
  {
    name: "loanDepot",
    domain: "loandepot.com",
    presets: ["complaints", "sales-compliance"],
    context: "Mortgage servicer, one of most-complained-about at CFPB",
  },
  {
    name: "Newrez",
    domain: "newrez.com",
    presets: ["complaints"],
    context: "Mortgage servicer, high CFPB complaint volumes",
  },
  {
    name: "Mr. Cooper",
    domain: "mrcooper.com",
    presets: ["complaints"],
    context: "Large mortgage servicer, CFPB supervised",
  },
  {
    name: "Flagstar",
    domain: "flagstar.com",
    presets: ["complaints"],
    context: "Mortgage servicer, high complaint volume",
  },
  {
    name: "SoFi",
    domain: "sofi.com",
    presets: ["complaints", "sales-compliance", "qa"],
    context: "Multi-product fintech, high growth, scaling CX",
  },

  // QA — Fintech / SaaS with CX operations
  {
    name: "Brex",
    domain: "brex.com",
    presets: ["qa"],
    context: "Fintech scaling CX, enterprise focus",
  },
  {
    name: "Ramp",
    domain: "ramp.com",
    presets: ["qa"],
    context: "Fintech with growing support operations",
  },
  {
    name: "Plaid",
    domain: "plaid.com",
    presets: ["qa"],
    context: "Financial infra, growing support team",
  },
  {
    name: "Chime",
    domain: "chime.com",
    presets: ["qa", "complaints"],
    context: "Neobank, high consumer volume, CFPB complaints",
  },
  {
    name: "Affirm",
    domain: "affirm.com",
    presets: ["qa", "complaints"],
    context: "BNPL, high consumer volume, regulatory scrutiny",
  },
  {
    name: "Klarna",
    domain: "klarna.com",
    presets: ["qa", "complaints"],
    context: "BNPL, massive CX volume, scaling AI agents",
  },
  {
    name: "Marqeta",
    domain: "marqeta.com",
    presets: ["qa"],
    context: "Card issuing platform, growing support",
  },
  {
    name: "Toast",
    domain: "toasttab.com",
    presets: ["qa"],
    context: "Restaurant tech, large SMB support base",
  },
  {
    name: "Gusto",
    domain: "gusto.com",
    presets: ["qa"],
    context: "HR/Payroll SaaS, high-volume SMB support",
  },
  {
    name: "Rippling",
    domain: "rippling.com",
    presets: ["qa"],
    context: "HR platform, fast scaling CX",
  },
];

// ── Discovery ───────────────────────────────────────────────────────

export interface DiscoveredCompany {
  name: string;
  domain: string;
  source: "seed" | "exa_problem" | "exa_effort" | "exa_company_site";
  evidence: string;
}

const SKIP_DOMAINS = new Set([
  "reuters.com",
  "bloomberg.com",
  "cnbc.com",
  "wsj.com",
  "nytimes.com",
  "consumerfinance.gov",
  "ftc.gov",
  "sec.gov",
  "occ.gov",
  "fdic.gov",
  "trustpilot.com",
  "reddit.com",
  "bbb.org",
  "g2.com",
  "glassdoor.com",
  "indeed.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "youtube.com",
  "wikipedia.org",
  "investopedia.com",
  "forbes.com",
  "propublica.org",
  "pymnts.com",
  "finextra.com",
  "americanbanker.com",
  "housingwire.com",
  "nationalmortgagenews.com",
  "medium.com",
  "substack.com",
  "techcrunch.com",
  "crunchbase.com",
  "pitchbook.com",
  "github.com",
  "stackoverflow.com",
  "auto.com",
  "marketwatch.com",
  "seekingalpha.com",
  "yahoo.com",
  "google.com",
  "nclc.org",
  "jdsupra.com",
  "law.com",
  "govping.com",
  "govinfo.gov",
  "federalregister.gov",
]);

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isSkipDomain(domain: string): boolean {
  if (SKIP_DOMAINS.has(domain)) return true;
  if (domain.endsWith(".gov") || domain.endsWith(".edu")) return true;
  for (const skip of SKIP_DOMAINS) {
    if (domain.endsWith(`.${skip}`)) return true;
  }
  return false;
}

/**
 * Discovery queries — searches for COMPANY WEBSITES, not news articles.
 * Uses Exa neural search to find company sites matching problem descriptions.
 */
interface DiscoveryConfig {
  preset: string;
  queries: Array<{ query: string; daysBack: number }>;
}

const DISCOVERY_CONFIGS: DiscoveryConfig[] = [
  {
    preset: "complaints",
    queries: [
      // Find company websites in auto finance / consumer lending space
      {
        query: "auto finance company servicing loans consumer lending",
        daysBack: 90,
      },
      {
        query: "consumer lending company mortgage servicing collections",
        daysBack: 90,
      },
      // Find companies mentioned in enforcement context
      {
        query:
          "CFPB enforcement action auto finance consumer lending company 2025 2026",
        daysBack: 60,
      },
    ],
  },
  {
    preset: "sales-compliance",
    queries: [
      {
        query: "auto lending company sales finance origination consumer",
        daysBack: 90,
      },
      {
        query: "UDAAP fair lending auto finance enforcement 2025 2026",
        daysBack: 60,
      },
    ],
  },
  {
    preset: "qa",
    queries: [
      {
        query: "fintech company customer support team scaling AI chatbot",
        daysBack: 30,
      },
      {
        query:
          "SaaS company customer experience operations quality assurance contact center",
        daysBack: 30,
      },
    ],
  },
];

export async function discoverCompanies(
  preset: string,
  targetCount = 25,
): Promise<DiscoveredCompany[]> {
  const allCompanies: DiscoveredCompany[] = [];
  const seenDomains = new Set<string>();

  // 1. Seed companies first — these are known high-value targets
  for (const seed of SEED_COMPANIES) {
    if (!seed.presets.includes(preset)) continue;
    if (seenDomains.has(seed.domain)) continue;
    seenDomains.add(seed.domain);
    allCompanies.push({
      name: seed.name,
      domain: seed.domain,
      source: "seed",
      evidence: seed.context,
    });
  }

  // 2. Exa discovery — find additional companies
  const config = DISCOVERY_CONFIGS.find((d) => d.preset === preset);
  if (config && allCompanies.length < targetCount) {
    for (const q of config.queries) {
      if (allCompanies.length >= targetCount) break;
      const results = await exaSearch(q.query, 10, q.daysBack);
      for (const r of results) {
        const domain = extractDomain(r.url);
        if (!domain || isSkipDomain(domain) || seenDomains.has(domain))
          continue;
        seenDomains.add(domain);

        const cleanName = domain
          .replace(/\.(com|co|io|net|org|llc|inc)$/i, "")
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());

        allCompanies.push({
          name: cleanName,
          domain,
          source: "exa_company_site",
          evidence: (r.text ?? r.title ?? "").slice(0, 200),
        });
      }
    }
  }

  return allCompanies.slice(0, targetCount);
}

// ── Signal Definitions ──────────────────────────────────────────────

export interface SignalResult {
  signalName: string;
  tier: 1 | 2 | 3 | 4;
  found: boolean;
  summary: string;
  confidence: "high" | "medium" | "low";
  evidence: Array<{ url: string; snippet: string }>;
  hits: number;
  scoreBoost: number; // how many points this signal adds
}

interface SignalDef {
  name: string;
  tier: 1 | 2 | 3;
  scoreBoost: number;
  presets: string[];
  /** Exa query template. {company} and {domain} are replaced. */
  query: string;
  daysBack: number;
  /** Static evidence URLs to always include (templates with {company}/{domain}). */
  staticEvidence?: Array<{ urlTemplate: string; snippetTemplate: string }>;
  /**
   * Minimum hits to count as "found". Default 1.
   * Higher threshold for vague signals reduces false positives.
   */
  minHits?: number;
}

const SIGNALS: SignalDef[] = [
  // ── Tier 1: Compelled Buyer ────────────────────────────────
  {
    name: "Consent Order / Enforcement Action",
    tier: 1,
    scoreBoost: 5,
    presets: ["complaints", "sales-compliance"],
    query:
      '"{company}" consent order OR enforcement action OR CFPB fine OR civil money penalty 2025 OR 2026',
    daysBack: 180,
    staticEvidence: [
      {
        urlTemplate:
          "https://www.consumerfinance.gov/enforcement/actions/?title={company}",
        snippetTemplate: "CFPB enforcement actions for {company}",
      },
    ],
  },

  // ── Tier 2: Triggered Buyer ────────────────────────────────
  {
    name: "New Compliance / CX Leader Hired",
    tier: 2,
    scoreBoost: 4,
    presets: ["complaints", "sales-compliance", "qa"],
    query:
      '"{company}" hired OR appointed OR named Chief Compliance Officer OR Head of CX OR VP Customer Experience OR VP Operations OR CCO OR General Counsel',
    daysBack: 90,
    staticEvidence: [
      {
        urlTemplate: "https://www.linkedin.com/company/{domainClean}/people/",
        snippetTemplate: "LinkedIn people at {company}",
      },
    ],
  },
  {
    name: "Rising CFPB Complaints",
    tier: 2,
    scoreBoost: 4,
    presets: ["complaints", "sales-compliance"],
    query:
      '"{company}" CFPB complaints rising OR increasing OR surge OR volume consumer financial protection',
    daysBack: 60,
    staticEvidence: [
      {
        urlTemplate:
          "https://www.consumerfinance.gov/data-research/consumer-complaints/search/?company={company}",
        snippetTemplate: "CFPB complaint database for {company}",
      },
    ],
  },
  {
    name: "Trustpilot / Public Review Deterioration",
    tier: 2,
    scoreBoost: 3,
    presets: ["complaints"],
    query:
      '"{company}" Trustpilot OR BBB complaints OR terrible service OR worst experience OR scam',
    daysBack: 30,
    staticEvidence: [
      {
        urlTemplate: "https://www.trustpilot.com/review/{domain}",
        snippetTemplate: "Trustpilot reviews for {company}",
      },
    ],
  },
  {
    name: "PE Acquisition / Ownership Change",
    tier: 2,
    scoreBoost: 3,
    presets: ["complaints", "sales-compliance"],
    query:
      '"{company}" acquired OR private equity acquisition OR new ownership OR ownership change auto finance OR lending',
    daysBack: 180,
  },

  // ── Tier 3: Active Buyer ───────────────────────────────────
  {
    name: "Compliance / QA Job Posting",
    tier: 3,
    scoreBoost: 2,
    presets: ["complaints", "sales-compliance", "qa"],
    query:
      '"{company}" hiring OR job OR career "complaint" OR "QA Manager" OR "Quality Analyst" OR "compliance monitoring" OR "UDAAP" OR "fair lending"',
    daysBack: 30,
    staticEvidence: [
      {
        urlTemplate: "https://www.linkedin.com/company/{domainClean}/jobs/",
        snippetTemplate: "LinkedIn jobs at {company}",
      },
    ],
  },
  {
    name: "AI Agent Deployment",
    tier: 3,
    scoreBoost: 2,
    presets: ["qa"],
    query:
      '"{company}" deployed OR launched AI agent OR AI chatbot OR voice AI OR conversational AI customer service',
    daysBack: 60,
  },
  {
    name: "UDAAP / Sales Practice Risk",
    tier: 3,
    scoreBoost: 2,
    presets: ["sales-compliance"],
    query:
      '"{company}" UDAAP violation OR misleading sales OR disclosure failure OR fair lending violation OR deceptive practice',
    daysBack: 90,
  },
  {
    name: "CX Team Scaling",
    tier: 3,
    scoreBoost: 1,
    presets: ["qa"],
    query:
      '"{company}" growing customer support OR expanding CX team OR hired customer experience OR scaling contact center',
    daysBack: 30,
    minHits: 2,
  },
];

function cleanDomainForLinkedIn(domain: string): string {
  return domain.replace(/^www\./, "").replace(/\.(com|co|io|net|org)$/i, "");
}

export async function runSignals(
  companyName: string,
  preset: string,
  domain?: string | null,
): Promise<SignalResult[]> {
  const applicable = SIGNALS.filter((s) => s.presets.includes(preset));
  const results: SignalResult[] = [];
  const cleanDomain = domain ? domain.replace(/^www\./, "") : "";
  const domainClean = cleanDomainForLinkedIn(cleanDomain);

  for (const signal of applicable) {
    const query = signal.query
      .replace(/\{company\}/g, companyName)
      .replace(/\{domain\}/g, cleanDomain);

    const hits = await exaSearch(query, 5, signal.daysBack);
    const minHits = signal.minHits ?? 1;
    const found = hits.length >= minHits;

    // Build evidence
    const evidence = hits.slice(0, 3).map((h) => ({
      url: h.url,
      snippet: (h.text ?? h.title ?? "")
        .slice(0, 150)
        .replace(/\n/g, " ")
        .trim(),
    }));

    // Add static evidence links
    if (signal.staticEvidence) {
      for (const se of signal.staticEvidence) {
        evidence.push({
          url: se.urlTemplate
            .replace(/\{company\}/g, encodeURIComponent(companyName))
            .replace(/\{domain\}/g, cleanDomain)
            .replace(/\{domainClean\}/g, domainClean),
          snippet: se.snippetTemplate
            .replace(/\{company\}/g, companyName)
            .replace(/\{domain\}/g, cleanDomain),
        });
      }
    }

    // Confidence: based on hit quality, not just count
    let confidence: "high" | "medium" | "low" = "low";
    if (found) {
      // Check if any hit actually mentions the company name (not just vague match)
      const mentionsCompany = hits.some(
        (h) =>
          (h.text ?? h.title ?? "")
            .toLowerCase()
            .includes(companyName.toLowerCase()) ||
          (h.url ?? "")
            .toLowerCase()
            .includes(companyName.toLowerCase().replace(/\s/g, "")),
      );
      confidence =
        mentionsCompany && hits.length >= 2
          ? "high"
          : mentionsCompany
            ? "medium"
            : "medium";
    }

    results.push({
      signalName: signal.name,
      tier: signal.tier,
      found,
      summary: found
        ? (hits[0].text ?? hits[0].title ?? "")
            .slice(0, 200)
            .replace(/\n/g, " ")
            .trim()
        : "No evidence found",
      confidence,
      evidence: evidence.slice(0, 5),
      hits: hits.length,
      scoreBoost: found ? signal.scoreBoost : 0,
    });
  }

  return results;
}

// ── Scoring ─────────────────────────────────────────────────────────

export function scoreCompany(
  signals: SignalResult[],
  _preset: string,
): {
  score: number;
  reason: string;
  confidence: "High" | "Medium" | "Low";
  tier: string;
} {
  const fired = signals.filter((s) => s.found);

  if (fired.length === 0) {
    return {
      score: 5,
      reason: "ICP fit only — no dynamic signals detected",
      confidence: "Low",
      tier: "Latent",
    };
  }

  // Sum score boosts from all fired signals, starting from base of 5
  let score = 5;
  for (const s of fired) {
    score += s.scoreBoost;
  }
  score = Math.min(score, 10);

  // Determine tier label
  const bestTier = Math.min(...fired.map((s) => s.tier));
  const tierLabel =
    bestTier === 1 ? "Compelled" : bestTier === 2 ? "Triggered" : "Active";

  // Build reason from top signals (highest boost first)
  const sortedFired = [...fired].sort((a, b) => b.scoreBoost - a.scoreBoost);
  const reason = sortedFired
    .slice(0, 3)
    .map((s) => {
      const summary = s.summary.slice(0, 80);
      return `${s.signalName}: ${summary}`;
    })
    .join(" | ");

  // Confidence based on signal quality
  const highConfidence = fired.filter((s) => s.confidence === "high").length;
  const confidence: "High" | "Medium" | "Low" =
    highConfidence >= 2 || bestTier === 1
      ? "High"
      : highConfidence >= 1
        ? "Medium"
        : "Low";

  return { score, reason, confidence, tier: tierLabel };
}

// ── ICP Classification ──────────────────────────────────────────────

export function classifyICP(
  signals: SignalResult[],
  preset: string,
): { primary: string; secondary: string[]; reasoning: string } {
  const icpLabels: Record<string, string> = {
    complaints: "Complaints Ops",
    "sales-compliance": "Sales Compliance",
    qa: "QA / Agent Performance",
  };

  const primary = icpLabels[preset] ?? preset;
  const secondary: string[] = [];
  const fired = signals.filter((s) => s.found);

  let reasoning = `ICP: ${primary}`;
  if (fired.length > 0) {
    reasoning += ` — ${fired.length} signal${fired.length > 1 ? "s" : ""} detected`;
    const bestTier = Math.min(...fired.map((s) => s.tier));
    if (bestTier === 1) reasoning += " (compelled buyer — enforcement action)";
    else if (bestTier === 2) reasoning += " (triggered — recent change event)";
  }

  // Cross-sell signals
  if (
    preset === "complaints" &&
    fired.some(
      (s) => s.signalName.includes("QA") || s.signalName.includes("CX"),
    )
  ) {
    secondary.push("QA / Agent Performance");
  }
  if (
    preset === "sales-compliance" &&
    fired.some(
      (s) =>
        s.signalName.includes("Complaint") || s.signalName.includes("CFPB"),
    )
  ) {
    secondary.push("Complaints Ops");
  }

  return { primary, secondary, reasoning };
}

// ── Outreach Generation ─────────────────────────────────────────────

export interface EnrichedCompanyOutput {
  name: string;
  domain: string | null;
  headcount: number | null;
  industry: string | null;
  location: string | null;
  icpPrimary: string;
  icpSecondary: string[];
  icpReasoning: string;
  signals: SignalResult[];
  score: number;
  scoreReason: string;
  confidence: "High" | "Medium" | "Low";
  contacts: Array<{
    name: string;
    title: string | null;
    email: string | null;
    linkedinUrl: string | null;
  }>;
  linkedinNote: string;
  message: string;
  callOpener: string;
  pitchAngle: string;
  sources: string[];
}

export function generateOutreach(
  companyName: string,
  signals: SignalResult[],
  preset: string,
  contactName?: string,
): {
  linkedinNote: string;
  message: string;
  callOpener: string;
  pitchAngle: string;
  creativePlay: string;
} {
  const fired = signals.filter((s) => s.found);
  const topSignal = fired.sort((a, b) => b.scoreBoost - a.scoreBoost)[0];
  const first = contactName ?? "there";

  const pitchAngles: Record<string, string> = {
    complaints:
      "We detect 100% of complaints — including the 70% agents never log — before they become enforcement actions.",
    "sales-compliance":
      "We monitor every sales call for UDAAP, disclosure, and fair lending violations with auditable evidence examiners want to see.",
    qa: "We replace 1-3% manual sampling with 100% AI-powered QA across every channel.",
  };
  const pitchAngle = pitchAngles[preset] ?? pitchAngles.qa;

  let linkedinNote = "";
  let message = "";
  let callOpener = "";
  let creativePlay = "";

  // Route by top signal, not preset — the signal IS the reason to call
  if (
    topSignal?.signalName.includes("Consent Order") ||
    topSignal?.signalName.includes("Enforcement")
  ) {
    linkedinNote = `Hi ${first} — saw the CFPB activity around ${companyName}. We help lenders catch the complaints that lead to enforcement before they compound. Thought it might be timely.`;
    message = `Hi ${first},\n\nThe regulatory activity around ${companyName} caught my attention. The pattern we see: complaint detection is almost always the root cause. Agents manually log maybe 30% of actual dissatisfaction — the rest festers until an examiner finds it.\n\nWe built Rulebase for exactly this. AI that flags every expression of dissatisfaction across every call, with timestamps and citations.\n\n15 minutes to show you?`;
    callOpener = `Hi ${first} — following up on a note I sent about complaint monitoring at ${companyName}. Quick question: right now, how are you catching the complaints that agents don't manually escalate?`;
    creativePlay = `Send a "Compliance Survival Kit" to ${first} at ${companyName} HQ — a small box with a branded stress ball, a one-pager titled "The 70% Problem: What Your Agents Aren't Logging," and a QR code to a 3-min Loom demo. Handwritten note: "Thought this might be useful given what's been happening. — Gideon"`;
  } else if (
    topSignal?.signalName.includes("Trustpilot") ||
    topSignal?.signalName.includes("CFPB Complaint")
  ) {
    linkedinNote = `Hi ${first} — ${companyName}'s Trustpilot caught my eye. We help lenders catch the complaints behind those reviews before they escalate. Worth connecting?`;
    message = `Hi ${first},\n\n${companyName}'s public reviews paint a picture — and what we consistently see is that the reviews are just the tip. For every Trustpilot complaint, there are 5-10 expressions of dissatisfaction buried in calls that never get logged.\n\nRulebase surfaces all of them automatically. No manual tagging, no missed complaints.\n\nOpen to a quick look?`;
    callOpener = `Hi ${first} — sent a note about the Trustpilot trends at ${companyName}. Curious: are you seeing the same themes internally that customers are posting publicly?`;
    creativePlay = `Print ${companyName}'s top 5 worst Trustpilot reviews on individual cards. On the back of each: "Rulebase would have caught this before it went public." Mail in a clean envelope to ${first} with a sticky note: "These are just the ones who bothered to post. — Gideon" + Calendly link.`;
  } else if (
    topSignal?.signalName.includes("Leader Hired") ||
    topSignal?.signalName.includes("New Compliance")
  ) {
    linkedinNote = `Hi ${first} — congrats on the new role at ${companyName}. The first 90 days are when most leaders audit QA and compliance tooling. Rulebase gives you instant visibility into 100% of conversations. Would love to connect.`;
    message = `Hi ${first},\n\nFirst 90 days in a new role is when you audit what's actually happening vs what people tell you. Most leaders discover QA covers 1-3% of conversations and complaint detection is manual.\n\nRulebase gives you full visibility — 100% conversation evaluation — from day one.\n\nWorth 15 min to see if it's relevant?`;
    callOpener = `Hi ${first} — when you joined ${companyName}, what did the QA coverage picture look like? Were you surprised?`;
    creativePlay = `Send a "New Leader Starter Pack" — branded notebook + one-pager: "5 Questions Every New CCO / CX Leader Asks in Week 1 (and How to Get Real Answers Fast)." QR to Calendly. Ship to ${first} at ${companyName}.`;
  } else if (topSignal?.signalName.includes("PE Acquisition")) {
    linkedinNote = `Hi ${first} — saw the ownership change at ${companyName}. New owners usually want compliance risk quantified. We help make that visible. Worth connecting?`;
    message = `Hi ${first},\n\nPost-acquisition, the compliance picture is always murkier than expected. New ownership wants clean books — but most lenders can only show compliance coverage on 2-3% of conversations.\n\nRulebase monitors 100% of calls with auditable evidence. Makes the risk quantifiable.\n\nRelevant for what ${companyName} is going through?`;
    callOpener = `Hi ${first} — how has the compliance infrastructure held up since the ownership change at ${companyName}?`;
    creativePlay = `Send a "Due Diligence Kit" — folder with: "Compliance Risk Scorecard for Lenders Post-Acquisition" one-pager, sample Rulebase audit report. FedEx to ${first} at ${companyName}. Note: "For the conversation you're probably already having. — Gideon"`;
  } else if (topSignal?.signalName.includes("AI Agent")) {
    linkedinNote = `Hi ${first} — saw ${companyName} is going big on AI for CX. Who QAs the AI? We built that. Would love to connect.`;
    message = `Hi ${first},\n\nSaw ${companyName} is deploying AI across CX — and it creates a problem nobody had 18 months ago: who quality-checks the AI?\n\nYour QA team can't manually review AI conversations at scale. Regulators expect the same oversight on AI as human interactions.\n\nRulebase evaluates 100% of both. Worth a look?`;
    callOpener = `Hi ${first} — how are you monitoring quality on the AI-handled conversations at ${companyName} right now?`;
    creativePlay = `Send a "Robot Report Card" — novelty report card grading ${companyName}'s AI agent: Communication A-, Accuracy ?, Compliance ?, Empathy C+. Inside: "Your AI is handling thousands of conversations. Who's grading them? — Gideon @ Rulebase" + Calendly.`;
  } else if (
    topSignal?.signalName.includes("Job Posting") ||
    topSignal?.signalName.includes("Compliance")
  ) {
    linkedinNote = `Hi ${first} — noticed ${companyName} is hiring for compliance/QA. Usually means the current approach isn't working. We can help. Worth connecting?`;
    message = `Hi ${first},\n\nSaw ${companyName} is investing in compliance / QA hiring. Usually means leadership has realised the current approach — manual sampling of a few percent — isn't working.\n\nRulebase gets you to 100% coverage faster than another hire. And it's always there, not just during business hours.\n\nWorth a quick conversation?`;
    callOpener = `Hi ${first} — what's driving the compliance/QA investment at ${companyName} right now? We keep seeing companies realize manual sampling isn't enough.`;
    creativePlay = `Send a magnifying glass to ${first} at ${companyName}. Tag: "You're using this to review 3% of conversations. We review 100% without it." Back: "No gimmick — just math. — Gideon @ Rulebase" + QR to Calendly.`;
  } else if (topSignal?.signalName.includes("UDAAP")) {
    linkedinNote = `Hi ${first} — ${companyName} has the kind of sales operation CFPB examiners love to audit. We make sure every call is clean. Worth connecting?`;
    message = `Hi ${first},\n\nSales reps skip or botch required disclosures on roughly 10-15% of calls. At ${companyName}'s scale, that's hundreds of violations per month nobody catches until an examiner does.\n\nRulebase listens to every call and flags the gaps in real time. Deploys in days.\n\nRelevant?`;
    callOpener = `Hi ${first} — what percentage of ${companyName}'s sales calls are being reviewed for compliance today?`;
    creativePlay = `Create a "CFPB Exam Prep Box" — branded folder with: (1) top 5 UDAAP violations in auto finance this year, (2) mock exam checklist. FedEx to ${first} at ${companyName}. Note: "For when the examiner calls. — Gideon"`;
  } else {
    // Generic fallback based on preset
    if (preset === "complaints" || preset === "sales-compliance") {
      linkedinNote = `Hi ${first} — we help lenders like ${companyName} catch the 70% of complaints agents never log. Would love to connect.`;
      message = `Hi ${first},\n\nQuick question: what percentage of customer complaints at ${companyName} do you think actually get logged?\n\nIndustry average is about 30%. The rest — implicit dissatisfaction, vague frustration, "I want to speak to someone else" — never makes it into a report.\n\nRulebase catches all of it. Worth 15 min?`;
      callOpener = `Hi ${first} — if I told you most lenders only capture about a third of actual complaints, would that surprise you?`;
      creativePlay = `Send a dozen cupcakes to ${first} at ${companyName}'s HQ. Each has a tiny "1 in 3" flag. Card: "You're only catching 1 in 3 complaints. Let us show you the other two. — Gideon @ Rulebase" + Calendly.`;
    } else {
      linkedinNote = `Hi ${first} — ${companyName} is scaling fast. QA is usually the first thing that breaks. We fix that.`;
      message = `Hi ${first},\n\nMost CX teams review 1-3% of conversations hoping the sample is representative. It never is.\n\nRulebase evaluates 100% automatically — coaching insights, compliance flags, trend detection — without adding headcount.\n\nRelevant for ${companyName}?`;
      callOpener = `Hi ${first} — roughly what percentage of customer conversations does ${companyName} review for quality?`;
      creativePlay = `Mail a magnifying glass to ${first} at ${companyName}. Tag: "You're using this to review 3% of conversations. We review 100% without it." — Gideon @ Rulebase + QR to Calendly.`;
    }
  }

  return { linkedinNote, message, callOpener, pitchAngle, creativePlay };
}
