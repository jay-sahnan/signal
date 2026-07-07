/**
 * Revenue Agent (2.0) signal scoring + Slack Block Kit briefing.
 *
 * The recurring, productionised version of the signal-scan work: scores fintechs
 * against the ICP Signal Playbook 0–10 model and posts a tiered Block Kit brief.
 *
 * Playbook rules baked in:
 *  - M&A only scores as a BOOK-OF-BUSINESS transfer (named counterparty + book language),
 *    never a product/tech/talent tuck-in.
 *  - Company name must appear in the result TITLE (or the company domain in the URL) —
 *    kills common-word body coincidences. Disambiguation terms for ambiguous names.
 *  - Complaints signal spans Trustpilot / App Store / CFPB / Reddit.
 *  - Negatives (pure QA/support, fully self-serve) are qualification-time, NOT auto-scored.
 *  - Strongest accounts have 2+ distinct overlapping signals.
 */

const EXA_API_KEY = process.env.EXA_API_KEY;
const EXA_BASE = "https://api.exa.ai/search";

export interface RaCompany {
  name: string;
  domain?: string | null;
  segment?: string | null;
  employees?: string | number | null;
  metric?: string;
  disambig?: string[];
  firstSeen?: string | null; // when the company was discovered (ISO); used to flag 🆕
}

export interface FiredSignal {
  key: string;
  label: string;
  evidence: string;
  entity: string | null;
  url: string | null;
}

export interface ScoredCompany extends RaCompany {
  score: number;
  band: "Fast-track" | "Strong" | "Watchlist" | "Low";
  signals: FiredSignal[];
  headline: string;
}

interface SignalDef {
  key: string;
  label: string;
  boost: number;
  daysBack: number;
  requireEntity: boolean;
  query: string;
  kw: string[];
  neg: string[];
}

// ── signal definitions (playbook) ────────────────────────────────────
export const SIGNALS: SignalDef[] = [
  {
    key: "ma",
    label: "M&A / book transfer",
    boost: 3,
    daysBack: 180,
    requireEntity: true,
    query:
      '"{c}" acquires OR acquisition OR "book of business" OR "portfolio transfer" OR "migrates customers" OR "customer book" 2025 OR 2026',
    kw: [
      "book of business", "portfolio transfer", "portfolio of", "customer book",
      "merchant book", "loan book", "deposit book", "migrates customers",
      "migrate accounts", "re-onboard", "re-paper", "plans from", "accounts from",
      "transfer of customers", "customer base",
    ],
    neg: [
      "acqui-hire", "talent acquisition", "technology acquisition",
      "product acquisition", "source code", "intellectual property",
      "engineering team", "acquires the team",
    ],
  },
  {
    key: "hiring",
    label: "Onboarding/KYB hiring",
    boost: 2,
    daysBack: 45,
    requireEntity: false,
    query:
      '"{c}" hiring OR careers "Onboarding Specialist" OR "Implementation Manager" OR "KYB Analyst" OR "Merchant Underwriting" OR "Merchant Operations" OR "Activation Manager" OR "Client Onboarding" 2025 OR 2026',
    kw: [
      "onboarding specialist", "implementation manager", "kyb analyst",
      "kyc analyst", "merchant underwriting", "merchant operations",
      "activation manager", "client onboarding", "onboarding manager",
    ],
    neg: ["linkedin.com/in/"],
  },
  {
    key: "market",
    label: "New market / license",
    boost: 2,
    daysBack: 180,
    requireEntity: false,
    query:
      '"{c}" "launches in" OR "expands to" OR "goes live in" OR "granted license" OR "payments license" OR "new corridor" OR "money transmitter license" OR "secures license" 2025 OR 2026',
    kw: [
      "launches in", "expands to", "goes live in", "granted licen",
      "payments licen", "banking licen", "money transmitter", "new corridor",
      "secures licen", "new market", "new country",
    ],
    neg: [],
  },
  {
    key: "complaints",
    label: "Verification/activation complaints",
    boost: 2,
    daysBack: 365,
    requireEntity: false,
    query:
      '(site:trustpilot.com OR site:apps.apple.com OR site:reddit.com OR site:consumerfinance.gov) "{c}" verification OR onboarding OR "waiting weeks" OR "documents rejected" OR "cannot open" OR "account activation" OR KYC OR stuck',
    kw: [
      "verif", "onboard", "waiting weeks", "documents rejected", "cannot open",
      "can't open", "account opening", "account activation", "kyc", "stuck",
      "days to", "no response",
    ],
    neg: [],
  },
  {
    key: "activation",
    label: "Dormant / activation-metric",
    boost: 2,
    daysBack: 365,
    requireEntity: false,
    query:
      '"{c}" "activation rate" OR "time to revenue" OR "first transaction" OR "merchant ramp" OR "approved but not" OR "not transacting" OR "funded accounts" OR "first contribution" OR dormant 2025 OR 2026',
    kw: [
      "activation rate", "time to revenue", "time-to-revenue", "first transaction",
      "merchant ramp", "approved but not", "not transacting", "funded account",
      "first contribution", "dormant account", "unfunded",
    ],
    neg: [],
  },
  {
    key: "leader",
    label: "New revenue-ops leader",
    boost: 1,
    daysBack: 120,
    requireEntity: false,
    query:
      '"{c}" appoints OR names OR hires "Chief Revenue Officer" OR "Chief Operating Officer" OR "Head of Onboarding" OR "Head of Implementation" OR "Head of Merchant Operations" OR "VP Operations" 2025 OR 2026',
    kw: [
      "chief revenue officer", "chief operating officer", "head of onboarding",
      "head of implementation", "head of merchant operations", "head of operations",
      "vp operations", "appointed coo", "appointed cro", "named coo", "named cro",
      "new coo", "new cro",
    ],
    neg: [
      "board of director", "board member", "advisory board", "to its board",
      "to the board", "joins the board",
    ],
  },
];

const STOP = new Set([
  "SAN", "FRANCISCO", "DUBLIN", "AND", "THE", "NEW", "EXCLUSIVE", "US", "USA",
  "UK", "EU", "INC", "LTD", "AG", "SA", "EUROPE", "AFRICA", "SOURCES", "LIST",
  "OF", "ITS", "A", "AN", "TECH", "FINTECH", "MARKETS",
]);

interface ExaHit { title?: string; url?: string; text?: string; publishedDate?: string | null }

async function exaSearch(query: string, daysBack: number): Promise<ExaHit[]> {
  if (!EXA_API_KEY) return [];
  const start = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0];
  try {
    const res = await fetch(EXA_BASE, {
      method: "POST",
      headers: { "x-api-key": EXA_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        query, numResults: 6, useAutoprompt: false, type: "auto",
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

const norm = (x: string) => x.toLowerCase().replace(/\.com$/, "").replace(/[^a-z0-9]/g, "");
const nameHit = (company: string, blob: string) =>
  blob.includes(company.toLowerCase().replace(/\.com$/, "").trim());
const kwHit = (blob: string, kw: string[]) =>
  kw.some((k) => (k.includes("\\b") ? new RegExp(k).test(blob) : blob.includes(k)));

function entity(key: string, company: string, text: string): string | null {
  if (key === "ma") {
    const cands: string[] = [];
    const push = (re: RegExp) => { let m; while ((m = re.exec(text))) cands.push(m[1]); };
    push(/(?:acquires?|acqui\w+ of|to acquire|acquired|buys|acquiring)\s+([A-Z][\w.&'’-]+(?:\s+[A-Z][\w.&'’-]+){0,2})/g);
    push(/([A-Z][\w.&'’-]+(?:\s+[A-Z][\w.&'’-]+){0,2})\s+(?:acquires|buys|to acquire|completes acqui\w+|agrees to acquire|acquiring)/g);
    push(/acquired by\s+([A-Z][\w.&'’-]+(?:\s+[A-Z][\w.&'’-]+){0,2})/g);
    for (let c of cands) {
      const toks = c.split(/\s+/).map((t) => t.replace(/[.,'’]+$/, ""))
        .filter((t) => t && !STOP.has(t.toUpperCase()) && norm(t) !== norm(company));
      c = toks.join(" ").replace(/\s+(Inc|Ltd|Group|AG|SA)$/i, "").trim();
      if (norm(c).length >= 2) return c;
    }
  }
  if (key === "market") {
    const m = text.match(/(?:expands? to|launch\w*\s+in|goes live in)\s+([A-Z][\w]+)/);
    if (m && !STOP.has(m[1].toUpperCase())) return m[1];
  }
  return null;
}

function cleanSnippet(raw = ""): string {
  let s = raw.replace(/\s+/g, " ").trim();
  for (const m of [" × ", " # ", " | ", "Skip to", "Recent Quotes", "Happily Authenticated", "Your browser"]) {
    const i = s.indexOf(m);
    if (i > 20) s = s.slice(0, i);
  }
  const dot = s.indexOf(". ");
  if (dot > 30) s = s.slice(0, dot);
  return s.replace(/[#|>[\]]+/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
}

async function detect(signal: SignalDef, company: RaCompany): Promise<FiredSignal | null> {
  const hits = await exaSearch(signal.query.replaceAll("{c}", company.name), signal.daysBack);
  for (const r of hits) {
    if (!r.publishedDate) continue;
    const title = (r.title ?? "").toLowerCase();
    const blob = `${r.title ?? ""} ${r.text ?? ""}`.toLowerCase();
    const url = (r.url ?? "").toLowerCase();
    const inUrl = company.domain ? url.includes(company.domain) : false;
    if (!(nameHit(company.name, title) || inUrl)) continue;
    if (company.disambig && !(inUrl || company.disambig.some((d) => blob.includes(d)))) continue;
    if (signal.neg.some((n) => blob.includes(n))) continue;
    if (!kwHit(blob, signal.kw)) continue;
    const snip = cleanSnippet(r.text ?? r.title ?? "");
    const ent = entity(signal.key, company.name, `${r.title ?? ""}. ${snip}`);
    if (signal.requireEntity && !ent) continue;
    return { key: signal.key, label: signal.label, evidence: snip, entity: ent, url: r.url ?? null };
  }
  return null;
}

const band = (s: number): ScoredCompany["band"] =>
  s >= 8 ? "Fast-track" : s >= 6 ? "Strong" : s >= 4 ? "Watchlist" : "Low";

function headline(f: FiredSignal): string {
  switch (f.key) {
    case "ma": return `Absorbing a book of accounts${f.entity ? ` (${f.entity})` : ""} — re-paper/verify/activate before it earns.`;
    case "hiring": return "Hiring onboarding/KYB roles — activation work scaling faster than the team can chase manually.";
    case "market": return f.entity ? `Launching in ${f.entity} — a new onboarding branch + local compliance to stand up.` : "New market/license — a new onboarding branch + local compliance to stand up.";
    case "complaints": return "Customers publicly stuck on verification/activation (Trustpilot/App Store/CFPB/Reddit) — the core pain, in their words.";
    case "activation": return "Activation/dormant language — revenue sitting idle behind the activation gate.";
    case "leader": return "New revenue-ops leader — a 90-day window to fix which accounts are stuck and why.";
    default: return f.label;
  }
}

// ── FREE, credit-free enrichers (ATS boards + CFPB) ───────────────────
// These consume NO Apollo credits and no paid APIs. They strengthen the
// hiring + complaints signals (which Exa is weak at) from public endpoints.

async function fetchJSON(url: string, timeoutMs = 8000): Promise<unknown | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "rulebase-signal/1.0" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function slugCandidates(company: RaCompany): string[] {
  const base = company.name.toLowerCase().replace(/\b(inc|ltd|llc|group|technologies|financial|the)\b/g, "").trim();
  const alnum = base.replace(/[^a-z0-9]+/g, "");
  const hyphen = base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const domainRoot = (company.domain ?? "").replace(/^www\./, "").split(".")[0];
  return [...new Set([alnum, hyphen, domainRoot].filter((s) => s && s.length > 1))];
}

const ROLE_RE = /onboard|implementation|\bkyb\b|\bkyc\b|merchant (onboarding|underwriting|operations)|activation|verification specialist|client onboarding|deployment|conversion/i;

/** Check Greenhouse / Lever / Ashby public boards for onboarding/implementation roles. Free. */
async function atsJobs(company: RaCompany): Promise<FiredSignal | null> {
  for (const slug of slugCandidates(company)) {
    // Greenhouse
    const gh = (await fetchJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`)) as
      | { jobs?: Array<{ title?: string }> } | null;
    const ghRoles = (gh?.jobs ?? []).filter((j) => ROLE_RE.test(j.title ?? ""));
    if (ghRoles.length) return { key: "hiring", label: "Onboarding/KYB hiring", evidence: `${ghRoles.length} open role(s) incl. "${ghRoles[0].title}" (Greenhouse)`, entity: null, url: `https://boards.greenhouse.io/${slug}` };
    // Lever
    const lv = (await fetchJSON(`https://api.lever.co/v0/postings/${slug}?mode=json`)) as Array<{ text?: string }> | null;
    const lvRoles = (Array.isArray(lv) ? lv : []).filter((j) => ROLE_RE.test(j.text ?? ""));
    if (lvRoles.length) return { key: "hiring", label: "Onboarding/KYB hiring", evidence: `${lvRoles.length} open role(s) incl. "${lvRoles[0].text}" (Lever)`, entity: null, url: `https://jobs.lever.co/${slug}` };
    // Ashby
    const ah = (await fetchJSON(`https://api.ashbyhq.com/posting-api/job-board/${slug}`)) as
      | { jobs?: Array<{ title?: string }> } | null;
    const ahRoles = (ah?.jobs ?? []).filter((j) => ROLE_RE.test(j.title ?? ""));
    if (ahRoles.length) return { key: "hiring", label: "Onboarding/KYB hiring", evidence: `${ahRoles.length} open role(s) incl. "${ahRoles[0].title}" (Ashby)`, entity: null, url: `https://jobs.ashbyhq.com/${slug}` };
  }
  return null;
}

// Only account-opening / verification issues count as the Revenue Agent signal —
// NOT generic "managing an account" or credit-report noise (which also avoids
// common-word over-matching, e.g. "Current" pulling credit-report complaints).
const CFPB_ONBOARDING_ISSUE = /opening an account|account opening|identity|verification|unable to open|fraud or scam/i;

/** Query the free CFPB complaint API, counting only account-opening/verification issues. */
async function cfpbComplaints(company: RaCompany, minCount = 5): Promise<FiredSignal | null> {
  const since = new Date(Date.now() - 365 * 86400000).toISOString().split("T")[0];
  const url = `https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?search_term=${encodeURIComponent(company.name)}&date_received_min=${since}&size=0`;
  const data = (await fetchJSON(url, 10000)) as
    | { aggregations?: { issue?: { issue?: { buckets?: Array<{ key: string; doc_count: number }> } } } }
    | null;
  const buckets = data?.aggregations?.issue?.issue?.buckets ?? [];
  const relevant = buckets.filter((b) => CFPB_ONBOARDING_ISSUE.test(b.key));
  const count = relevant.reduce((s, b) => s + (b.doc_count ?? 0), 0);
  if (count < minCount) return null;
  const top = relevant.sort((a, b) => b.doc_count - a.doc_count)[0];
  return {
    key: "complaints",
    label: "Verification/activation complaints",
    evidence: `${count} CFPB complaints re: account opening/verification (12mo; top: "${top?.key}")`,
    entity: null,
    url: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/?searchText=${encodeURIComponent(company.name)}`,
  };
}

export async function scoreCompany(company: RaCompany): Promise<ScoredCompany> {
  const fired: FiredSignal[] = [];
  let score = 0;
  for (const s of SIGNALS) {
    const hit = await detect(s, company);
    if (hit) { score += s.boost; fired.push(hit); }
  }

  // Free enrichers: add the signal if Exa missed it, else upgrade its evidence.
  // No double-counting of the boost.
  const [ats, cfpb] = await Promise.all([atsJobs(company), cfpbComplaints(company)]);
  const merge = (hit: FiredSignal | null, boost: number) => {
    if (!hit) return;
    const existing = fired.find((f) => f.key === hit.key);
    if (existing) { existing.evidence = hit.evidence; existing.url = hit.url ?? existing.url; }
    else { score += boost; fired.push(hit); }
  };
  merge(ats, 2);
  merge(cfpb, 2);

  fired.sort((a, b) => (SIGNALS.find((s) => s.key === b.key)?.boost ?? 2) - (SIGNALS.find((s) => s.key === a.key)?.boost ?? 2));
  score = Math.max(0, Math.min(10, score));
  return { ...company, score, band: band(score), signals: fired, headline: fired[0] ? headline(fired[0]) : "" };
}

// ── Block Kit ─────────────────────────────────────────────────────────
const SIGEMOJI: Record<string, string> = {
  ma: "🤝", hiring: "🧑‍💼", market: "🌍", complaints: "📉", activation: "💤", leader: "👤",
};
const tierEmoji = (s: number) => (s >= 8 ? "🔴" : s >= 6 ? "🟠" : s >= 4 ? "🟡" : "⚪");
const buyerFor = (v?: string | null) =>
  (v ?? "").startsWith("Payment") || /Processor|acquir|PayFac/i.test(v ?? "")
    ? "Head of Merchant Ops → CC COO/CRO"
    : /Benefits|Retirement/i.test(v ?? "")
      ? "Head of Implementation → CC COO/CCO"
      : "Head of Onboarding → CC COO/CRO";

export function buildBlocks(scored: ScoredCompany[], dateStr: string): unknown[] {
  const rows = [...scored].sort((a, b) => b.score - a.score || b.signals.length - a.signals.length);
  const fast = rows.filter((c) => c.score >= 8);
  const strong = rows.filter((c) => c.score >= 6 && c.score < 8);
  const watch = rows.filter((c) => c.score >= 4 && c.score < 6);
  const low = rows.filter((c) => c.score < 4);
  const overlap = rows.filter((c) => c.signals.length >= 2);
  const complaints = rows.filter((c) => c.signals.some((s) => s.key === "complaints"));
  const sigList = (c: ScoredCompany) => c.signals.map((s) => `${SIGEMOJI[s.key] ?? "•"} ${s.label}`).join(" · ");
  const isNew = (c: ScoredCompany) =>
    c.firstSeen ? Date.now() - new Date(c.firstSeen).getTime() < 2 * 86400000 : false;
  const newCount = rows.filter(isNew).length;

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: "🟢 Revenue Agent — Signal Brief", emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: `*${dateStr}* · ${rows.length} companies scored (0–10 playbook)` }] },
    { type: "section", text: { type: "mrkdwn", text: `🆕 *${newCount}* newly discovered this window · 🔴 *${fast.length}* Fast-track · 🟠 *${strong.length}* Strong · 🟡 *${watch.length}* Watchlist · ⚪ *${low.length}* Low\n*${overlap.length}* with 2+ overlapping signals · *${complaints.length}* show verification/activation complaints. _M&A counts only as a book-of-business transfer, not a tech tuck-in._` } },
    { type: "divider" },
  ];
  for (const c of fast.slice(0, 12)) {
    const others = c.signals.slice(1).map((s) => s.label).join(" · ");
    let t = `${tierEmoji(c.score)} *${c.score}/10 · ${c.name}*${isNew(c) ? " 🆕" : ""}  _${c.segment ?? ""}${c.employees ? ` · ${c.employees} emp` : ""}${c.signals.length >= 2 ? " · 2+ signals" : ""}_\n→ ${c.headline}\n`;
    if (others) t += `_Also: ${others}_\n`;
    t += `▸ ${buyerFor(c.segment)} · 💵 anchor on ${c.metric ?? "recovered revenue"}`;
    const url = c.signals.find((s) => s.url)?.url;
    const b: Record<string, unknown> = { type: "section", text: { type: "mrkdwn", text: t } };
    if (url) b.accessory = { type: "button", text: { type: "plain_text", text: "Source" }, url };
    blocks.push(b);
  }
  if (strong.length) {
    blocks.push({ type: "divider" });
    const lines = strong.slice(0, 20).map((c) => `🟠 *${c.score}* *${c.name}* · ${sigList(c) || c.segment}`);
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Strong fit (6–7):*\n${lines.join("\n")}${strong.length > 20 ? `\n…+${strong.length - 20} more` : ""}` } });
  }
  blocks.push({ type: "divider" });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "▶︎ *Next:* work Fast-track first — enrich the buyer in Apollo, lead with the overlapping signal, anchor high vs recovered revenue." }] });
  return blocks;
}

const METRIC_BY_SEGMENT: Array<[RegExp, string]> = [
  [/processor|acquir|payment|payfac/i, "TPV"],
  [/benefit|hsa|fsa/i, "funded accounts"],
  [/retirement|401/i, "plans live"],
  [/lend|loan/i, "loans funded"],
  [/remit|cross-border/i, "funded senders"],
];
const metricFor = (seg?: string | null) =>
  METRIC_BY_SEGMENT.find(([re]) => re.test(seg ?? ""))?.[1] ?? "funded accounts";

/**
 * Score a list of companies against the playbook and post a Block Kit brief to Slack.
 * Returns a short summary. Companies with no metric get one inferred from segment.
 */
export async function generateRevenueAgentBriefing(
  companies: RaCompany[],
  webhookUrl: string,
): Promise<{ success: boolean; summary: string }> {
  const withMetric = companies.map((c) => ({ ...c, metric: c.metric ?? metricFor(c.segment) }));
  const scored: ScoredCompany[] = [];
  for (const c of withMetric) scored.push(await scoreCompany(c));

  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const blocks = buildBlocks(scored, date);
  const fast = scored.filter((c) => c.score >= 8).length;
  const strong = scored.filter((c) => c.score >= 6 && c.score < 8).length;
  const fallback = `Revenue Agent brief — ${scored.length} scored, ${fast} fast-track, ${strong} strong`;

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: fallback, blocks: (blocks as unknown[]).slice(0, 50) }),
  });
  if (!res.ok) throw new Error(`Slack failed: ${res.status} ${await res.text()}`);
  return { success: true, summary: `${scored.length} scored, ${fast} fast-track, ${strong} strong` };
}
