"use client";

import { useCallback, useEffect, useState } from "react";

import { StatCards } from "@/components/dashboard/stat-cards";
import { OutreachChart } from "@/components/dashboard/outreach-chart";
import { CampaignTable } from "@/components/dashboard/campaign-table";
import {
  ListRowsSkeleton,
  PageHeaderSkeleton,
  StatsRowSkeleton,
} from "@/components/ui/skeleton-presets";

interface DashboardData {
  totals: {
    leads: number;
    sent: number;
    opened: number;
    replied: number;
    bounced: number;
  };
  timeSeries: Array<{
    date: string;
    sent: number;
    opened: number;
    replied: number;
    bounced: number;
  }>;
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    leads: number;
    sent: number;
    opened: number;
    openRate: number;
    replied: number;
    replyRate: number;
  }>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [range, setRange] = useState("30d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (r: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard?range=${r}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[dashboard] Failed to fetch:", err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData(range);
  }, [range, fetchData]);

  const handleRangeChange = (newRange: string) => {
    setRange(newRange);
  };

  if (loading && !data) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-4 md:p-6">
          <PageHeaderSkeleton />
          <StatsRowSkeleton count={4} />
          <div className="bg-muted/40 h-64 animate-pulse rounded-lg" />
          <ListRowsSkeleton count={3} />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <p className="text-muted-foreground text-sm">
            {error
              ? `Failed to load dashboard: ${error}`
              : "Failed to load dashboard"}
          </p>
          <button
            type="button"
            onClick={() => fetchData(range)}
            className="bg-foreground/10 hover:bg-foreground/15 rounded-md px-3 py-1.5 text-xs font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground text-sm">
            Cross-campaign performance at a glance.
          </p>
        </div>

        <StatCards totals={data.totals} />

        <OutreachChart
          timeSeries={data.timeSeries}
          range={range}
          onRangeChange={handleRangeChange}
        />

        <div>
          <h2 className="mb-3 text-lg font-semibold">Campaigns</h2>
          <CampaignTable campaigns={data.campaigns} />
        </div>
      </div>
    </div>
  );
}
