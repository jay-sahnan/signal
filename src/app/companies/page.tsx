"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  MessageSquare,
  Search,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Signal {
  signalName: string;
  category: string;
  found: boolean;
  summary: string;
  confidence: string;
  evidence: Array<{ url: string; snippet: string }>;
}

interface Contact {
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  email: string | null;
  priorityScore: number | null;
}

interface Company {
  orgId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  headcount: number | null;
  revenue: string | null;
  score: number | null;
  scoreReason: string | null;
  suggestedApproach: string | null;
  icpPreset: string | null;
  websiteSummary: string | null;
  techStack: string[];
  fundingStage: string | null;
  hiring: { totalJobs: number; roles: string[] };
  recentNews: Array<{ title: string; url: string; date: string }>;
  signals: Signal[];
  signalCount: number;
  contacts: Contact[];
  contactCount: number;
}

const ICP_COLORS: Record<string, { tag: string; bar: string }> = {
  complaints: {
    tag: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
    bar: "bg-rose-500",
  },
  "sales-compliance": {
    tag: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
    bar: "bg-violet-500",
  },
  qa: {
    tag: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
    bar: "bg-sky-500",
  },
};
const ICP_LABELS: Record<string, string> = {
  complaints: "Complaints",
  "sales-compliance": "Sales Compliance",
  qa: "QA",
};

const TABS = [
  { slug: "all", label: "All", icon: Globe },
  { slug: "complaints", label: "Complaints", icon: AlertTriangle },
  { slug: "sales-compliance", label: "Sales Compliance", icon: Shield },
  { slug: "qa", label: "QA", icon: Zap },
];

function sourceLabel(url: string): string {
  try {
    const d = new URL(url).hostname.replace("www.", "");
    if (d.includes("trustpilot")) return "Trustpilot";
    if (d.includes("bbb")) return "BBB";
    if (d.includes("consumerfinance")) return "CFPB";
    if (d.includes("reddit")) return "Reddit";
    if (d.includes("linkedin")) return "LinkedIn";
    return d.split(".")[0];
  } catch {
    return "Source";
  }
}

function SignalIcon({ name }: { name: string }) {
  if (name.includes("Complaint") || name.includes("Trustpilot"))
    return <AlertTriangle className="h-3 w-3 text-rose-500" />;
  if (name.includes("Regulatory") || name.includes("UDAAP"))
    return <Shield className="h-3 w-3 text-red-500" />;
  if (name.includes("Hiring") || name.includes("CX"))
    return <Users className="h-3 w-3 text-blue-500" />;
  if (name.includes("AI"))
    return <Sparkles className="h-3 w-3 text-purple-500" />;
  if (name.includes("Growth") || name.includes("Funding"))
    return <TrendingUp className="h-3 w-3 text-green-500" />;
  return <Zap className="h-3 w-3 text-amber-500" />;
}

function CompanyRow({ company }: { company: Company }) {
  const [expanded, setExpanded] = useState(false);
  const colors = ICP_COLORS[company.icpPreset ?? "qa"] ?? ICP_COLORS.qa;
  const fired = company.signals.filter((s) => s.found);

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Main row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="hover:bg-muted/40 flex w-full items-center gap-4 px-4 py-3 text-left transition-colors"
      >
        {/* Expand icon */}
        <div className="shrink-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        {/* Score */}
        <div className="w-12 shrink-0 text-center">
          {company.score !== null && (
            <span
              className={cn(
                "inline-block rounded-md px-2 py-0.5 text-xs font-bold tabular-nums",
                company.score >= 9
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : company.score >= 7
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {company.score}
            </span>
          )}
        </div>

        {/* Company info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{company.name}</span>
            {company.domain && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {company.domain}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
            {company.location && (
              <span className="flex items-center gap-0.5">
                <MapPin className="h-2.5 w-2.5" />
                {company.location}
              </span>
            )}
            {company.headcount && (
              <span>{company.headcount.toLocaleString()} emp</span>
            )}
            {company.industry && (
              <span className="hidden lg:inline">{company.industry}</span>
            )}
          </div>
        </div>

        {/* ICP tag */}
        <span
          className={cn(
            "shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold",
            colors.tag,
          )}
        >
          {ICP_LABELS[company.icpPreset ?? ""] ?? ""}
        </span>

        {/* Signal count */}
        <div className="hidden w-20 shrink-0 text-right sm:block">
          {fired.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              {fired.length} signal{fired.length !== 1 ? "s" : ""}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/40">--</span>
          )}
        </div>

        {/* Contact count */}
        <div className="hidden w-20 shrink-0 text-right sm:block">
          {company.contactCount > 0 ? (
            <span className="text-xs text-muted-foreground">
              {company.contactCount} contact
              {company.contactCount !== 1 ? "s" : ""}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/40">--</span>
          )}
        </div>
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-border bg-muted/20 px-4 py-4 pl-14">
          <div className="grid gap-5 lg:grid-cols-3">
            {/* Col 1: Signals */}
            <div>
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Signals
              </h4>
              {fired.length > 0 ? (
                <div className="space-y-2">
                  {fired.map((s, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-background p-2.5"
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        <SignalIcon name={s.signalName} />
                        <span className="text-xs font-medium">
                          {s.signalName}
                        </span>
                        <span
                          className={cn(
                            "ml-auto rounded px-1 py-0.5 text-[9px] font-medium",
                            s.confidence === "high"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
                          )}
                        >
                          {s.confidence}
                        </span>
                      </div>
                      <p className="mb-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        {s.summary.slice(0, 150)}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {s.evidence.slice(0, 4).map((ev, j) => (
                          <a
                            key={j}
                            href={ev.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400"
                          >
                            <ExternalLink className="h-2 w-2" />
                            {sourceLabel(ev.url)}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No signals yet — static ICP fit only.
                </p>
              )}
            </div>

            {/* Col 2: Contacts */}
            <div>
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Contacts
              </h4>
              {company.contacts.length > 0 ? (
                <div className="space-y-1.5">
                  {company.contacts.map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg border border-border bg-background p-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium">{c.name}</span>
                          {c.linkedinUrl && (
                            <a
                              href={c.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600"
                            >
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {c.title}
                        </p>
                        {c.email && (
                          <p className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                            <Mail className="h-2.5 w-2.5" />
                            {c.email}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No contacts enriched.
                </p>
              )}

              {/* Quick links */}
              <div className="mt-3 flex flex-wrap gap-1">
                {company.domain && (
                  <a
                    href={`https://trustpilot.com/review/${company.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Search className="h-2 w-2" />
                    Trustpilot
                  </a>
                )}
                <a
                  href={`https://consumerfinance.gov/data-research/consumer-complaints/search/?company=${encodeURIComponent(company.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Shield className="h-2 w-2" />
                  CFPB
                </a>
                <a
                  href={`https://reddit.com/search/?q=${encodeURIComponent(company.name + " complaints")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <MessageSquare className="h-2 w-2" />
                  Reddit
                </a>
              </div>
            </div>

            {/* Col 3: Intel + Approach */}
            <div>
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Intel
              </h4>
              <div className="space-y-1.5 text-[11px]">
                {company.revenue && (
                  <div className="flex gap-1.5">
                    <TrendingUp className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span>{company.revenue as string}</span>
                  </div>
                )}
                {company.hiring.totalJobs > 0 && (
                  <div className="flex gap-1.5">
                    <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span>
                      {company.hiring.totalJobs} roles:{" "}
                      {company.hiring.roles.slice(0, 3).join(", ")}
                    </span>
                  </div>
                )}
                {company.fundingStage && (
                  <div className="flex gap-1.5">
                    <Sparkles className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span>{company.fundingStage}</span>
                  </div>
                )}
                {company.techStack.length > 0 && (
                  <div className="flex gap-1.5">
                    <Zap className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span>{company.techStack.slice(0, 4).join(", ")}</span>
                  </div>
                )}
                {company.domain && (
                  <a
                    href={`https://${company.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline"
                  >
                    <Globe className="h-3 w-3" />
                    {company.domain}
                  </a>
                )}
              </div>

              {company.suggestedApproach && (
                <div className="mt-3 rounded-lg bg-muted/50 p-2.5">
                  <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Approach
                  </h4>
                  <p className="text-[11px] leading-relaxed">
                    {company.suggestedApproach}
                  </p>
                </div>
              )}

              {company.scoreReason && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  <span className="font-medium">Score:</span>{" "}
                  {company.scoreReason}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CompaniesPage() {
  const [state, setState] = useState<{
    companies: Company[];
    loading: boolean;
  }>({ companies: [], loading: true });
  const { companies, loading } = state;
  const [activeTab, setActiveTab] = useState("all");

  useEffect(() => {
    const url =
      activeTab === "all"
        ? "/api/companies"
        : `/api/companies?preset=${activeTab}`;
    let cancelled = false;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled)
          setState({ companies: data.companies ?? [], loading: false });
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const withSignals = companies.filter((c) => c.signalCount > 0).length;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Companies</h1>
            <p className="text-muted-foreground text-xs">
              {companies.length} companies · {withSignals} with signals
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.slug}
              onClick={() => setActiveTab(tab.slug)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === tab.slug
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <tab.icon className="h-3 w-3" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Table header */}
        {!loading && companies.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <div className="w-4" />
              <div className="w-12 text-center">Score</div>
              <div className="min-w-0 flex-1">Company</div>
              <div className="w-24">ICP</div>
              <div className="hidden w-20 text-right sm:block">Signals</div>
              <div className="hidden w-20 text-right sm:block">Contacts</div>
            </div>
            {companies.map((c) => (
              <CompanyRow key={c.orgId} company={c} />
            ))}
          </div>
        )}

        {loading && (
          <div className="space-y-1">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-lg bg-muted/30"
              />
            ))}
          </div>
        )}

        {!loading && companies.length === 0 && (
          <div className="rounded-lg border border-border p-12 text-center">
            <p className="text-sm text-muted-foreground">No companies found.</p>
          </div>
        )}
      </div>
    </div>
  );
}
