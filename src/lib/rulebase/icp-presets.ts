import { readFileSync } from "node:fs";
import path from "node:path";
import type { ICP, Offering, Positioning } from "@/lib/types/campaign";

export interface ApolloCompanyFilters {
  q_organization_keyword_tags?: string[];
  organization_num_employees_ranges?: string[];
  organization_locations?: string[];
  q_organization_job_titles?: string[];
}

export interface ApolloPersonFilters {
  person_titles: string[];
  person_seniorities: string[];
}

export interface ICPPreset {
  slug: "revenue-agent" | "qa" | "customer-intelligence" | "proactive-agents";
  name: string;
  description: string;
  rawMarkdown: string;
  icp: ICP;
  offering: Offering;
  positioning: Positioning;
  signalSlugs: string[];
  apolloCompanyFilters: ApolloCompanyFilters;
  apolloPersonFilters: ApolloPersonFilters;
}

function loadMarkdown(filename: string): string {
  const filePath = path.join(process.cwd(), "config", filename);
  return readFileSync(filePath, "utf8");
}

const REVENUE_AGENT_PRESET: ICPPreset = {
  slug: "revenue-agent",
  name: "Revenue Agent",
  description:
    "Fintechs where revenue is gated behind multi-step onboarding/activation — stalled cases nobody owns, revenue that never starts",
  rawMarkdown: loadMarkdown("targeting-revenue-agent.md"),
  icp: {
    industry:
      "Payment processors & merchant acquirers, neobanks/consumer fintech, spend management, benefits & HSA/FSA, retirement/401(k), lenders, remittance — revenue gated behind onboarding/activation",
    companySize:
      "50+ employees (no hard ceiling — size the deal to recovered revenue)",
    geography: "US, UK, EU, Africa (multi-market processors)",
    targetTitles: [
      "COO",
      "CRO",
      "Chief Customer Officer",
      "Head of Onboarding",
      "Head of Implementation",
      "Head of Activation",
      "VP Operations",
      "Head of Merchant Operations",
      "Head of Revenue Operations",
      "Head of Client Services",
      "Director of Onboarding",
      "Director of Implementation",
    ],
    painPoints: [
      "Onboarding is non-linear — steps run in parallel, no single queue anyone owns",
      "No timestamp tracking on where cases stall or why",
      "Client-facing chasing falls entirely on the onboarding team; internal handoffs leave the client out of the loop",
      "Context lost on reassignment across Salesforce, Zendesk, spreadsheets",
      "Work spans weeks — ticket-based tooling cannot hold it together",
      "A stall equals revenue that never starts, not just a bad CX metric",
    ],
    keywords: [
      "onboarding automation",
      "activation",
      "merchant onboarding",
      "KYB",
      "time-to-revenue",
      "stalled applications",
      "revenue recovery",
      "implementation",
    ],
  },
  offering: {
    description:
      "Rulebase's Revenue Agent reads every onboarding/activation case, finds the stalled ones, and drives them to activation end-to-end — with real-time visibility, not a dashboard checked after the fact.",
    valueProposition:
      "Recover the revenue stuck in onboarding. Every stalled application chased to activation automatically — measured in TPV / funded accounts, not saved hours.",
    differentiators: [
      "Owns the stalled onboarding case end-to-end — the work nobody else owns",
      "Per-market compliance depth generic agent platforms won't do (Paystack multi-market)",
      "Speaks in recovered revenue (TPV, funded accounts) — justifies outcome-based pricing",
      "One real stuck case traced to resolution beats a dashboard; production in days, not a 2-year build",
    ],
  },
  positioning: {
    angle: "Recover the revenue stuck in onboarding",
    tone: "Revenue-first. Speak in the customer's metric (TPV, funded/enrolled accounts). Anchor high vs recovered revenue, never saved hours. Never route through compliance.",
    keyMessages: [
      "A stalled onboarding is revenue that never starts — not a CX metric.",
      "One re-engagement pass found ~$1M. What would continuous coverage return?",
      "Why did you find out days later? The Revenue Agent flags the stall the moment it happens and chases it to activation.",
    ],
  },
  signalSlugs: [
    "ma-book-of-business-transfer",
    "sponsor-bank-baas-change",
    "new-revenue-ops-leader",
    "new-market-license",
    "activation-metric-reported",
    "manual-revenue-recovery",
    "onboarding-kyb-hiring",
    "open-enrollment-window",
    "platform-migration",
    "pe-acquisition-funding",
  ],
  apolloCompanyFilters: {
    q_organization_keyword_tags: [
      "payments",
      "payment processing",
      "merchant acquiring",
      "neobank",
      "spend management",
      "benefits administration",
      "retirement",
      "lending",
      "remittance",
      "fintech",
    ],
    organization_num_employees_ranges: [
      "51,200",
      "201,500",
      "501,1000",
      "1001,5000",
      "5001,10000",
    ],
    q_organization_job_titles: [
      "Head of Onboarding",
      "Head of Implementation",
      "Head of Merchant Operations",
      "VP Operations",
      "Chief Operating Officer",
    ],
  },
  apolloPersonFilters: {
    person_titles: [
      "COO",
      "CRO",
      "Chief Customer Officer",
      "Head of Onboarding",
      "Head of Implementation",
      "Head of Activation",
      "VP Operations",
      "Head of Merchant Operations",
      "Head of Revenue Operations",
      "Head of Client Services",
      "Director of Onboarding",
      "Director of Implementation",
    ],
    person_seniorities: ["manager", "director", "vp", "c_suite"],
  },
};

const QA_PRESET: ICPPreset = {
  slug: "qa",
  name: "QA",
  description:
    "Fintechs reviewing 2-5% of conversations after the fact — need real-time 100% coverage",
  rawMarkdown: loadMarkdown("targeting-qa.md"),
  icp: {
    industry:
      "Neobanks, spend management, B2C fintech (lending, EWA, HEI, mortgage)",
    companySize: "50-5,000 employees",
    geography: "US, UK, EU",
    targetTitles: [
      "Head of Operations",
      "Head of Customer Service",
      "Head of CX",
      "QA Lead",
      "QA Manager",
      "VP Customer Operations",
      "Director of Support",
      "Head of Customer Experience",
    ],
    painPoints: [
      "Sampling 2-5% of conversations after the fact — blind to 95%+",
      "QA talent wasted on grading tickets instead of driving strategy",
      "Scaling support team without scaling QA headcount",
      "Current QA tool is failing or too expensive (MaestroQA, Klaus, internal build)",
      "No way to know what is going wrong until customers escalate or churn",
    ],
    keywords: [
      "QA automation",
      "real-time QA",
      "100% coverage",
      "agent coaching",
      "conversation analytics",
      "customer ops",
    ],
  },
  offering: {
    description:
      "Rulebase reads every customer conversation in real time and turns it into action. QA block: reviews 100% of interactions as they happen, not the 2-5% sampled after the fact.",
    valueProposition:
      "Stay on top of every customer conversation. Catch what is going wrong as it happens — before customers churn or complain.",
    differentiators: [
      "Real-time 100% coverage, not after-the-fact sampling",
      "Built for financial services — CFPB, disputes, sponsor bank reporting baked in",
      "Configurable in plain language — not rigid scorecards",
      "Deploys in days — works with Zendesk, Intercom, Aircall",
    ],
  },
  positioning: {
    angle: "Stay on top of every customer conversation",
    tone: "Direct, outcome-focused. Never say 'QA tool' — say 'AI for customer ops'",
    keyMessages: [
      "You're reviewing 2-5% of conversations after the fact. What about the other 95%?",
      "Your best QA people should drive strategy, not grade tickets",
      "Know before anything gets escalated — not after",
    ],
  },
  signalSlugs: [
    "new-leader-hired",
    "compliance-qa-job-posting",
    "cx-team-scaling",
    "trustpilot-review-surge",
    "platform-migration",
    "ai-agent-deployment",
  ],
  apolloCompanyFilters: {
    q_organization_keyword_tags: [
      "fintech",
      "neobank",
      "spend management",
      "lending",
      "payments",
      "financial services",
    ],
    organization_num_employees_ranges: [
      "51,200",
      "201,500",
      "501,1000",
      "1001,5000",
    ],
    q_organization_job_titles: [
      "Head of CX",
      "Head of Operations",
      "QA Manager",
      "Head of Customer Service",
      "VP Customer Operations",
    ],
  },
  apolloPersonFilters: {
    person_titles: [
      "Head of Operations",
      "Head of Customer Service",
      "Head of CX",
      "VP Customer Operations",
      "QA Lead",
      "QA Manager",
      "Director of Support",
      "Head of Customer Experience",
    ],
    person_seniorities: ["manager", "senior", "director", "vp", "c_suite"],
  },
};

const CUSTOMER_INTELLIGENCE_PRESET: ICPPreset = {
  slug: "customer-intelligence",
  name: "Customer Intelligence",
  description:
    "Fintechs that cannot see what is happening across conversations — no view by program, product line, or channel",
  rawMarkdown: loadMarkdown("targeting-qa.md"),
  icp: {
    industry:
      "Neobanks, spend management, B2C fintech (lending, EWA, HEI, mortgage)",
    companySize: "50-5,000 employees",
    geography: "US, UK, EU",
    targetTitles: [
      "Head of CX",
      "VP Operations",
      "Director of Support",
      "Head of Customer Experience",
      "VP Customer Operations",
      "COO",
      "Head of Product (consumer)",
    ],
    painPoints: [
      "No cross-conversation view — cannot see patterns by product, channel, or program",
      "Insights arrive too late — weekly/monthly reporting instead of real-time",
      "Product and ops teams rely on anecdotal escalations, not data",
      "Cannot measure what is driving churn, complaints, or CSAT drops",
      "Manual tagging and spreadsheets for conversation categorization",
    ],
    keywords: [
      "conversation intelligence",
      "customer insights",
      "voice of customer",
      "CX analytics",
      "real-time reporting",
      "customer ops",
    ],
  },
  offering: {
    description:
      "Rulebase reads every customer conversation in real time and turns it into action. Customer Intelligence block: understands what is happening across conversations by program, product line, and channel.",
    valueProposition:
      "See what is actually happening across every conversation — by product, channel, program. Real-time leading indicators, not lagging ones.",
    differentiators: [
      "Cross-conversation intelligence — patterns by product, channel, program",
      "Real-time leading indicators, not end-of-week reports",
      "Built for financial services — disputes, compliance, sponsor bank reporting",
      "Configurable reports in plain language — 'weekly application drop-off report'",
    ],
  },
  positioning: {
    angle: "Real-time leading indicators across every conversation",
    tone: "Strategic, insight-focused. Frame as 'agents on the loop, not in the loop'",
    keyMessages: [
      "You have thousands of conversations happening. Do you know what they're telling you?",
      "Real-time leading indicators, not lagging ones",
      "Agents on the loop, not in the loop — surface what matters without waiting for escalations",
    ],
  },
  signalSlugs: [
    "new-leader-hired",
    "cx-team-scaling",
    "trustpilot-review-surge",
    "product-launch",
    "ai-agent-deployment",
  ],
  apolloCompanyFilters: {
    q_organization_keyword_tags: [
      "fintech",
      "neobank",
      "spend management",
      "lending",
      "payments",
      "financial services",
    ],
    organization_num_employees_ranges: [
      "51,200",
      "201,500",
      "501,1000",
      "1001,5000",
    ],
    q_organization_job_titles: [
      "Head of CX",
      "VP Operations",
      "Director of Support",
      "Head of Customer Experience",
      "COO",
    ],
  },
  apolloPersonFilters: {
    person_titles: [
      "Head of CX",
      "VP Operations",
      "Director of Support",
      "Head of Customer Experience",
      "VP Customer Operations",
      "COO",
    ],
    person_seniorities: ["director", "vp", "c_suite"],
  },
};

const PROACTIVE_AGENTS_PRESET: ICPPreset = {
  slug: "proactive-agents",
  name: "Proactive Agents",
  description:
    "Fintechs where disputes, complaints, and churn signals are caught too late — need agents that act from conversations",
  rawMarkdown: loadMarkdown("targeting-complaints.md"),
  icp: {
    industry:
      "Neobanks, spend management, B2C fintech (lending, EWA, HEI, mortgage)",
    companySize: "50-5,000 employees",
    geography: "US, UK, EU",
    targetTitles: [
      "Head of Operations",
      "Head of CX",
      "VP Customer Operations",
      "Head of Disputes",
      "Head of Complaints",
      "Director of Customer Service",
      "COO",
    ],
    painPoints: [
      "Disputes handled manually — slow intake, missed deadlines, high cost per dispute",
      "Complaints caught after escalation, not at the point of conversation",
      "Churn signals invisible until customer has already left",
      "No automation from conversation to action — agents copy-paste between systems",
      "High-effort tickets sit unnoticed until they become escalations",
    ],
    keywords: [
      "dispute automation",
      "complaint detection",
      "churn prevention",
      "proactive CX",
      "customer ops automation",
      "real-time alerting",
    ],
  },
  offering: {
    description:
      "Rulebase reads every customer conversation in real time and turns it into action. Proactive Agents block: acts before customers churn or complain. Every agent originates from a conversation and its ticket.",
    valueProposition:
      "Stop finding problems after the fact. Dispute Agent handles intake to issuer filing at 1/10 the cost. Complaint Agent triages and auto-resolves low-risk 10x faster. Coaching turns QA findings into simulations.",
    differentiators: [
      "Agents that originate from conversations — not bolted-on automation",
      "Dispute Agent: intake to issuer filing at ~1/10 cost",
      "Complaint Agent: triages and auto-resolves low-risk ~10x faster",
      "Configurable in plain language: 'flag disputes open 5+ days'",
    ],
  },
  positioning: {
    angle: "Act before customers churn or complain",
    tone: "Urgent, action-oriented. Lead with the cost of inaction — disputes, complaints, churn",
    keyMessages: [
      "Every conversation is telling you something. Are you acting on it?",
      "Disputes at 1/10 the cost. Complaints resolved 10x faster. Configured in plain language.",
      "Know before anything gets escalated — not after",
    ],
  },
  signalSlugs: [
    "new-leader-hired",
    "cx-team-scaling",
    "trustpilot-review-surge",
    "rising-cfpb-complaints",
    "consent-order-enforcement",
    "compliance-qa-job-posting",
  ],
  apolloCompanyFilters: {
    q_organization_keyword_tags: [
      "fintech",
      "neobank",
      "spend management",
      "lending",
      "payments",
      "financial services",
    ],
    organization_num_employees_ranges: [
      "51,200",
      "201,500",
      "501,1000",
      "1001,5000",
    ],
    q_organization_job_titles: [
      "Head of Operations",
      "Head of CX",
      "Head of Disputes",
      "VP Customer Operations",
      "Head of Complaints",
    ],
  },
  apolloPersonFilters: {
    person_titles: [
      "Head of Operations",
      "Head of CX",
      "VP Customer Operations",
      "Head of Disputes",
      "Head of Complaints",
      "Director of Customer Service",
      "COO",
    ],
    person_seniorities: ["manager", "senior", "director", "vp", "c_suite"],
  },
};

export const PRESETS: Record<string, ICPPreset> = {
  "revenue-agent": REVENUE_AGENT_PRESET,
  qa: QA_PRESET,
  "customer-intelligence": CUSTOMER_INTELLIGENCE_PRESET,
  "proactive-agents": PROACTIVE_AGENTS_PRESET,
};

export const PRESET_LIST: ICPPreset[] = [
  REVENUE_AGENT_PRESET,
  QA_PRESET,
  CUSTOMER_INTELLIGENCE_PRESET,
  PROACTIVE_AGENTS_PRESET,
];

export function getPreset(slug: string): ICPPreset | null {
  return PRESETS[slug] ?? null;
}

export function getPresetSignalSlugs(slug: string): string[] {
  return PRESETS[slug]?.signalSlugs ?? [];
}
