"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { TogglePill } from "@/components/ui/toggle-pill";
import {
  TrackingTable,
  type TrackingRow,
  type ViewMode,
} from "@/components/tracking/tracking-table";
import { ReadinessBadge } from "@/components/tracking/readiness-badge";
import { createClient } from "@/lib/supabase/client";
import type { Campaign } from "@/lib/types/campaign";

export default function TrackingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 p-4 md:p-6">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          <span className="text-muted-foreground text-sm">Loading...</span>
        </div>
      }
    >
      <TrackingPageContent />
    </Suspense>
  );
}

function TrackingPageContent() {
  const searchParams = useSearchParams();
  const initialCampaignId = searchParams.get("campaign");

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(
    initialCampaignId ?? "",
  );
  const [rows, setRows] = useState<TrackingRow[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("by-signal");
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchCampaigns = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("campaigns")
      .select("id, name, status")
      .order("updated_at", { ascending: false });
    if (!mountedRef.current) return;
    setCampaigns((data as Campaign[]) ?? []);
    setLoading(false);
  }, []);

  const fetchTrackingData = useCallback(async (campaignId: string) => {
    if (!campaignId) {
      setRows([]);
      return;
    }

    const supabase = createClient();

    // Fetch tracking configs with joins -- include organization_id directly
    const { data: configs } = await supabase
      .from("tracking_configs")
      .select(
        "id, organization_id, schedule, status, last_run_at, next_run_at, organization:organizations(name, domain), signal:signals(name, category)",
      )
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false });

    if (!mountedRef.current || !configs) {
      setRows([]);
      return;
    }

    // Build org ID map from configs directly
    const configOrgMap = new Map<string, string>();
    for (const c of configs) {
      const conf = c as Record<string, unknown>;
      if (conf.organization_id) {
        configOrgMap.set(conf.id as string, conf.organization_id as string);
      }
    }

    // Fetch readiness tags from campaign_organizations
    const uniqueOrgIds = [...new Set(configOrgMap.values())];
    const { data: orgLinks } = await supabase
      .from("campaign_organizations")
      .select("organization_id, readiness_tag")
      .eq("campaign_id", campaignId)
      .in(
        "organization_id",
        uniqueOrgIds.length > 0 ? uniqueOrgIds : ["__none__"],
      );

    const readinessMap = new Map<string, string>();
    for (const link of orgLinks ?? []) {
      readinessMap.set(
        link.organization_id as string,
        (link.readiness_tag as string) || "",
      );
    }

    // Fetch latest changes per config
    const configIds = configs.map(
      (c: Record<string, unknown>) => c.id as string,
    );
    const { data: latestChanges } = await supabase
      .from("tracking_changes")
      .select("tracking_config_id, description, detected_at")
      .in("tracking_config_id", configIds.length > 0 ? configIds : ["__none__"])
      .order("detected_at", { ascending: false });

    const changeMap = new Map<
      string,
      { description: string; detected_at: string }
    >();
    for (const change of latestChanges ?? []) {
      const cid = change.tracking_config_id as string;
      if (!changeMap.has(cid)) {
        changeMap.set(cid, {
          description: change.description as string,
          detected_at: change.detected_at as string,
        });
      }
    }

    if (!mountedRef.current) return;

    const mappedRows: TrackingRow[] = configs.map(
      (c: Record<string, unknown>) => {
        const org = c.organization as Record<string, unknown> | null;
        const signal = c.signal as Record<string, unknown> | null;
        const orgId = configOrgMap.get(c.id as string);
        const change = changeMap.get(c.id as string);
        const tag = orgId ? readinessMap.get(orgId) : null;

        return {
          id: c.id as string,
          organizationName: (org?.name as string) || "Unknown",
          organizationDomain: (org?.domain as string) || null,
          signalName: (signal?.name as string) || "Unknown Signal",
          signalCategory: (signal?.category as string) || "",
          schedule: c.schedule as string,
          status: c.status as string,
          lastRunAt: c.last_run_at as string | null,
          nextRunAt: c.next_run_at as string | null,
          readinessTag: (tag as TrackingRow["readinessTag"]) || null,
          latestChangeDescription: change?.description || null,
          latestChangeDate: change?.detected_at || null,
        };
      },
    );

    setRows(mappedRows);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchCampaigns();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchTrackingData(selectedCampaignId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId]);

  // Count unique companies per readiness tag (not per config row)
  const readyCompanies = new Set(
    rows
      .filter((r) => r.readinessTag === "ready_to_contact")
      .map((r) => r.organizationDomain || r.organizationName),
  );
  const monitoringCompanies = new Set(
    rows
      .filter((r) => r.readinessTag === "monitoring")
      .map((r) => r.organizationDomain || r.organizationName),
  );
  const readyCount = readyCompanies.size;
  const monitoringCount = monitoringCompanies.size;

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-4 md:p-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tracking</h1>
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tracking</h1>
          <p className="text-muted-foreground text-sm">
            Monitor companies over time. Signals run on schedule and flag
            entities when thresholds are met.
          </p>
        </div>

        {/* Campaign selector + stats */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full max-w-xs">
            <label
              htmlFor="campaign-select"
              className="text-muted-foreground mb-1 block text-xs font-medium"
            >
              Campaign
            </label>
            <Select
              id="campaign-select"
              value={selectedCampaignId}
              onValueChange={setSelectedCampaignId}
              placeholder="Select a campaign"
              items={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>

          {selectedCampaignId && rows.length > 0 && (
            <ul className="flex gap-3" aria-label="Readiness counts">
              <li className="flex items-center gap-1.5">
                <ReadinessBadge tag="ready_to_contact" />
                <span className="text-muted-foreground text-xs tabular-nums">
                  {readyCount}
                </span>
              </li>
              <li className="flex items-center gap-1.5">
                <ReadinessBadge tag="monitoring" />
                <span className="text-muted-foreground text-xs tabular-nums">
                  {monitoringCount}
                </span>
              </li>
            </ul>
          )}
        </div>

        <Separator />

        {/* View toggle */}
        {selectedCampaignId && rows.length > 0 && (
          <div className="flex gap-1.5">
            <TogglePill
              active={viewMode === "by-signal"}
              onClick={() => setViewMode("by-signal")}
            >
              By Signal
            </TogglePill>
            <TogglePill
              active={viewMode === "by-company"}
              onClick={() => setViewMode("by-company")}
            >
              By Company
            </TogglePill>
          </div>
        )}

        {/* Table */}
        {!selectedCampaignId ? (
          <p className="text-muted-foreground py-12 text-center text-sm">
            Select a campaign to view tracked entities.
          </p>
        ) : rows.length === 0 ? (
          <div className="border-border flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
            <p className="text-sm font-medium">
              No tracking configured for this campaign
            </p>
            <p className="text-muted-foreground text-xs">
              Enable a signal on a company to start tracking it over time.
            </p>
          </div>
        ) : (
          <TrackingTable rows={rows} viewMode={viewMode} />
        )}
      </div>
    </div>
  );
}
