/**
 * Daily Slack briefing — concise summary + CSV links.
 *
 * Posts a short summary to Slack with company counts per ICP
 * and links to 3 CSV downloads (one per ICP, Smartlead-formatted).
 * Each CSV has 30+ enriched companies with fresh signal data.
 */

const EXA_API_KEY = process.env.EXA_API_KEY;
const EXA_BASE = "https://api.exa.ai/search";

interface ExaResult {
  title: string;
  url: string;
  publishedDate: string | null;
  text: string | null;
}

interface ExaResponse {
  results: ExaResult[];
}

async function exaSearch(
  query: string,
  numResults = 3,
  daysBack = 7,
): Promise<ExaResult[]> {
  if (!EXA_API_KEY) return [];

  const startDate = new Date(Date.now() - daysBack * 86400000)
    .toISOString()
    .split("T")[0];

  try {
    const res = await fetch(EXA_BASE, {
      method: "POST",
      headers: {
        "x-api-key": EXA_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        numResults,
        useAutoprompt: true,
        type: "neural",
        startPublishedDate: startDate,
        contents: { text: { maxCharacters: 400 } },
      }),
    });

    if (!res.ok) return [];
    const data = (await res.json()) as ExaResponse;
    return data.results ?? [];
  } catch {
    return [];
  }
}

// ── Per-ICP signal queries ───────────────────────────────────────────

interface SignalQuery {
  label: string;
  query: string;
  daysBack: number;
}

const SIGNAL_QUERIES: Record<string, SignalQuery[]> = {
  qa: [
    {
      label: "CX/Ops hiring",
      query:
        '"{company}" hired OR hiring Head of CX OR Head of Operations OR VP Customer Experience OR QA Manager OR Head of Support',
      daysBack: 14,
    },
    {
      label: "AI agents",
      query:
        '"{company}" AI agent OR AI chatbot OR conversational AI customer service deployed',
      daysBack: 14,
    },
    {
      label: "Platform migration",
      query:
        '"{company}" replacing OR switching OR migrating QA OR quality assurance OR MaestroQA OR Klaus OR EvaluAgent',
      daysBack: 30,
    },
  ],
  "customer-intelligence": [
    {
      label: "CX/Ops hiring",
      query:
        '"{company}" hired OR hiring Head of CX OR VP Operations OR Director of Support OR Head of Customer Experience',
      daysBack: 14,
    },
    {
      label: "Scaling support",
      query:
        '"{company}" expanding customer support OR scaling CX team OR new contact center OR BPO partnership',
      daysBack: 14,
    },
    {
      label: "Product launch",
      query:
        '"{company}" launched OR launching new product OR new feature OR expanding into',
      daysBack: 14,
    },
  ],
  "proactive-agents": [
    {
      label: "Consumer complaints",
      query:
        '"{company}" complaints OR negative reviews site:trustpilot.com OR site:bbb.org OR site:consumerfinance.gov',
      daysBack: 7,
    },
    {
      label: "Regulatory",
      query:
        '"{company}" CFPB OR consent order OR enforcement action OR attorney general',
      daysBack: 30,
    },
    {
      label: "Dispute/churn signals",
      query:
        '"{company}" dispute volume OR churn rate OR customer attrition OR complaint surge',
      daysBack: 14,
    },
  ],
};

// ── Enrich companies with fresh signals ──────────────────────────────

interface CompanyWithSignals {
  name: string;
  domain: string | null;
  location: string | null;
  headcount: number | null;
  industry: string | null;
  score: number | null;
  scoreReason: string | null;
  signals: Array<{ label: string; summary: string; hits: number }>;
  contacts: Array<{ name: string; title: string | null; email: string | null }>;
}

async function enrichWithFreshSignals(
  companies: Array<{
    name: string;
    domain: string | null;
    location: string | null;
    headcount: number | null;
    industry: string | null;
    score: number | null;
    scoreReason: string | null;
    contacts: Array<{
      name: string;
      title: string | null;
      email: string | null;
    }>;
  }>,
  preset: string,
): Promise<CompanyWithSignals[]> {
  const queries = SIGNAL_QUERIES[preset] ?? [];
  const results: CompanyWithSignals[] = [];

  for (const company of companies) {
    const signals: Array<{ label: string; summary: string; hits: number }> = [];

    for (const q of queries) {
      const query = q.query.replace(/\{company\}/g, company.name);
      const hits = await exaSearch(query, 3, q.daysBack);
      if (hits.length > 0) {
        const topSnippet = (hits[0].text ?? hits[0].title ?? "")
          .slice(0, 150)
          .replace(/\n/g, " ")
          .trim();
        signals.push({
          label: q.label,
          summary: topSnippet,
          hits: hits.length,
        });
      }
    }

    // Boost score based on signals
    let adjustedScore = company.score ?? 7;
    if (signals.some((s) => s.label === "Regulatory"))
      adjustedScore = Math.max(adjustedScore, 10);
    else if (
      signals.some(
        (s) => s.label === "Consumer complaints" || s.label === "Complaints",
      )
    )
      adjustedScore = Math.max(adjustedScore, 9);
    else if (signals.length > 0) adjustedScore = Math.max(adjustedScore, 8);

    results.push({ ...company, signals, score: adjustedScore });
  }

  // Sort by score desc, then by signal count
  results.sort((a, b) => {
    if ((b.score ?? 0) !== (a.score ?? 0))
      return (b.score ?? 0) - (a.score ?? 0);
    return b.signals.length - a.signals.length;
  });

  return results;
}

// ── 7-Step Sequence Action Recommender ──────────────────────────────

/**
 * Recommend the next action for a company based on the 7-step outreach
 * sequence. Without persistent step tracking, we infer from available data:
 * - No contact → Step 0 (find contact)
 * - Has contact, no email → Step 1 (LinkedIn view)
 * - Has contact + email → Step 3 (send signal-routed email)
 *
 * The daily briefing surfaces these so the team knows exactly what to do.
 */
function recommendAction(
  company: CompanyWithSignals,
  contact:
    | { name: string; title: string | null; email: string | null }
    | undefined,
): string {
  if (!contact) {
    return "Step 0: Find Head of CX/Ops contact via Apollo";
  }
  if (!contact.email) {
    return `Step 1: View ${contact.name}'s LinkedIn profile`;
  }

  // Determine signal type for routing
  const signalLabels = company.signals.map((s) => s.label.toLowerCase());
  const hasRegulatory = signalLabels.some(
    (l) => l.includes("regulatory") || l.includes("complaint"),
  );
  const hasHiring = signalLabels.some(
    (l) => l.includes("hiring") || l.includes("scaling"),
  );
  const hasProduct = signalLabels.some(
    (l) => l.includes("product") || l.includes("ai"),
  );

  const signalType = hasRegulatory
    ? "regulatory"
    : hasHiring
      ? "new-hire/scaling"
      : hasProduct
        ? "product-launch/AI"
        : "ICP fit";

  return `Step 3: Send signal-routed email (${signalType}) to ${contact.name}`;
}

// ── Main ─────────────────────────────────────────────────────────────

const PRESET_LABELS: Record<string, string> = {
  qa: "QA",
  "customer-intelligence": "Customer Intelligence",
  "proactive-agents": "Proactive Agents",
};

export async function generateAndPostBriefing(): Promise<{
  success: boolean;
  summary: string;
}> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (!supabaseUrl || !serviceRoleKey || !webhookUrl) {
    throw new Error("Missing env vars");
  }

  const presets = ["qa", "customer-intelligence", "proactive-agents"];
  const icpSummaries: Array<{
    preset: string;
    label: string;
    total: number;
    withSignals: number;
    topScore: number;
    csvUrl: string;
    enrichedCompanies: CompanyWithSignals[];
  }> = [];

  for (const preset of presets) {
    const campaignIds = await getCampaignIds(
      supabaseUrl,
      serviceRoleKey,
      preset,
    );
    if (!campaignIds) continue;

    // Fetch companies (up to 30)
    const orgsRes = await fetch(
      `${supabaseUrl}/rest/v1/campaign_organizations?select=relevance_score,score_reason,organization:organizations!inner(id,name,domain,industry,location,enrichment_data)&campaign_id=in.(${campaignIds})&order=relevance_score.desc.nullsfirst&limit=30`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      },
    );
    const orgs = (await orgsRes.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(orgs)) continue;

    // Fetch contacts
    const peopleRes = await fetch(
      `${supabaseUrl}/rest/v1/campaign_people?select=person:people!inner(name,title,work_email,organization_id)&campaign_id=in.(${campaignIds})&order=priority_score.desc.nullsfirst&limit=100`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      },
    );
    const people = (await peopleRes.json()) as Array<Record<string, unknown>>;
    const contactMap = new Map<
      string,
      Array<{ name: string; title: string | null; email: string | null }>
    >();
    if (Array.isArray(people)) {
      for (const p of people) {
        const person = p.person as Record<string, unknown>;
        const orgId = person?.organization_id as string;
        if (!orgId) continue;
        if (!contactMap.has(orgId)) contactMap.set(orgId, []);
        const list = contactMap.get(orgId)!;
        if (list.length < 3) {
          list.push({
            name: person.name as string,
            title: (person.title as string) ?? null,
            email: (person.work_email as string) ?? null,
          });
        }
      }
    }

    const rawCompanies = orgs.map((org) => {
      const o = org.organization as Record<string, unknown>;
      const apollo = ((o.enrichment_data as Record<string, unknown>)?.apollo ??
        {}) as Record<string, unknown>;
      const orgId = o.id as string | undefined;
      return {
        name: o.name as string,
        domain: (o.domain as string) ?? null,
        location: (apollo.location as string) ?? (o.location as string) ?? null,
        headcount: (apollo.headcount as number) ?? null,
        industry: (apollo.industry as string) ?? (o.industry as string) ?? null,
        score: (org.relevance_score as number) ?? null,
        scoreReason: (org.score_reason as string) ?? null,
        contacts: orgId ? (contactMap.get(orgId) ?? []) : [],
      };
    });

    // Enrich with fresh Exa signals
    const enriched = await enrichWithFreshSignals(rawCompanies, preset);
    const withSignals = enriched.filter((c) => c.signals.length > 0).length;
    const topScore = enriched.length > 0 ? (enriched[0].score ?? 0) : 0;

    icpSummaries.push({
      preset,
      label: PRESET_LABELS[preset] ?? preset,
      total: enriched.length,
      withSignals,
      topScore,
      csvUrl: `${appUrl}/api/export-csv?preset=${preset}`,
      enrichedCompanies: enriched,
    });
  }

  // Format Slack message with per-company recommended actions
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  let message = `*Daily Signal Brief — ${date}*\n\n`;

  for (const icp of icpSummaries) {
    const signalNote =
      icp.withSignals > 0
        ? `${icp.withSignals} with active signals`
        : "no fresh signals";
    message += `*${icp.label}:* ${icp.total} companies, ${signalNote}, top score ${icp.topScore}/10\n`;
    message += `<${icp.csvUrl}|Download ${icp.label} CSV>\n\n`;

    // Show top 5 companies with recommended next action
    const topCompanies = icp.enrichedCompanies;
    if (topCompanies && topCompanies.length > 0) {
      for (const co of topCompanies.slice(0, 5)) {
        const contact = co.contacts[0];
        const contactStr = contact
          ? `${contact.name} (${contact.title ?? "?"})`
          : "No contact — find via Apollo";
        const topSignal =
          co.signals.length > 0
            ? co.signals[0].label
            : (co.scoreReason ?? "ICP fit").slice(0, 40);
        const nextAction = recommendAction(co, contact);
        message += `  ${co.score ?? "?"}/10  *${co.name}* — ${topSignal}\n`;
        message += `        Contact: ${contactStr}\n`;
        message += `        Next: ${nextAction}\n`;
      }
      message += "\n";
    }
  }

  const totalCompanies = icpSummaries.reduce((s, i) => s + i.total, 0);
  const totalWithSignals = icpSummaries.reduce((s, i) => s + i.withSignals, 0);
  message += `_${totalCompanies} total companies, ${totalWithSignals} with signals this week_\n`;
  message += `<${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/companies|View all companies>`;

  // Post to Slack
  const slackRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });

  if (!slackRes.ok) {
    throw new Error(
      `Slack failed: ${slackRes.status} ${await slackRes.text()}`,
    );
  }

  return {
    success: true,
    summary: `Posted: ${totalCompanies} companies, ${totalWithSignals} with signals`,
  };
}

async function getCampaignIds(
  supabaseUrl: string,
  serviceRoleKey: string,
  preset: string,
): Promise<string | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/campaigns?select=id&icp_preset_slug=eq.${preset}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  const campaigns = (await res.json()) as Array<{ id: string }>;
  if (!Array.isArray(campaigns) || campaigns.length === 0) return null;
  return campaigns.map((c) => `"${c.id}"`).join(",");
}
