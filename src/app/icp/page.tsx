"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCampaign } from "@/lib/campaign-context";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PRESETS = [
  {
    slug: "qa",
    label: "QA",
    description: "Manual QA processes needing AI conversation coverage",
    color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  },
  {
    slug: "complaints",
    label: "Complaints",
    description: "Failing to detect and capture customer complaints",
    color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  },
  {
    slug: "sales-compliance",
    label: "Sales Compliance",
    description: "Unmonitored sales conversations violating regulations",
    color:
      "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  },
] as const;

const TABS = [
  { slug: "add", label: "Add Companies" },
  { slug: "targets", label: "Target List" },
  { slug: "define", label: "ICP Definitions" },
] as const;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AddedCompany {
  name: string;
  preset: string;
  status: "adding" | "added" | "error";
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ICPPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 p-6">
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      }
    >
      <ICPPageContent />
    </Suspense>
  );
}

function ICPPageContent() {
  const { openAgentWith } = useCampaign();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "add";

  const [selectedPreset, setSelectedPreset] = useState<string>("qa");
  const [companyName, setCompanyName] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<AddedCompany[]>([]);

  // ICP definition state
  const [defPreset, setDefPreset] = useState<string>("qa");
  const [defContent, setDefContent] = useState("");
  const [defLoading, setDefLoading] = useState(false);
  const [defSaving, setDefSaving] = useState(false);
  const [defLastSaved, setDefLastSaved] = useState<string | null>(null);

  // Load ICP definition when preset changes
  useEffect(() => {
    if (activeTab !== "define") return;
    setDefLoading(true);
    setDefError(null);
    fetch(`/api/targeting?slug=${defPreset}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setDefContent(data.content ?? ""))
      .catch(() => {
        setDefContent("");
        setDefError("Could not load definition.");
      })
      .finally(() => setDefLoading(false));
  }, [defPreset, activeTab]);

  const handleAdd = async () => {
    const name = companyName.trim();
    if (!name) return;
    setAdding(true);
    const entry: AddedCompany = {
      name,
      preset: selectedPreset,
      status: "adding",
    };
    setAdded((prev) => [entry, ...prev]);
    setCompanyName("");

    try {
      const campaignRes = await fetch("/api/icp/ensure-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetSlug: selectedPreset }),
      });
      if (!campaignRes.ok) throw new Error((await campaignRes.json()).error);
      const { campaignId } = await campaignRes.json();

      const importRes = await fetch("/api/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, companies: [{ name }] }),
      });
      if (!importRes.ok) throw new Error((await importRes.json()).error);
      const result = await importRes.json();

      setAdded((prev) =>
        prev.map((c) =>
          c.name === name && c.status === "adding"
            ? {
                ...c,
                status: "added" as const,
                error: result.skipped > 0 ? "Already exists" : undefined,
              }
            : c,
        ),
      );
    } catch (err) {
      setAdded((prev) =>
        prev.map((c) =>
          c.name === name && c.status === "adding"
            ? {
                ...c,
                status: "error" as const,
                error: err instanceof Error ? err.message : "Failed",
              }
            : c,
        ),
      );
    } finally {
      setAdding(false);
    }
  };

  const [defError, setDefError] = useState<string | null>(null);

  const handleSaveDefinition = async () => {
    setDefSaving(true);
    setDefError(null);
    try {
      const res = await fetch("/api/targeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: defPreset, content: defContent }),
      });
      if (res.ok) {
        setDefLastSaved(new Date().toLocaleTimeString());
      } else {
        setDefError("Failed to save. Try again.");
      }
    } catch {
      setDefError("Network error. Check your connection.");
    } finally {
      setDefSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ICP</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Manage your ideal customer profiles and add target companies.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="bg-muted inline-flex items-center gap-1 rounded-lg p-1">
          {TABS.map((tab) => (
            <button
              key={tab.slug}
              onClick={() => router.push(`/icp?tab=${tab.slug}`)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-all",
                activeTab === tab.slug
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ─── Add Companies Tab ─── */}
        {activeTab === "add" && (
          <div className="space-y-5">
            {/* Preset selector */}
            <div className="grid gap-2 sm:grid-cols-3">
              {PRESETS.map((preset) => (
                <button
                  key={preset.slug}
                  onClick={() => setSelectedPreset(preset.slug)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-all",
                    selectedPreset === preset.slug
                      ? "border-primary bg-primary/5 ring-primary ring-1"
                      : "border-border hover:border-foreground/20 hover:bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs font-semibold",
                      preset.color,
                    )}
                  >
                    {preset.label}
                  </span>
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    {preset.description}
                  </p>
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && companyName.trim() && !adding)
                      handleAdd();
                  }}
                  placeholder="Company name..."
                  className="border-border bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2"
                  autoFocus
                />
              </div>
              <Button
                onClick={handleAdd}
                disabled={!companyName.trim() || adding}
              >
                {adding ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-4 w-4" />
                )}
                Add
              </Button>
            </div>

            {/* Added list */}
            {added.length > 0 && (
              <div className="divide-border divide-y rounded-lg border">
                {added.map((entry, idx) => {
                  const preset = PRESETS.find((p) => p.slug === entry.preset);
                  return (
                    <div
                      key={`${entry.name}-${idx}`}
                      className="space-y-2 px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <Building2 className="text-muted-foreground h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {entry.name}
                            </span>
                            {preset && (
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                                  preset.color,
                                )}
                              >
                                {preset.label}
                              </span>
                            )}
                          </div>
                          {entry.error && (
                            <p className="text-muted-foreground mt-0.5 text-xs">
                              {entry.error}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {entry.status === "adding" && (
                            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
                          )}
                          {entry.status === "added" && (
                            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                          )}
                          {entry.status === "error" && (
                            <span className="text-xs text-red-600">Failed</span>
                          )}
                          <button
                            onClick={() =>
                              setAdded((prev) =>
                                prev.filter((_, i) => i !== idx),
                              )
                            }
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {entry.status === "added" && (
                        <div className="flex items-center gap-2 pl-7">
                          <Button
                            size="sm"
                            className="text-xs"
                            onClick={() =>
                              openAgentWith(
                                `Enrich "${entry.name}": scrape website, find hiring data, gather news. Run all signals for ${preset?.label ?? ""} ICP. Find contacts matching target titles, enrich LinkedIn. Score and suggest outreach approach.`,
                              )
                            }
                          >
                            <Sparkles className="mr-1 h-3 w-3" />
                            Enrich & Score
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs"
                            onClick={() => router.push(`/?icp=${entry.preset}`)}
                          >
                            View in Feed
                            <ArrowRight className="ml-1 h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Target List Tab ─── */}
        {activeTab === "targets" && (
          <TargetListTab openAgentWith={openAgentWith} />
        )}

        {/* ─── ICP Definitions Tab ─── */}
        {activeTab === "define" && (
          <div className="space-y-4">
            {/* Preset selector */}
            <div className="bg-muted inline-flex items-center gap-1 rounded-lg p-1">
              {PRESETS.map((preset) => (
                <button
                  key={preset.slug}
                  onClick={() => setDefPreset(preset.slug)}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-sm font-medium transition-all",
                    defPreset === preset.slug
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Editor */}
            {defLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
              </div>
            ) : (
              <>
                <textarea
                  value={defContent}
                  onChange={(e) => setDefContent(e.target.value)}
                  className="border-border bg-background focus:ring-ring min-h-[500px] w-full rounded-lg border p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2"
                  spellCheck={false}
                />
                <div className="flex items-center gap-3">
                  <Button onClick={handleSaveDefinition} disabled={defSaving}>
                    {defSaving ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 h-4 w-4" />
                    )}
                    Save
                  </Button>
                  {defLastSaved && (
                    <span className="text-muted-foreground text-xs">
                      Saved at {defLastSaved}
                    </span>
                  )}
                  {defError && (
                    <span className="text-xs text-red-600">{defError}</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Target List Tab                                                    */
/* ------------------------------------------------------------------ */

interface TargetCompany {
  orgId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  enrichmentStatus: string;
  score: number | null;
  status: string;
}

function TargetListTab({
  openAgentWith,
}: {
  openAgentWith: (prompt: string) => void;
}) {
  const [preset, setPreset] = useState<string>("qa");
  const [data, setData] = useState<{
    enriched: TargetCompany[];
    pending: TargetCompany[];
    stats: { total: number; enriched: number; pending: number };
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/icp/targets?preset=${preset}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [preset]);

  const icpLabel =
    preset === "complaints"
      ? "Complaints"
      : preset === "sales-compliance"
        ? "Sales Compliance"
        : "QA";

  const handleEnrichAll = () => {
    if (!data || data.pending.length === 0) return;
    const names = data.pending
      .slice(0, 10)
      .map((c) => c.name)
      .join(", ");
    openAgentWith(
      `Enrich and score these companies for the ${icpLabel} ICP: ${names}. For each one: scrape website, find hiring data, run all signals, find contacts matching target titles, and score the company.`,
    );
  };

  return (
    <div className="space-y-4">
      {/* Preset selector */}
      <div className="bg-muted inline-flex items-center gap-1 rounded-lg p-1">
        {PRESETS.map((p) => (
          <button
            key={p.slug}
            onClick={() => setPreset(p.slug)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-all",
              preset === p.slug
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Stats */}
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="border-border rounded-lg border p-3">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
              Total
            </p>
            <p className="text-xl font-bold tabular-nums">{data.stats.total}</p>
          </div>
          <div className="border-border rounded-lg border p-3">
            <p className="text-[10px] uppercase tracking-wide text-green-600">
              Enriched
            </p>
            <p className="text-xl font-bold tabular-nums">
              {data.stats.enriched}
            </p>
          </div>
          <div className="border-border rounded-lg border p-3">
            <p className="text-[10px] uppercase tracking-wide text-amber-600">
              Pending
            </p>
            <p className="text-xl font-bold tabular-nums">
              {data.stats.pending}
            </p>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        </div>
      )}

      {/* Pending — need enrichment */}
      {data && data.pending.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Pending Enrichment ({data.pending.length})
            </h3>
            <Button size="sm" className="text-xs" onClick={handleEnrichAll}>
              <Sparkles className="mr-1 h-3 w-3" />
              Enrich Top 10
            </Button>
          </div>
          <div className="border-border divide-border max-h-[400px] divide-y overflow-y-auto rounded-lg border">
            {data.pending.map((co) => (
              <div
                key={co.orgId}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <Building2 className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">
                    {co.name}
                  </span>
                  {co.domain && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      {co.domain}
                    </span>
                  )}
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                  Pending
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() =>
                    openAgentWith(
                      `Enrich "${co.name}" (${co.domain ?? "no domain"}): scrape website, find hiring data, gather news. Run all signals for ${icpLabel} ICP. Find contacts. Score the company.`,
                    )
                  }
                >
                  <Sparkles className="mr-1 h-3 w-3" />
                  Enrich
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enriched */}
      {data && data.enriched.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            Enriched ({data.enriched.length})
          </h3>
          <div className="border-border divide-border max-h-[400px] divide-y overflow-y-auto rounded-lg border">
            {data.enriched.map((co) => (
              <div
                key={co.orgId}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <Building2 className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">
                    {co.name}
                  </span>
                  {co.domain && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      {co.domain}
                    </span>
                  )}
                </div>
                {co.score !== null && (
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-bold tabular-nums",
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
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  Ready
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && data.stats.total === 0 && (
        <div className="border-border rounded-lg border p-8 text-center">
          <p className="text-muted-foreground text-sm">
            No companies added to {icpLabel} yet. Use the Add Companies tab or
            ask the chat agent to find companies.
          </p>
        </div>
      )}
    </div>
  );
}
