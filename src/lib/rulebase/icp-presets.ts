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
  slug: "qa" | "complaints" | "sales-compliance";
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

const QA_PRESET: ICPPreset = {
  slug: "qa",
  name: "QA",
  description:
    "Companies with manual QA processes that need AI-powered 100% conversation coverage",
  rawMarkdown: loadMarkdown("targeting-qa.md"),
  icp: {
    industry:
      "Financial services, insurance, fintech, SaaS, e-commerce, healthcare",
    companySize: "200-5,000 employees",
    geography: "US, UK, EU, ANZ",
    targetTitles: [
      "VP/Director of Operations",
      "Head of CX",
      "Director of Customer Experience",
      "VP Customer Operations",
      "QA Manager",
      "QA Lead",
      "Quality Assurance Manager",
      "Head of Customer Success",
      "Director of Support",
    ],
    painPoints: [
      "Low QA coverage rates (1-3%)",
      "Manual QA with spreadsheets",
      "High agent attrition from lack of coaching",
      "Multi-channel QA burden",
      "Scaling support team without scaling QA",
    ],
    keywords: [
      "QA automation",
      "quality assurance",
      "CSAT improvement",
      "agent coaching",
      "contact center QA",
    ],
  },
  offering: {
    description:
      "Rulebase is an AI-powered QA platform that evaluates 100% of customer conversations — calls, chat, email — against customisable scorecards, replacing manual sampling with full coverage.",
    valueProposition:
      "Move from reviewing 1-3% of conversations to 100%. Find systemic quality issues, coach agents based on real data, and catch problems before they compound.",
    differentiators: [
      "100% automated QA coverage across all channels",
      "AI + human QA working together with contested evaluation workflows",
      "Tightly integrated with compliance and complaint detection",
      "Deploys in days, not months — works with existing Zendesk/Aircall stack",
    ],
  },
  positioning: {
    angle: "QA coverage gap",
    tone: "Direct, data-driven, focused on operational impact",
    keyMessages: [
      "Manual QA breaks down at scale — you're making decisions on a statistically insignificant sample",
      "AI evaluates every conversation against your exact quality criteria",
      "QA and compliance in one platform, not two separate tools",
    ],
  },
  signalSlugs: [
    "new-leader-hired",
    "compliance-qa-job-posting",
    "ai-agent-adoption-cx",
    "cx-team-scaling",
  ],
  apolloCompanyFilters: {
    q_organization_keyword_tags: [
      "SaaS",
      "fintech",
      "customer service",
      "financial services",
      "insurance",
    ],
    organization_num_employees_ranges: ["201,500", "501,1000", "1001,5000"],
    q_organization_job_titles: [
      "QA Manager",
      "Head of CX",
      "Quality Analyst",
      "Director of Customer Experience",
      "VP Customer Operations",
    ],
  },
  apolloPersonFilters: {
    person_titles: [
      "VP Operations",
      "Head of CX",
      "Director of Customer Experience",
      "VP Customer Operations",
      "QA Manager",
      "QA Lead",
      "Director of Support",
      "Head of Customer Success",
    ],
    person_seniorities: ["director", "vp", "c_suite"],
  },
};

const COMPLAINTS_PRESET: ICPPreset = {
  slug: "complaints",
  name: "Complaints",
  description:
    "Auto finance and consumer lending companies failing to detect and capture customer complaints",
  rawMarkdown: loadMarkdown("targeting-complaints.md"),
  icp: {
    industry:
      "Auto finance, consumer lending, mortgage servicing, student loan servicing, credit unions",
    companySize: "200-5,000 employees",
    geography: "US",
    targetTitles: [
      "Chief Compliance Officer",
      "Head of Consumer Affairs",
      "Complaints Manager",
      "Complaints Director",
      "VP Regulatory Affairs",
      "Head of Customer Outcomes",
    ],
    painPoints: [
      "Complaint undercounting — only catching what agents manually log",
      "CFPB enforcement risk from systematic complaint handling failures",
      "Rising Trustpilot/BBB complaints mirroring internal failures",
      "Manual complaint logging is error-prone in high-volume servicing",
      "No systematic way to detect implicit complaints across 100% of interactions",
    ],
    keywords: [
      "UDAAP",
      "CFPB",
      "complaint management",
      "consent order",
      "complaint detection",
      "Consumer Duty",
    ],
  },
  offering: {
    description:
      "Rulebase detects customer complaints across 100% of servicing, collections, and sales interactions — including implicit complaints agents routinely miss.",
    valueProposition:
      "Stop relying on agents to manually log complaints. Rulebase AI identifies every expression of dissatisfaction with citations and severity scoring, so you catch systemic issues before regulators do.",
    differentiators: [
      "Detects complaints agents miss — implicit dissatisfaction, not just formal escalations",
      "Complaint detection integrated with QA and compliance in one platform",
      "Audit-ready evidence with specific citations and timestamps",
      "Deploys in days — integrates with existing telephony and CRM",
    ],
  },
  positioning: {
    angle: "Complaint detection gap — what you're missing",
    tone: "Urgent, regulatory-aware, evidence-driven",
    keyMessages: [
      "The CFPB uses your complaint data to prioritise enforcement — rising complaints are a leading indicator",
      "Most lenders only capture complaints agents manually log — that's a fraction of actual dissatisfaction",
      "Rulebase flags every expression of dissatisfaction with evidence, not just the ones that get escalated",
    ],
  },
  signalSlugs: [
    "consent-order-enforcement",
    "new-leader-hired",
    "rising-cfpb-complaints",
    "trustpilot-review-surge",
    "pe-acquisition-funding",
    "compliance-qa-job-posting",
  ],
  apolloCompanyFilters: {
    q_organization_keyword_tags: [
      "auto finance",
      "consumer lending",
      "mortgage",
      "financial services",
      "loan servicing",
    ],
    organization_num_employees_ranges: ["201,500", "501,1000", "1001,5000"],
    q_organization_job_titles: [
      "Complaints Manager",
      "Chief Compliance Officer",
      "Head of Consumer Affairs",
      "VP Regulatory",
    ],
  },
  apolloPersonFilters: {
    person_titles: [
      "Chief Compliance Officer",
      "Head of Consumer Affairs",
      "Complaints Manager",
      "Complaints Director",
      "VP Regulatory Affairs",
      "Head of Customer Outcomes",
      "General Counsel",
    ],
    person_seniorities: ["director", "vp", "c_suite"],
  },
};

const SALES_COMPLIANCE_PRESET: ICPPreset = {
  slug: "sales-compliance",
  name: "Sales Compliance",
  description:
    "Auto finance and lending companies with unmonitored sales conversations violating UDAAP, TILA, ECOA",
  rawMarkdown: loadMarkdown("targeting-sales-compliance.md"),
  icp: {
    industry:
      "Auto finance, consumer lending, mortgage origination, student lending, credit unions with lending",
    companySize: "200-5,000 employees",
    geography: "US",
    targetTitles: [
      "Chief Compliance Officer",
      "VP of Risk",
      "Sales Compliance Manager",
      "Fair Lending Officer",
      "Head of Sales",
      "VP Regulatory Affairs",
    ],
    painPoints: [
      "Sales reps misrepresenting loan terms without detection",
      "No systematic compliance monitoring across 100% of sales calls",
      "UDAAP violations only caught by examiners or lawsuits",
      "Dealer network is highest-risk and hardest to monitor",
      "Manual compliance monitoring covers <5% of conversations",
    ],
    keywords: [
      "UDAAP",
      "fair lending",
      "TILA",
      "SCRA",
      "sales compliance",
      "CFPB exam",
      "consent order",
    ],
  },
  offering: {
    description:
      "Rulebase monitors 100% of sales conversations for compliance violations — UDAAP, TILA, ECOA, SCRA — with specific evidence citations for each finding.",
    valueProposition:
      "Stop finding out about sales compliance violations from examiners. Rulebase catches misrepresentations, missing disclosures, and high-pressure tactics in real-time across every call.",
    differentiators: [
      "100% sales conversation coverage — not a 2% sample",
      "Audit-ready evidence with quotes and timestamps for each violation",
      "Sales compliance + QA + complaints in one platform",
      "Deploys in days for mid-market lenders — no 6-month Verint rollout",
    ],
  },
  positioning: {
    angle: "Sales compliance monitoring gap",
    tone: "Regulatory-urgent, specific, enforcement-aware",
    keyMessages: [
      "A single UDAAP enforcement action can cost 10-100x what prevention would",
      "The CFPB has made auto lending a top enforcement priority — sales practices are in the crosshairs",
      "Rulebase monitors every sales call against your compliance criteria with specific evidence",
    ],
  },
  signalSlugs: [
    "consent-order-enforcement",
    "new-leader-hired",
    "rising-cfpb-complaints",
    "pe-acquisition-funding",
    "udaap-sales-practice-risk",
    "compliance-qa-job-posting",
  ],
  apolloCompanyFilters: {
    q_organization_keyword_tags: [
      "auto finance",
      "consumer lending",
      "mortgage",
      "auto loans",
      "financial services",
    ],
    organization_num_employees_ranges: ["201,500", "501,1000", "1001,5000"],
    q_organization_job_titles: [
      "Sales Compliance",
      "Fair Lending",
      "Chief Compliance Officer",
      "VP Risk",
    ],
  },
  apolloPersonFilters: {
    person_titles: [
      "Chief Compliance Officer",
      "VP of Risk",
      "Sales Compliance Manager",
      "Fair Lending Officer",
      "Head of Sales",
      "VP Regulatory Affairs",
      "General Counsel",
    ],
    person_seniorities: ["director", "vp", "c_suite"],
  },
};

export const PRESETS: Record<string, ICPPreset> = {
  qa: QA_PRESET,
  complaints: COMPLAINTS_PRESET,
  "sales-compliance": SALES_COMPLIANCE_PRESET,
};

export const PRESET_LIST: ICPPreset[] = [
  QA_PRESET,
  COMPLAINTS_PRESET,
  SALES_COMPLIANCE_PRESET,
];

export function getPreset(slug: string): ICPPreset | null {
  return PRESETS[slug] ?? null;
}

export function getPresetSignalSlugs(slug: string): string[] {
  return PRESETS[slug]?.signalSlugs ?? [];
}
