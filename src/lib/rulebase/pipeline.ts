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
  // ════════════════════════════════════════════════════════════════════
  // COMPLAINTS & SALES COMPLIANCE — Auto Finance
  // ════════════════════════════════════════════════════════════════════
  {
    name: "Westlake Financial",
    domain: "westlakefinancial.com",
    presets: ["proactive-agents"],
    context:
      "$44M CFPB consent order history, independent subprime auto lender",
  },
  {
    name: "Credit Acceptance",
    domain: "creditacceptance.com",
    presets: ["proactive-agents"],
    context:
      "Subprime auto finance, heavy CFPB scrutiny, high complaint volumes",
  },
  {
    name: "DT Acceptance",
    domain: "dtacceptance.com",
    presets: ["proactive-agents"],
    context: "Independent subprime auto lender, deep subprime focus",
  },
  {
    name: "DriveTime",
    domain: "drivetime.com",
    presets: ["proactive-agents"],
    context:
      "BHPH dealer group, aggressive collections, vulnerable consumer base",
  },
  {
    name: "CarMax Auto Finance",
    domain: "carmax.com",
    presets: ["proactive-agents"],
    context: "Major auto finance, high volume servicing",
  },
  {
    name: "Ally Financial",
    domain: "ally.com",
    presets: ["proactive-agents"],
    context: "$98M consent order history, major auto lender",
  },
  {
    name: "GM Financial",
    domain: "gmfinancial.com",
    presets: ["proactive-agents"],
    context: "Captive finance, massive origination volume",
  },
  {
    name: "Toyota Motor Credit",
    domain: "toyotafinancial.com",
    presets: ["proactive-agents"],
    context: "Captive finance, high volume, CFPB supervised",
  },
  {
    name: "Ford Motor Credit",
    domain: "ford.com",
    presets: ["proactive-agents"],
    context: "Captive finance, high volume, CFPB supervised",
  },
  {
    name: "Lendbuzz",
    domain: "lendbuzz.com",
    presets: ["proactive-agents"],
    context:
      "Digital auto lender, fast-growing, compliance infrastructure lagging growth",
  },
  {
    name: "Caribou",
    domain: "caribou.com",
    presets: ["proactive-agents"],
    context: "Digital auto refinancing, fast-growing fintech",
  },
  {
    name: "Capital One Auto",
    domain: "capitalone.com",
    presets: ["proactive-agents"],
    context:
      "Massive auto lending portfolio, CFPB supervised, high complaint volume",
  },
  {
    name: "Santander Consumer USA",
    domain: "santanderconsumerusa.com",
    presets: ["proactive-agents"],
    context: "Subprime auto lender, multiple enforcement actions, high risk",
  },
  {
    name: "AmeriCredit",
    domain: "gmfinancial.com",
    presets: ["proactive-agents"],
    context: "GM Financial subsidiary, subprime auto lending",
  },
  {
    name: "Exeter Finance",
    domain: "exeterfinance.com",
    presets: ["proactive-agents"],
    context: "Subprime auto lender, PE-backed, scaling fast",
  },
  {
    name: "Carvana",
    domain: "carvana.com",
    presets: ["proactive-agents"],
    context:
      "Online auto dealer + financing, high complaint volume, recent restructuring",
  },
  {
    name: "Vroom Finance",
    domain: "vroom.com",
    presets: ["proactive-agents"],
    context: "Online auto dealer, consumer complaints",
  },
  {
    name: "World Omni Financial",
    domain: "worldomni.com",
    presets: ["proactive-agents"],
    context: "Auto finance subsidiary of Southeast Toyota",
  },
  {
    name: "ACA (American Credit Acceptance)",
    domain: "americancreditacceptance.com",
    presets: ["proactive-agents"],
    context: "Subprime auto lender, compliance risk",
  },
  {
    name: "Prestige Financial",
    domain: "gopfs.com",
    presets: ["proactive-agents"],
    context: "Deep subprime auto lender",
  },
  {
    name: "United Auto Credit",
    domain: "unitedautocredit.com",
    presets: ["proactive-agents"],
    context: "Subprime auto lender, dealer network",
  },

  // ════════════════════════════════════════════════════════════════════
  // COMPLAINTS & SALES COMPLIANCE — Consumer Lending / Mortgage
  // ════════════════════════════════════════════════════════════════════
  {
    name: "LendingClub",
    domain: "lendingclub.com",
    presets: ["proactive-agents"],
    context: "High origination volume personal loans, CFPB supervised",
  },
  {
    name: "Upgrade",
    domain: "upgrade.com",
    presets: ["proactive-agents"],
    context: "Personal loan/installment lender, high volume",
  },
  {
    name: "Avant",
    domain: "avant.com",
    presets: ["proactive-agents"],
    context: "Near-prime personal loans, high complaint risk",
  },
  {
    name: "Best Egg",
    domain: "bestegg.com",
    presets: ["proactive-agents"],
    context: "Personal loan originator, consumer lending",
  },
  {
    name: "Oportun",
    domain: "oportun.com",
    presets: ["proactive-agents"],
    context: "Community lending, CFPB scrutiny",
  },
  {
    name: "loanDepot",
    domain: "loandepot.com",
    presets: ["proactive-agents"],
    context: "Mortgage servicer, one of most-complained-about at CFPB",
  },
  {
    name: "Newrez",
    domain: "newrez.com",
    presets: ["proactive-agents"],
    context: "Mortgage servicer, high CFPB complaint volumes",
  },
  {
    name: "Mr. Cooper",
    domain: "mrcooper.com",
    presets: ["proactive-agents"],
    context: "Large mortgage servicer, CFPB supervised",
  },
  {
    name: "Flagstar",
    domain: "flagstar.com",
    presets: ["proactive-agents"],
    context: "Mortgage servicer, high complaint volume",
  },
  {
    name: "Prosper",
    domain: "prosper.com",
    presets: ["proactive-agents"],
    context: "P2P lending marketplace, consumer lending",
  },
  {
    name: "Upstart",
    domain: "upstart.com",
    presets: ["proactive-agents"],
    context: "AI lending platform, high origination, fair lending scrutiny",
  },
  {
    name: "Pagaya",
    domain: "pagaya.com",
    presets: ["proactive-agents"],
    context: "AI lending infrastructure, powering bank lending decisions",
  },
  {
    name: "Freedom Financial",
    domain: "freedomfinancialnetwork.com",
    presets: ["proactive-agents"],
    context: "Debt settlement, high complaint volume, regulatory risk",
  },
  {
    name: "Navient",
    domain: "navient.com",
    presets: ["proactive-agents"],
    context: "Student loan servicer, multiple state AG actions",
  },
  {
    name: "Nelnet",
    domain: "nelnet.com",
    presets: ["proactive-agents"],
    context: "Student loan servicer, high volume",
  },
  {
    name: "OneMain Financial",
    domain: "onemainfinancial.com",
    presets: ["proactive-agents"],
    context: "Branch-based consumer lender, high volume personal loans",
  },
  {
    name: "Mariner Finance",
    domain: "marinerfinance.com",
    presets: ["proactive-agents"],
    context: "Consumer finance, branch network, compliance risk",
  },
  {
    name: "Regional Finance",
    domain: "regionalfinance.com",
    presets: ["proactive-agents"],
    context: "Consumer finance branches, underserved markets",
  },
  {
    name: "Rocket Mortgage",
    domain: "rocketmortgage.com",
    presets: ["proactive-agents"],
    context: "Largest mortgage lender, massive call center operations",
  },
  {
    name: "UWM (United Wholesale Mortgage)",
    domain: "uwm.com",
    presets: ["proactive-agents"],
    context: "Wholesale mortgage giant, broker compliance oversight",
  },
  {
    name: "PennyMac",
    domain: "pennymac.com",
    presets: ["proactive-agents"],
    context: "Large mortgage servicer, growing portfolio",
  },
  {
    name: "Caliber Home Loans",
    domain: "caliberhomeloans.com",
    presets: ["proactive-agents"],
    context: "Mortgage servicer, mid-market",
  },
  {
    name: "Planet Home Lending",
    domain: "planethomelending.com",
    presets: ["proactive-agents"],
    context: "Mortgage lender/servicer, growing portfolio",
  },

  // ════════════════════════════════════════════════════════════════════
  // COMPLAINTS — Credit Unions & Community Banks
  // ════════════════════════════════════════════════════════════════════
  {
    name: "Navy Federal Credit Union",
    domain: "navyfederal.org",
    presets: ["proactive-agents"],
    context: "Largest CU, recent CFPB scrutiny, massive member base",
  },
  {
    name: "Pentagon Federal Credit Union",
    domain: "penfed.org",
    presets: ["proactive-agents"],
    context: "Large CU, auto and personal lending",
  },
  {
    name: "USAA",
    domain: "usaa.com",
    presets: ["proactive-agents", "qa"],
    context: "Large military bank, massive call center, high CX expectations",
  },
  {
    name: "Suncoast Credit Union",
    domain: "suncoastcreditunion.com",
    presets: ["proactive-agents"],
    context: "Large FL credit union, growing lending",
  },
  {
    name: "Golden 1 Credit Union",
    domain: "golden1.com",
    presets: ["proactive-agents"],
    context: "Large CA credit union",
  },

  // ════════════════════════════════════════════════════════════════════
  // QA — Fintech / Neobanks (user-mentioned + expanded)
  // ════════════════════════════════════════════════════════════════════
  {
    name: "Rho",
    domain: "rho.co",
    presets: ["qa"],
    context: "B2B fintech, corporate banking, growing CX team",
  },
  {
    name: "Qonto",
    domain: "qonto.com",
    presets: ["qa"],
    context: "EU business banking, 500K+ customers, large support team",
  },
  {
    name: "Kuda",
    domain: "kuda.com",
    presets: ["qa"],
    context: "African neobank, millions of users, scaling CX",
  },
  {
    name: "Hometap",
    domain: "hometap.com",
    presets: ["qa", "proactive-agents"],
    context: "Home equity fintech, sales-led, regulated product",
  },
  {
    name: "Spendesk",
    domain: "spendesk.com",
    presets: ["qa"],
    context: "EU spend management, growing SMB support base",
  },
  {
    name: "SoFi",
    domain: "sofi.com",
    presets: ["proactive-agents", "qa"],
    context: "Multi-product fintech, high growth, scaling CX",
  },
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
    presets: ["qa", "proactive-agents"],
    context: "Neobank, high consumer volume, CFPB complaints",
  },
  {
    name: "Affirm",
    domain: "affirm.com",
    presets: ["qa", "proactive-agents"],
    context: "BNPL, high consumer volume, regulatory scrutiny",
  },
  {
    name: "Klarna",
    domain: "klarna.com",
    presets: ["qa", "proactive-agents"],
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
  {
    name: "Mercury",
    domain: "mercury.com",
    presets: ["qa"],
    context: "Startup banking, growing rapidly, scaling CX",
  },
  {
    name: "Deel",
    domain: "deel.com",
    presets: ["qa"],
    context: "Global payroll/HR, massive international support team",
  },
  {
    name: "Remote",
    domain: "remote.com",
    presets: ["qa"],
    context: "Global HR platform, distributed support team",
  },
  {
    name: "Wise",
    domain: "wise.com",
    presets: ["qa", "proactive-agents"],
    context: "Cross-border payments, millions of users, regulated globally",
  },
  {
    name: "Revolut",
    domain: "revolut.com",
    presets: ["qa", "proactive-agents"],
    context: "Neobank, 40M+ users, massive CX volume, regulatory scrutiny",
  },
  {
    name: "Monzo",
    domain: "monzo.com",
    presets: ["qa", "proactive-agents"],
    context: "UK neobank, high consumer volume, FCA regulated",
  },
  {
    name: "Starling Bank",
    domain: "starlingbank.com",
    presets: ["qa", "proactive-agents"],
    context: "UK digital bank, growing rapidly",
  },
  {
    name: "N26",
    domain: "n26.com",
    presets: ["qa", "proactive-agents"],
    context: "EU neobank, regulatory issues, CX scaling",
  },
  {
    name: "Dave",
    domain: "dave.com",
    presets: ["qa", "proactive-agents"],
    context: "US neobank, consumer lending, CFPB supervised",
  },
  {
    name: "MoneyLion",
    domain: "moneylion.com",
    presets: ["qa", "proactive-agents"],
    context: "Consumer fintech, lending + banking, high volume",
  },
  {
    name: "Current",
    domain: "current.com",
    presets: ["qa", "proactive-agents"],
    context: "US neobank, consumer banking",
  },
  {
    name: "Varo Bank",
    domain: "varomoney.com",
    presets: ["qa", "proactive-agents"],
    context: "Digital bank, chartered, CFPB supervised",
  },
  {
    name: "Green Dot",
    domain: "greendot.com",
    presets: ["qa", "proactive-agents"],
    context: "Banking platform, prepaid cards, high consumer volume",
  },
  {
    name: "Robinhood",
    domain: "robinhood.com",
    presets: ["qa", "proactive-agents"],
    context: "Trading platform, massive user base, regulatory scrutiny",
  },
  {
    name: "Coinbase",
    domain: "coinbase.com",
    presets: ["qa", "proactive-agents"],
    context: "Crypto exchange, large support team, complaint volume",
  },
  {
    name: "Stripe",
    domain: "stripe.com",
    presets: ["qa"],
    context: "Payments infra, massive support volume, scaling CX",
  },
  {
    name: "Square / Block",
    domain: "squareup.com",
    presets: ["qa", "proactive-agents"],
    context: "Payments + banking, high consumer volume",
  },
  {
    name: "PayPal",
    domain: "paypal.com",
    presets: ["qa", "proactive-agents"],
    context: "Massive payment platform, high complaint volume, CFPB data",
  },
  {
    name: "Adyen",
    domain: "adyen.com",
    presets: ["qa"],
    context: "Enterprise payments, growing support team",
  },
  {
    name: "Checkout.com",
    domain: "checkout.com",
    presets: ["qa"],
    context: "Enterprise payments, scaling CX",
  },
  {
    name: "GoCardless",
    domain: "gocardless.com",
    presets: ["qa"],
    context: "Direct debit payments, SMB support",
  },

  // ════════════════════════════════════════════════════════════════════
  // QA — SaaS / E-commerce with large CX operations
  // ════════════════════════════════════════════════════════════════════
  {
    name: "Zendesk",
    domain: "zendesk.com",
    presets: ["qa"],
    context:
      "CX platform vendor, massive internal support team, eats own dogfood",
  },
  {
    name: "Intercom",
    domain: "intercom.com",
    presets: ["qa"],
    context: "CX platform, high-volume support, AI-first strategy",
  },
  {
    name: "Freshworks",
    domain: "freshworks.com",
    presets: ["qa"],
    context: "CX platform, large support operations",
  },
  {
    name: "HubSpot",
    domain: "hubspot.com",
    presets: ["qa"],
    context: "CRM/CX platform, massive SMB support base",
  },
  {
    name: "Shopify",
    domain: "shopify.com",
    presets: ["qa"],
    context: "E-commerce platform, millions of merchants, huge CX",
  },
  {
    name: "Lemonade",
    domain: "lemonade.com",
    presets: ["qa", "proactive-agents"],
    context: "Insurtech, AI-first claims, regulated, consumer complaints",
  },
  {
    name: "Root Insurance",
    domain: "joinroot.com",
    presets: ["qa", "proactive-agents"],
    context: "Insurtech, mobile-first, growing complaints",
  },
  {
    name: "Hippo Insurance",
    domain: "hippo.com",
    presets: ["qa", "proactive-agents"],
    context: "Insurtech, home insurance, consumer CX",
  },
  {
    name: "Wealthsimple",
    domain: "wealthsimple.com",
    presets: ["qa"],
    context: "Canadian fintech, investing + banking, scaling CX",
  },
  {
    name: "Betterment",
    domain: "betterment.com",
    presets: ["qa"],
    context: "Robo-advisor, consumer fintech, support team",
  },
  {
    name: "Pipe",
    domain: "pipe.com",
    presets: ["qa"],
    context: "Revenue-based financing, B2B fintech",
  },
  {
    name: "Divvy / Bill.com",
    domain: "bill.com",
    presets: ["qa"],
    context: "B2B payments, large SMB support base",
  },
  {
    name: "Justworks",
    domain: "justworks.com",
    presets: ["qa"],
    context: "PEO/HR platform, SMB support",
  },
  {
    name: "Lattice",
    domain: "lattice.com",
    presets: ["qa"],
    context: "HR platform, growing CX team",
  },
  {
    name: "Carta",
    domain: "carta.com",
    presets: ["qa"],
    context: "Equity management, complex support needs",
  },
  {
    name: "Navan (TripActions)",
    domain: "navan.com",
    presets: ["qa"],
    context: "Travel/expense, 24/7 support, high volume",
  },
  {
    name: "Airwallex",
    domain: "airwallex.com",
    presets: ["qa"],
    context: "Cross-border payments, scaling globally",
  },
  {
    name: "Tide",
    domain: "tide.co",
    presets: ["qa"],
    context: "UK SMB banking, large customer base",
  },
  {
    name: "OakNorth",
    domain: "oaknorth.com",
    presets: ["qa"],
    context: "UK digital bank, lending focus",
  },
  {
    name: "Thought Machine",
    domain: "thoughtmachine.net",
    presets: ["qa"],
    context: "Core banking platform, enterprise support",
  },
  {
    name: "Mambu",
    domain: "mambu.com",
    presets: ["qa"],
    context: "Cloud banking platform, growing support",
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
    preset: "proactive-agents",
    queries: [
      {
        query: "auto finance company servicing loans consumer lending",
        daysBack: 90,
      },
      {
        query: "consumer lending company mortgage servicing collections",
        daysBack: 90,
      },
      {
        query:
          "CFPB enforcement action auto finance consumer lending 2025 2026",
        daysBack: 60,
      },
      { query: "subprime auto lender origination servicing", daysBack: 90 },
      { query: "credit union auto lending consumer complaints", daysBack: 60 },
      {
        query: "fintech lender personal loans installment credit",
        daysBack: 90,
      },
      {
        query: "mortgage servicing company complaints rising 2025 2026",
        daysBack: 60,
      },
      { query: "BHPH buy here pay here auto dealer finance", daysBack: 90 },
    ],
  },
  {
    preset: "proactive-agents",
    queries: [
      {
        query: "auto lending company sales finance origination consumer",
        daysBack: 90,
      },
      {
        query: "UDAAP fair lending auto finance enforcement 2025 2026",
        daysBack: 60,
      },
      { query: "auto dealer finance compliance sales practice", daysBack: 90 },
      {
        query: "consumer lending sales monitoring disclosure compliance",
        daysBack: 60,
      },
      {
        query: "mortgage origination sales compliance monitoring",
        daysBack: 90,
      },
      {
        query: "student loan servicer sales practice compliance",
        daysBack: 90,
      },
    ],
  },
  {
    preset: "qa",
    queries: [
      {
        query:
          "fintech company customer support team scaling AI chatbot 2025 2026",
        daysBack: 60,
      },
      {
        query: "SaaS company customer experience operations quality assurance",
        daysBack: 60,
      },
      { query: "neobank digital bank customer service scaling", daysBack: 60 },
      {
        query: "B2B fintech growing support team hiring customer experience",
        daysBack: 30,
      },
      {
        query: "BNPL buy now pay later company customer operations",
        daysBack: 60,
      },
      { query: "insurtech company customer claims support team", daysBack: 60 },
      {
        query: "payments company customer support scaling 2025 2026",
        daysBack: 60,
      },
      {
        query: "European fintech neobank customer experience team growth",
        daysBack: 60,
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
  signalId: string;
  signalName: string;
  tier: 1 | 2 | 3 | 4;
  found: boolean;
  summary: string;
  confidence: "high" | "medium" | "low";
  evidence: Array<{ url: string; snippet: string }>;
  hits: number;
  scoreBoost: number; // how many points this signal adds
}

/** Shape of the config jsonb stored in the signals table. */
interface SignalConfig {
  query: string;
  numResults?: number;
  daysBack: number;
  tier: 1 | 2 | 3;
  scoreBoost: number;
  minHits?: number;
  staticEvidence?: Array<{ urlTemplate: string; snippetTemplate: string }>;
}

function cleanDomainForLinkedIn(domain: string): string {
  return domain.replace(/^www\./, "").replace(/\.(com|co|io|net|org)$/i, "");
}

/**
 * Fetch signal definitions from the database for the given preset,
 * then run each signal's Exa query against the company.
 */
export async function runSignals(
  companyName: string,
  preset: string,
  domain?: string | null,
): Promise<SignalResult[]> {
  const { getAdminClient } = await import("@/lib/supabase/admin");
  const { getPresetSignalSlugs } = await import("@/lib/rulebase/icp-presets");

  const slugs = getPresetSignalSlugs(preset);
  if (slugs.length === 0) return [];

  const supabase = getAdminClient();
  const { data: dbSignals, error } = await supabase
    .from("signals")
    .select("id, name, slug, config")
    .in("slug", slugs);

  if (error || !dbSignals || dbSignals.length === 0) return [];

  const results: SignalResult[] = [];
  const cleanDomain = domain ? domain.replace(/^www\./, "") : "";
  const domainClean = cleanDomainForLinkedIn(cleanDomain);

  for (const row of dbSignals) {
    const cfg = row.config as SignalConfig | null;
    if (!cfg?.query) continue;

    const query = cfg.query
      .replace(/\{company\}/g, companyName)
      .replace(/\{domain\}/g, cleanDomain);

    const hits = await exaSearch(query, cfg.numResults ?? 5, cfg.daysBack);
    const minHits = cfg.minHits ?? 1;
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
    if (cfg.staticEvidence) {
      for (const se of cfg.staticEvidence) {
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
      signalId: row.id as string,
      signalName: row.name as string,
      tier: cfg.tier,
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
      scoreBoost: found ? cfg.scoreBoost : 0,
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
    qa: "QA — Real-time 100% Reviews",
    "customer-intelligence":
      "Customer Intelligence — Cross-conversation Insights",
    "proactive-agents": "Proactive Agents — Act Before Churn/Complaints",
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

  // Cross-sell signals — all three blocks serve the same buyer, different entry points
  if (
    preset !== "qa" &&
    fired.some(
      (s) => s.signalName.includes("QA") || s.signalName.includes("CX"),
    )
  ) {
    secondary.push("QA — Real-time 100% Reviews");
  }
  if (
    preset !== "proactive-agents" &&
    fired.some(
      (s) =>
        s.signalName.includes("Complaint") ||
        s.signalName.includes("CFPB") ||
        s.signalName.includes("Dispute"),
    )
  ) {
    secondary.push("Proactive Agents — Act Before Churn/Complaints");
  }
  if (
    preset !== "customer-intelligence" &&
    fired.some(
      (s) =>
        s.signalName.includes("Product") || s.signalName.includes("Scaling"),
    )
  ) {
    secondary.push("Customer Intelligence — Cross-conversation Insights");
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
    qa: "We read every customer conversation in real time — 100% coverage, not the 2-5% you sample after the fact.",
    "customer-intelligence":
      "We show you what is happening across every conversation — by product, channel, program. Real-time leading indicators, not lagging ones.",
    "proactive-agents":
      "We act before customers churn or complain. Disputes at 1/10 the cost. Complaints resolved 10x faster. Configured in plain language.",
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
    if (preset === "proactive-agents" || preset === "proactive-agents") {
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
