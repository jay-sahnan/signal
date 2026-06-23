"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Linkedin,
  Loader2,
  Mail,
  Sparkles,
  Upload,
  Users,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ListRowsSkeleton } from "@/components/ui/skeleton-presets";
import { cn } from "@/lib/utils";
import { useCampaign } from "@/lib/campaign-context";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Signal {
  signalName: string;
  summary: string;
  confidence: string;
}

interface Contact {
  personId: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
}

interface Company {
  orgId: string;
  companyId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  headcount: number | null;
  score: number | null;
  scoreReason: string | null;
  readinessTag: string | null;
  signals: Signal[];
  topContacts: Contact[];
  suggestedApproach: string | null;
}

interface HomeData {
  stats: {
    totalCompanies: number;
    qualified: number;
    readyToContact: number;
    avgScore: number;
  };
  companies: Company[];
}

interface QuickMsg {
  subject: string;
  body: string;
}

/* ------------------------------------------------------------------ */
/*  Segment control                                                    */
/* ------------------------------------------------------------------ */

const SEGMENTS = [
  { slug: "qa", label: "QA" },
  { slug: "complaints", label: "Complaints" },
  { slug: "sales-compliance", label: "Sales Compliance" },
] as const;

function SegmentControl({
  active,
  onChange,
}: {
  active: string;
  onChange: (s: string) => void;
}) {
  return (
    <div className="bg-muted inline-flex items-center gap-1 rounded-lg p-1">
      {SEGMENTS.map((seg) => (
        <button
          key={seg.slug}
          onClick={() => onChange(seg.slug)}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-all",
            active === seg.slug
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {seg.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Contact row — reusable                                             */
/* ------------------------------------------------------------------ */

function ContactRow({
  contact,
  companyName,
  msg,
  isGenerating,
  isCopied,
  onGenerate,
  onCopy,
}: {
  contact: Contact;
  companyName: string;
  msg: QuickMsg | undefined;
  isGenerating: boolean;
  isCopied: boolean;
  onGenerate: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="border-border rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {contact.name as string}
            </span>
            <a
              href={
                contact.linkedinUrl
                  ? (contact.linkedinUrl as string)
                  : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent((contact.name as string) + " " + companyName)}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400"
            >
              <Linkedin className="h-3 w-3" />
              LinkedIn
            </a>
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="text-muted-foreground hover:text-foreground flex items-center gap-0.5 text-[11px]"
              >
                <Mail className="h-2.5 w-2.5" />
                {contact.email as string}
              </a>
            )}
          </div>
          {contact.title && (
            <p className="text-muted-foreground text-xs">
              {contact.title as string}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {!msg ? (
            <Button
              size="sm"
              className="text-xs"
              disabled={isGenerating}
              onClick={onGenerate}
            >
              {isGenerating ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3 w-3" />
              )}
              Message
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={onCopy}
            >
              {isCopied ? (
                <Check className="mr-1 h-3 w-3" />
              ) : (
                <Copy className="mr-1 h-3 w-3" />
              )}
              {isCopied ? "Copied!" : "Copy"}
            </Button>
          )}
        </div>
      </div>
      {msg && (
        <div className="bg-muted/30 mt-2 rounded-md border p-2.5">
          <p className="text-xs font-medium">Subject: {msg.subject}</p>
          <p className="text-muted-foreground mt-1 whitespace-pre-line text-xs leading-relaxed">
            {msg.body}
          </p>
          <div className="mt-1.5 flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px]"
              disabled={isGenerating}
              onClick={onGenerate}
            >
              <Sparkles className="mr-0.5 h-2.5 w-2.5" />
              Redo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px]"
              onClick={onCopy}
            >
              <Copy className="mr-0.5 h-2.5 w-2.5" />
              {isCopied ? "Copied!" : "Copy"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 p-4 md:p-6">
            <ListRowsSkeleton count={6} />
          </div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { openAgentWith } = useCampaign();
  const activeIcp = searchParams.get("icp") || "qa";

  const [state, setState] = useState<{
    data: HomeData | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: true, error: null });
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [messages, setMessages] = useState<Map<string, QuickMsg>>(new Map());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, loading, error } = state;

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => ({ ...s, loading: true }));
    fetch(`/api/dashboard?preset=${activeIcp}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        const mapped: HomeData = {
          stats: json.stats,
          companies: (json.targets ?? []).map((t: Record<string, unknown>) => ({
            orgId: t.orgId,
            companyId: t.companyId,
            name: t.name,
            domain: t.domain,
            industry: t.industry,
            location: t.location,
            headcount: t.headcount,
            score: t.score,
            scoreReason: t.scoreReason,
            readinessTag: t.readinessTag,
            signals: ((t.signals as Array<Record<string, unknown>>) ?? []).map(
              (s) => ({
                signalName: s.signalName,
                summary: s.summary,
                confidence: s.confidence,
              }),
            ),
            topContacts: (
              (t.topContacts as Array<Record<string, unknown>>) ?? []
            ).map((c) => ({
              personId: (c.personId as string) ?? `${c.name}-${c.email ?? ""}`,
              name: c.name,
              title: c.title,
              email: c.email,
              linkedinUrl: c.linkedinUrl,
            })),
            suggestedApproach: t.suggestedApproach,
          })),
        };
        setState({ data: mapped, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled)
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [activeIcp]);

  const icpLabel =
    activeIcp === "complaints"
      ? "Complaints"
      : activeIcp === "sales-compliance"
        ? "Sales Compliance"
        : "QA";

  const handleGenerateMessage = async (contact: Contact, orgId: string) => {
    const key = contact.personId;
    setGeneratingFor(key);
    try {
      const res = await fetch("/api/generate-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: key, organizationId: orgId }),
      });
      if (!res.ok) throw new Error("fail");
      const r = await res.json();
      setMessages((prev) => {
        const n = new Map(prev);
        n.set(key, { subject: r.subject, body: r.body });
        return n;
      });
    } catch {
      setMessages((prev) => {
        const n = new Map(prev);
        n.set(key, {
          subject: "Error",
          body: "Could not generate. Try again.",
        });
        return n;
      });
    } finally {
      setGeneratingFor(null);
    }
  };

  const handleCopy = (id: string) => {
    const m = messages.get(id);
    if (!m) return;
    navigator.clipboard.writeText(`Subject: ${m.subject}\n\n${m.body}`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Split companies into priority (have signals + contacts) vs rest
  const priority =
    data?.companies.filter(
      (c) => c.signals.length > 0 && c.topContacts.length > 0,
    ) ?? [];
  const withSignals =
    data?.companies.filter(
      (c) => c.signals.length > 0 && c.topContacts.length === 0,
    ) ?? [];
  const rest = data?.companies.filter((c) => c.signals.length === 0) ?? [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-5 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentControl
            active={activeIcp}
            onChange={(s) => router.push(`/?icp=${s}`)}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openAgentWith(
                  `Find me more companies that fit the ${icpLabel} ICP. Add them to the ${icpLabel} campaign. Then enrich and score the top 5.`,
                )
              }
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Find More
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.open(`/api/export-apollo?preset=${activeIcp}`, "_blank")
              }
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Apollo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.open(`/api/export-csv?preset=${activeIcp}`, "_blank")
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Smartlead
            </Button>
          </div>
        </div>

        {/* Stats */}
        {!loading && data && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Companies", value: data.stats.totalCompanies },
              { label: "Qualified", value: data.stats.qualified },
              { label: "Ready to Contact", value: data.stats.readyToContact },
              { label: "Avg Score", value: data.stats.avgScore },
            ].map((s) => (
              <div
                key={s.label}
                className="border-border rounded-lg border p-3"
              >
                <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                  {s.label}
                </p>
                <p className="text-xl font-bold tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {loading && <ListRowsSkeleton count={6} />}
        {error && !loading && (
          <div className="border-border rounded-lg border p-6 text-center">
            <p className="text-muted-foreground text-sm">
              Failed to load: {error}
            </p>
          </div>
        )}

        {/* ═══ PRIORITY: Signal + Contact = Ready to outreach ═══ */}
        {!loading && priority.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <h2 className="text-sm font-semibold">
                Ready to Contact ({priority.length})
              </h2>
              <p className="text-muted-foreground text-xs">
                Signals fired + contacts found — reach out now
              </p>
            </div>
            <div className="space-y-2">
              {priority.map((co) => (
                <CompanyCard
                  key={co.orgId}
                  co={co}
                  expanded={expandedOrg === co.orgId}
                  onToggle={() =>
                    setExpandedOrg(expandedOrg === co.orgId ? null : co.orgId)
                  }
                  onCompanyClick={() => router.push(`/company/${co.orgId}`)}
                  icpLabel={icpLabel}
                  openAgentWith={openAgentWith}
                  messages={messages}
                  generatingFor={generatingFor}
                  copiedId={copiedId}
                  onGenerate={(c) => handleGenerateMessage(c, co.orgId)}
                  onCopy={handleCopy}
                />
              ))}
            </div>
          </section>
        )}

        {/* ═══ SIGNALS FIRED but no contacts yet ═══ */}
        {!loading && withSignals.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-amber-500" />
              <h2 className="text-sm font-semibold">
                Signals Fired — Need Contacts ({withSignals.length})
              </h2>
              <p className="text-muted-foreground text-xs">
                Find decision-makers to start outreach
              </p>
            </div>
            <div className="space-y-2">
              {withSignals.map((co) => (
                <CompanyCard
                  key={co.orgId}
                  co={co}
                  expanded={expandedOrg === co.orgId}
                  onToggle={() =>
                    setExpandedOrg(expandedOrg === co.orgId ? null : co.orgId)
                  }
                  onCompanyClick={() => router.push(`/company/${co.orgId}`)}
                  icpLabel={icpLabel}
                  openAgentWith={openAgentWith}
                  messages={messages}
                  generatingFor={generatingFor}
                  copiedId={copiedId}
                  onGenerate={(c) => handleGenerateMessage(c, co.orgId)}
                  onCopy={handleCopy}
                />
              ))}
            </div>
          </section>
        )}

        {/* ═══ ICP FIT but no signals ═══ */}
        {!loading && rest.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <div className="bg-muted-foreground/30 h-2 w-2 rounded-full" />
              <h2 className="text-sm font-semibold">
                ICP Fit — No Signals Yet ({rest.length})
              </h2>
              <p className="text-muted-foreground text-xs">
                Enrich to check for buying signals
              </p>
            </div>
            <div className="space-y-2">
              {rest.map((co) => (
                <CompanyCard
                  key={co.orgId}
                  co={co}
                  expanded={expandedOrg === co.orgId}
                  onToggle={() =>
                    setExpandedOrg(expandedOrg === co.orgId ? null : co.orgId)
                  }
                  onCompanyClick={() => router.push(`/company/${co.orgId}`)}
                  icpLabel={icpLabel}
                  openAgentWith={openAgentWith}
                  messages={messages}
                  generatingFor={generatingFor}
                  copiedId={copiedId}
                  onGenerate={(c) => handleGenerateMessage(c, co.orgId)}
                  onCopy={handleCopy}
                />
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {!loading && data && data.companies.length === 0 && (
          <div className="border-border rounded-lg border p-10 text-center">
            <Building2 className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
            <p className="text-sm font-medium">
              No enriched companies for {icpLabel}
            </p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-xs">
              Companies appear here after enrichment and scoring. Go to the
              Target List to enrich pending companies.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => router.push("/icp?tab=targets")}
              >
                View Target List
              </Button>
              <Button
                onClick={() =>
                  openAgentWith(
                    `Find companies for the ${icpLabel} ICP, add them, enrich the top 5, and score them.`,
                  )
                }
              >
                <Sparkles className="mr-1.5 h-4 w-4" />
                Find & Enrich
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Company card                                                       */
/* ------------------------------------------------------------------ */

function CompanyCard({
  co,
  expanded,
  onToggle,
  onCompanyClick,
  icpLabel,
  openAgentWith,
  messages,
  generatingFor,
  copiedId,
  onGenerate,
  onCopy,
}: {
  co: Company;
  expanded: boolean;
  onToggle: () => void;
  onCompanyClick: () => void;
  icpLabel: string;
  openAgentWith: (p: string) => void;
  messages: Map<string, QuickMsg>;
  generatingFor: string | null;
  copiedId: string | null;
  onGenerate: (c: Contact) => void;
  onCopy: (id: string) => void;
}) {
  return (
    <div className="border-border overflow-hidden rounded-lg border">
      {/* Row */}
      <button
        onClick={onToggle}
        className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
      >
        <div className="w-4 shrink-0">
          {expanded ? (
            <ChevronDown className="text-muted-foreground h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="text-muted-foreground h-3.5 w-3.5" />
          )}
        </div>

        {/* Score */}
        <div className="w-10 shrink-0 text-center">
          {co.score !== null && (
            <span
              className={cn(
                "inline-block rounded-md px-2 py-0.5 text-xs font-bold tabular-nums",
                co.score >= 8
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  : co.score >= 6
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {co.score}
            </span>
          )}
        </div>

        {/* Company info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{co.name}</span>
            {co.domain && (
              <span className="text-muted-foreground hidden text-xs lg:inline">
                {co.domain}
              </span>
            )}
          </div>
          {/* Why now — the signal reason, not company metadata */}
          {co.scoreReason && (
            <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
              {co.scoreReason}
            </p>
          )}
        </div>

        {/* Signal pills */}
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          {co.signals.slice(0, 2).map((s, i) => (
            <span
              key={i}
              className={cn(
                "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium",
                s.confidence === "high"
                  ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
              )}
            >
              <Zap className="h-2 w-2" />
              {s.signalName.length > 16
                ? s.signalName.slice(0, 14) + "..."
                : s.signalName}
            </span>
          ))}
        </div>

        {/* Contact count */}
        <span className="text-muted-foreground w-16 shrink-0 text-right text-xs">
          {co.topContacts.length > 0
            ? `${co.topContacts.length} contact${co.topContacts.length !== 1 ? "s" : ""}`
            : ""}
        </span>
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="border-border border-t bg-muted/10 px-4 py-4 pl-14">
          {/* Action bar */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {co.signals.length === 0 && (
              <Button
                size="sm"
                className="text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  openAgentWith(
                    `Enrich "${co.name}" (${co.domain ?? ""}): scrape website, run all signals for ${icpLabel} ICP. Find contacts. Score.`,
                  );
                }}
              >
                <Sparkles className="mr-1 h-3 w-3" />
                Enrich & Score
              </Button>
            )}
            {co.topContacts.length === 0 && co.signals.length > 0 && (
              <Button
                size="sm"
                className="text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  openAgentWith(
                    `Find contacts at "${co.name}" matching ${icpLabel} target titles. Enrich LinkedIn.`,
                  );
                }}
              >
                <Users className="mr-1 h-3 w-3" />
                Find Contacts
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onCompanyClick();
              }}
            >
              <ExternalLink className="mr-1 h-3 w-3" />
              Full Detail
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={(e) => {
                e.stopPropagation();
                openAgentWith(
                  `Find companies similar to "${co.name}" (${co.industry ?? ""}, ${co.location ?? ""}). Add to ${icpLabel} campaign.`,
                );
              }}
            >
              <Sparkles className="mr-1 h-3 w-3" />
              Find Similar
            </Button>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            {/* Signals */}
            <div>
              <h4 className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-wider">
                Signals
              </h4>
              {co.signals.length > 0 ? (
                <div className="space-y-1.5">
                  {co.signals.map((s, i) => (
                    <div
                      key={i}
                      className="border-border rounded-md border bg-background p-2"
                    >
                      <div className="flex items-center gap-1.5">
                        <Zap
                          className={cn(
                            "h-3 w-3 shrink-0",
                            s.confidence === "high"
                              ? "text-green-500"
                              : "text-amber-500",
                          )}
                        />
                        <span className="text-xs font-medium">
                          {s.signalName}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                        {s.summary.slice(0, 120)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Not yet scored. Click Enrich &amp; Score above.
                </p>
              )}
              {co.suggestedApproach && (
                <div className="mt-3 rounded-md bg-muted/50 p-2">
                  <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                    Approach
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed">
                    {co.suggestedApproach}
                  </p>
                </div>
              )}
            </div>

            {/* Contacts */}
            <div className="lg:col-span-2">
              <h4 className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-wider">
                Contacts
              </h4>
              {co.topContacts.length > 0 ? (
                <div className="space-y-2">
                  {co.topContacts.map((c) => (
                    <ContactRow
                      key={c.personId}
                      contact={c}
                      companyName={co.name}
                      msg={messages.get(c.personId)}
                      isGenerating={generatingFor === c.personId}
                      isCopied={copiedId === c.personId}
                      onGenerate={() => onGenerate(c)}
                      onCopy={() => onCopy(c.personId)}
                    />
                  ))}
                </div>
              ) : (
                <div className="border-border rounded-md border border-dashed p-4 text-center">
                  <p className="text-muted-foreground text-xs">
                    No contacts yet.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 text-xs"
                    onClick={() =>
                      openAgentWith(
                        `Find contacts at "${co.name}" matching ${icpLabel} target titles.`,
                      )
                    }
                  >
                    <Users className="mr-1 h-3 w-3" />
                    Find Contacts
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
