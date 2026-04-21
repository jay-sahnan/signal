"use client";

import { useEffect, useRef, useState } from "react";

import { SettingsSection } from "@/components/settings/settings-section";

type Period = "24h" | "7d" | "30d" | "all";

interface ServiceBreakdown {
  service: string;
  cost: number;
  calls: number;
  tokens_input: number;
  tokens_output: number;
}

interface OperationBreakdown {
  service: string;
  operation: string;
  cost: number;
  calls: number;
  tokens_input: number;
  tokens_output: number;
}

interface RecentEntry {
  id: string;
  service: string;
  operation: string;
  tokens_input: number | null;
  tokens_output: number | null;
  estimated_cost_usd: number;
  metadata: Record<string, unknown>;
  campaign_id: string | null;
  created_at: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

interface RealSpend {
  claude: number | null;
  apify: number | null;
  exa: number | null;
  browserbase: number | null;
}

interface CostData {
  period: string;
  totalCost: number;
  byService: ServiceBreakdown[];
  byOperation: OperationBreakdown[];
  recent: RecentEntry[];
  recentPagination: Pagination;
  realSpend: RealSpend;
}

const PERIOD_LABELS: Record<Period, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  all: "All time",
};

const REAL_SPEND_KEY: Record<string, keyof RealSpend> = {
  claude: "claude",
  apify: "apify",
  exa: "exa",
  browserbase: "browserbase",
};

// Tooltip text shown when a provider's real-spend fetcher returns null.
// Covers both "missing key" and "upstream API failed" — we surface the same
// message because the outcome for the user is identical (fall back to est).
const REAL_SPEND_FALLBACK_HINT: Record<keyof RealSpend, string> = {
  claude:
    "Real billed spend unavailable. Set ANTHROPIC_ADMIN_KEY in .env.local to enable.",
  apify:
    "Real billed spend unavailable. Set APIFY_API_TOKEN in .env.local to enable.",
  exa: "Real billed spend unavailable. Set EXA_SERVICE_API_KEY and EXA_API_KEY_ID in .env.local to enable.",
  browserbase:
    "Real billed spend unavailable. Check BROWSERBASE_API_KEY and Browserbase API connectivity.",
};

const SERVICE_LABELS: Record<string, string> = {
  claude: "Claude AI",
  exa: "Exa Search",
  apify: "Apify",
  browserbase: "Browserbase",
  google: "Google Places",
  agentmail: "AgentMail",
};

const OP_LABELS: Record<string, string> = {
  chat: "Chat",
  search: "Search",
  "scrape-linkedin": "LinkedIn Scrape",
  "scrape-twitter": "Twitter Scrape",
  fetch: "Web Fetch",
  "browser-session": "Browser Session",
  "relevance-filter": "Relevance Filter",
  "score-contacts": "Score Contacts",
  "find-email": "Find Email",
  "send-email": "Send Email",
  "google-reviews": "Google Reviews",
};

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n === 0) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

const PAGE_SIZE = 20;

export function CostCenter() {
  const [period, setPeriod] = useState<Period>("30d");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // Append the refresh nonce as a cache-buster on manual refresh so the
    // browser doesn't serve a stale response from the fetch cache.
    const url =
      `/api/settings/costs?period=${period}&page=${page}&pageSize=${PAGE_SIZE}` +
      (refreshNonce > 0 ? `&_=${refreshNonce}` : "");
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (mountedRef.current) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [period, page, refreshNonce]);

  // Reset to page 1 when period changes
  const handlePeriodChange = (p: Period) => {
    setPage(1);
    setPeriod(p);
  };

  const handleRefresh = () => {
    setRefreshNonce(Date.now());
  };

  const actions = (
    <>
      <div className="flex gap-1">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => handlePeriodChange(p)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              period === p
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p === "all" ? "All" : p}
          </button>
        ))}
      </div>
      <button
        onClick={handleRefresh}
        disabled={loading}
        title="Re-fetch estimates and billed spend from provider APIs"
        className="text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
      >
        {loading ? "Refreshing…" : "Refresh"}
      </button>
    </>
  );

  return (
    <SettingsSection title="Usage" actions={actions}>
      {loading ? (
        <p className="text-muted-foreground text-sm">Loading cost data...</p>
      ) : !data || (data.totalCost === 0 && data.byService.length === 0) ? (
        <p className="text-muted-foreground text-sm">
          No API usage recorded yet. Costs will appear here as you use chat,
          enrichment, and search features.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Total spend */}
          {(() => {
            // For each service that has a real value, substitute it for the
            // estimated value in the aggregate total. Services without a real
            // value (null — missing key or upstream error) keep their estimate.
            let adjustedTotal = data.totalCost;
            for (const s of data.byService) {
              const realKey = REAL_SPEND_KEY[s.service];
              if (!realKey) continue;
              const realVal = data.realSpend?.[realKey];
              if (realVal == null) continue;
              adjustedTotal = adjustedTotal - s.cost + realVal;
            }
            const anyEstimate = data.byService.some((s) => {
              const realKey = REAL_SPEND_KEY[s.service];
              if (!realKey) return s.cost > 0;
              return data.realSpend?.[realKey] == null;
            });
            return (
              <div className="border-border rounded-lg border px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tabular-nums">
                    {formatCost(adjustedTotal)}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    total spend ({PERIOD_LABELS[period]})
                  </span>
                  {anyEstimate && (
                    <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                      partly est
                    </span>
                  )}
                </div>
              </div>
            );
          })()}

          {/* By service breakdown */}
          {data.byService.length > 0 && (
            <div className="border-border overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border bg-muted/50 border-b">
                    <th className="px-4 py-2.5 text-left font-medium">
                      Service
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Calls
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Tokens In
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Tokens Out
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byService.map((s) => {
                    const realKey = REAL_SPEND_KEY[s.service];
                    const realValue = realKey
                      ? data.realSpend?.[realKey]
                      : null;
                    const isReal = realValue != null;
                    const displayCost = isReal ? realValue : s.cost;
                    return (
                      <tr
                        key={s.service}
                        className="border-border border-b last:border-b-0"
                      >
                        <td className="px-4 py-2.5 font-medium">
                          {SERVICE_LABELS[s.service] ?? s.service}
                        </td>
                        <td className="text-muted-foreground px-4 py-2.5 text-right tabular-nums">
                          {s.calls.toLocaleString()}
                        </td>
                        <td className="text-muted-foreground px-4 py-2.5 text-right tabular-nums">
                          {formatTokens(s.tokens_input)}
                        </td>
                        <td className="text-muted-foreground px-4 py-2.5 text-right tabular-nums">
                          {formatTokens(s.tokens_output)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                          <span className="inline-flex items-center gap-1.5">
                            {formatCost(displayCost)}
                            {!isReal && (
                              <span
                                title={
                                  realKey
                                    ? REAL_SPEND_FALLBACK_HINT[realKey]
                                    : "Estimated from local tracking -- no billing API integration for this provider."
                                }
                                className="rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
                              >
                                est
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* By operation breakdown */}
          {data.byOperation.length > 0 && (
            <div className="border-border overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border bg-muted/50 border-b">
                    <th className="px-4 py-2.5 text-left font-medium">
                      Operation
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Service
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Calls
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Tokens
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byOperation.map((op) => (
                    <tr
                      key={`${op.service}/${op.operation}`}
                      className="border-border border-b last:border-b-0"
                    >
                      <td className="px-4 py-2.5 font-medium">
                        {OP_LABELS[op.operation] ?? op.operation}
                      </td>
                      <td className="text-muted-foreground px-4 py-2.5">
                        {SERVICE_LABELS[op.service] ?? op.service}
                      </td>
                      <td className="text-muted-foreground px-4 py-2.5 text-right tabular-nums">
                        {op.calls.toLocaleString()}
                      </td>
                      <td className="text-muted-foreground px-4 py-2.5 text-right tabular-nums">
                        {op.tokens_input + op.tokens_output > 0
                          ? `${formatTokens(op.tokens_input)} / ${formatTokens(op.tokens_output)}`
                          : "-"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {formatCost(op.cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent usage log */}
          {(data.recent.length > 0 || data.recentPagination.totalRows > 0) && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Recent API Calls
                </h3>
                {data.recentPagination.totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="text-muted-foreground hover:text-foreground text-xs disabled:opacity-30"
                    >
                      Prev
                    </button>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {page} / {data.recentPagination.totalPages}
                    </span>
                    <button
                      onClick={() =>
                        setPage((p) =>
                          Math.min(data!.recentPagination.totalPages, p + 1),
                        )
                      }
                      disabled={page >= data.recentPagination.totalPages}
                      className="text-muted-foreground hover:text-foreground text-xs disabled:opacity-30"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
              <div className="border-border overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-border bg-muted/50 border-b">
                      <th className="px-4 py-2 text-left font-medium">When</th>
                      <th className="px-4 py-2 text-left font-medium">
                        Service
                      </th>
                      <th className="px-4 py-2 text-left font-medium">
                        Operation
                      </th>
                      <th className="px-4 py-2 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-border border-b last:border-b-0"
                      >
                        <td className="text-muted-foreground whitespace-nowrap px-4 py-2">
                          {formatTime(entry.created_at)}
                        </td>
                        <td className="px-4 py-2">
                          {SERVICE_LABELS[entry.service] ?? entry.service}
                        </td>
                        <td className="px-4 py-2">
                          <span>
                            {OP_LABELS[entry.operation] ?? entry.operation}
                          </span>
                          {entry.tokens_input != null &&
                            entry.tokens_input > 0 && (
                              <span className="text-muted-foreground ml-1.5 text-xs">
                                {formatTokens(entry.tokens_input)} /{" "}
                                {formatTokens(entry.tokens_output ?? 0)} tok
                              </span>
                            )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                          {formatCost(Number(entry.estimated_cost_usd))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.recentPagination.totalRows > 0 && (
                <p className="text-muted-foreground mt-1.5 text-right text-xs tabular-nums">
                  {data.recentPagination.totalRows.toLocaleString()} total calls
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
