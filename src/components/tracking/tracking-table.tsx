"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { ReadinessBadge } from "./readiness-badge";
import { TrackingTimeline } from "./tracking-timeline";
import { createClient } from "@/lib/supabase/client";
import type { TrackingChange, ReadinessTag } from "@/lib/types/tracking";

export type ViewMode = "by-signal" | "by-company";

export interface TrackingRow {
  id: string;
  organizationName: string;
  organizationDomain: string | null;
  signalName: string;
  signalCategory: string;
  schedule: string;
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  readinessTag: ReadinessTag | null;
  latestChangeDescription: string | null;
  latestChangeDate: string | null;
}

export interface CompanyGroup {
  organizationName: string;
  organizationDomain: string | null;
  readinessTag: ReadinessTag | null;
  activeSignals: number;
  lastRunAt: string | null;
  latestChangeDescription: string | null;
  rows: TrackingRow[];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "--";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function ExpandableSignalRow({ row }: { row: TrackingRow }) {
  const [expanded, setExpanded] = useState(false);
  const [changes, setChanges] = useState<TrackingChange[]>([]);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [localStatus, setLocalStatus] = useState(row.status);

  const toggleExpand = async () => {
    if (!expanded && changes.length === 0) {
      setLoadingChanges(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("tracking_changes")
        .select("*")
        .eq("tracking_config_id", row.id)
        .order("detected_at", { ascending: false })
        .limit(20);
      setChanges((data as TrackingChange[]) ?? []);
      setLoadingChanges(false);
    }
    setExpanded(!expanded);
  };

  const togglePause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = localStatus === "active" ? "paused" : "active";
    setLocalStatus(newStatus);
    const supabase = createClient();
    const { error } = await supabase
      .from("tracking_configs")
      .update({ status: newStatus })
      .eq("id", row.id);
    if (error) {
      toast.error("Failed to update tracking status");
      setLocalStatus(localStatus); // revert on failure
    } else {
      toast.success(
        newStatus === "paused" ? "Tracking paused" : "Tracking resumed",
      );
    }
  };

  return (
    <>
      <tr
        className="hover:bg-muted/50 cursor-pointer border-b transition-colors"
        onClick={toggleExpand}
      >
        <td className="w-8 px-3 py-2.5">
          {expanded ? (
            <ChevronDown className="text-muted-foreground size-4" />
          ) : (
            <ChevronRight className="text-muted-foreground size-4" />
          )}
        </td>
        <td className="px-3 py-2.5 text-sm font-medium">
          {row.organizationName}
        </td>
        <td className="px-3 py-2.5 text-sm">{row.signalName}</td>
        <td className="text-muted-foreground px-3 py-2.5 text-sm capitalize">
          {row.schedule}
          {localStatus === "paused" ? " (paused)" : ""}
        </td>
        <td className="text-muted-foreground px-3 py-2.5 text-sm">
          {formatDate(row.lastRunAt)}
        </td>
        <td className="px-3 py-2.5 text-sm">
          {row.latestChangeDescription || (
            <span className="text-muted-foreground">No changes</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <ReadinessBadge tag={row.readinessTag} />
        </td>
        <td className="px-3 py-2.5">
          <button
            type="button"
            onClick={togglePause}
            className="text-muted-foreground hover:text-foreground p-1 transition-colors"
            title={
              localStatus === "active" ? "Pause tracking" : "Resume tracking"
            }
          >
            {localStatus === "active" ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-muted/30 border-b px-6 py-3">
            {loadingChanges ? (
              <p className="text-muted-foreground text-xs">Loading...</p>
            ) : (
              <TrackingTimeline changes={changes} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandableCompanyRow({ group }: { group: CompanyGroup }) {
  const [expanded, setExpanded] = useState(false);
  const [changesByConfig, setChangesByConfig] = useState<
    Record<string, TrackingChange[]>
  >({});
  const [loadingChanges, setLoadingChanges] = useState(false);

  const toggleExpand = async () => {
    if (!expanded && Object.keys(changesByConfig).length === 0) {
      setLoadingChanges(true);
      const supabase = createClient();
      const configIds = group.rows.map((r) => r.id);
      const { data } = await supabase
        .from("tracking_changes")
        .select("*")
        .in("tracking_config_id", configIds)
        .order("detected_at", { ascending: false })
        .limit(50);

      const grouped: Record<string, TrackingChange[]> = {};
      for (const change of (data as TrackingChange[]) ?? []) {
        const cid = change.tracking_config_id;
        if (!grouped[cid]) grouped[cid] = [];
        grouped[cid].push(change);
      }
      setChangesByConfig(grouped);
      setLoadingChanges(false);
    }
    setExpanded(!expanded);
  };

  return (
    <>
      <tr
        className="hover:bg-muted/50 cursor-pointer border-b transition-colors"
        onClick={toggleExpand}
      >
        <td className="w-8 px-3 py-2.5">
          {expanded ? (
            <ChevronDown className="text-muted-foreground size-4" />
          ) : (
            <ChevronRight className="text-muted-foreground size-4" />
          )}
        </td>
        <td className="px-3 py-2.5 text-sm font-medium">
          {group.organizationName}
        </td>
        <td className="px-3 py-2.5 text-sm">{group.activeSignals} active</td>
        <td className="text-muted-foreground px-3 py-2.5 text-sm">
          {formatDate(group.lastRunAt)}
        </td>
        <td className="px-3 py-2.5 text-sm" colSpan={2}>
          {group.latestChangeDescription || (
            <span className="text-muted-foreground">No changes</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <ReadinessBadge tag={group.readinessTag} />
        </td>
        <td />
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-muted/30 border-b px-6 py-3">
            {loadingChanges ? (
              <p className="text-muted-foreground text-xs">Loading...</p>
            ) : (
              <div className="space-y-3">
                {group.rows.map((row) => (
                  <div key={row.id}>
                    <p className="text-xs font-medium">{row.signalName}</p>
                    <TrackingTimeline changes={changesByConfig[row.id] ?? []} />
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function TrackingTable({
  rows,
  viewMode,
}: {
  rows: TrackingRow[];
  viewMode: ViewMode;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        No tracking configs found. Set up tracking in Chat to start monitoring
        companies.
      </p>
    );
  }

  if (viewMode === "by-company") {
    // Group rows by organization
    const groupMap = new Map<string, CompanyGroup>();
    for (const row of rows) {
      const key = row.organizationDomain || row.organizationName;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          organizationName: row.organizationName,
          organizationDomain: row.organizationDomain,
          readinessTag: row.readinessTag,
          activeSignals: 0,
          lastRunAt: null,
          latestChangeDescription: null,
          rows: [],
        });
      }
      const group = groupMap.get(key)!;
      group.rows.push(row);
      if (row.status === "active") group.activeSignals++;
      // Use most recent run/change
      if (
        !group.lastRunAt ||
        (row.lastRunAt && row.lastRunAt > group.lastRunAt)
      ) {
        group.lastRunAt = row.lastRunAt;
      }
      if (
        row.latestChangeDate &&
        (!group.latestChangeDescription ||
          (group.latestChangeDescription &&
            row.latestChangeDate > (group.lastRunAt ?? "")))
      ) {
        group.latestChangeDescription = row.latestChangeDescription;
      }
      // Promote readiness: ready > monitoring > not_ready
      if (row.readinessTag === "ready_to_contact") {
        group.readinessTag = "ready_to_contact";
      } else if (
        row.readinessTag === "monitoring" &&
        group.readinessTag !== "ready_to_contact"
      ) {
        group.readinessTag = "monitoring";
      }
    }

    const groups = Array.from(groupMap.values());

    return (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2 text-xs font-medium">Company</th>
              <th className="px-3 py-2 text-xs font-medium">Signals</th>
              <th className="px-3 py-2 text-xs font-medium">Last Check</th>
              <th className="px-3 py-2 text-xs font-medium" colSpan={2}>
                Latest Changes
              </th>
              <th className="px-3 py-2 text-xs font-medium">Status</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <ExpandableCompanyRow
                key={group.organizationName}
                group={group}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // By signal (default)
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="w-8 px-3 py-2" />
            <th className="px-3 py-2 text-xs font-medium">Company</th>
            <th className="px-3 py-2 text-xs font-medium">Signal</th>
            <th className="px-3 py-2 text-xs font-medium">Every</th>
            <th className="px-3 py-2 text-xs font-medium">Last Check</th>
            <th className="px-3 py-2 text-xs font-medium">Changes</th>
            <th className="px-3 py-2 text-xs font-medium">Status</th>
            <th className="w-10 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ExpandableSignalRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
