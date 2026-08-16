"use client";

import { Fragment, useState } from "react";
import { ChevronRight, Mail } from "lucide-react";

import { ActivityDetail } from "@/components/outreach/activity-detail";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { RelativeTime } from "@/components/ui/relative-time";
import { TogglePill } from "@/components/ui/toggle-pill";
import { cn } from "@/lib/utils";
import { filterActivity, type ActivityItem } from "@/lib/outreach/activity";
import type { OutreachStatus } from "@/lib/outreach/status";

/**
 * Everything that has happened to your mail: what went out, what came back,
 * and what did not send.
 *
 * Rows are master-detail on the pattern established by
 * components/campaign/contacts-table.tsx: a Fragment per row, a Set of
 * expanded ids, aria-expanded on the trigger and the detail in a full-width
 * cell. That structure is already keyboard-accessible, so this inherits it.
 */

const FILTERS = [
  { key: "all", label: "All" },
  { key: "replied", label: "Replied" },
  { key: "sent", label: "Sent" },
  { key: "pending", label: "Waiting" },
  { key: "failed", label: "Needs attention" },
  { key: "bounced", label: "Bounced" },
] as const;

export type ActivityFilter = (typeof FILTERS)[number]["key"];

interface Props {
  items: ActivityItem[];
  filter: ActivityFilter;
  onFilterChange: (f: ActivityFilter) => void;
  loading?: boolean;
}

export function OutreachActivityPanel({
  items,
  filter,
  onFilterChange,
  loading,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The full set arrives from the page so the tab's reply count stays stable
  // across chip clicks; narrowing happens here, with the same map the API
  // uses server-side.
  const shown = filterActivity(items, filter);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <TogglePill
            key={f.key}
            active={filter === f.key}
            onClick={() => onFilterChange(f.key)}
          >
            {f.label}
          </TogglePill>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={loading ? "Loading..." : "Nothing here yet"}
          description={
            loading
              ? "Fetching your outbound mail."
              : filter === "all"
                ? "Once the agent sends an email it shows up here, along with anything that comes back."
                : "No mail in this state right now."
          }
        />
      ) : (
        <div className="border-border overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <tbody>
              {shown.map((item) => {
                const isOpen = expanded.has(item.id);
                return (
                  <Fragment key={item.id}>
                    <tr
                      className={cn(
                        "border-border hover:bg-muted/40 cursor-pointer border-b transition-colors",
                        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                      )}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => toggle(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(item.id);
                        }
                      }}
                    >
                      <td className="w-6 py-2 pl-3">
                        <ChevronRight
                          className={cn(
                            "text-muted-foreground h-3.5 w-3.5 transition-transform",
                            isOpen && "rotate-90",
                          )}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium">
                            {item.person_name ?? item.to_email}
                          </span>
                          {item.company_name && (
                            <span className="text-muted-foreground text-xs">
                              {item.company_name}
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {item.subject}
                        </div>
                        {item.campaign_name && (
                          <div className="text-muted-foreground/80 truncate text-[11px]">
                            {item.campaign_name}
                          </div>
                        )}
                        {/* The reply, visible without opening anything and
                            without filtering. Replies being findable is the
                            entire point of this surface. */}
                        {item.state === "replied" &&
                          (item.reply_snippet ? (
                            <div className="text-foreground/80 mt-0.5 truncate text-xs">
                              {item.reply_snippet}
                            </div>
                          ) : (
                            <div className="text-muted-foreground mt-0.5 text-xs italic">
                              Replied, content not captured
                            </div>
                          ))}
                        {item.error && item.state !== "deferred" && (
                          <div className="text-destructive/90 mt-0.5 truncate text-xs">
                            {item.error.message}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        <StatusPill status={item.state as OutreachStatus} />
                      </td>
                      <td className="text-muted-foreground py-2 pr-3 text-right text-xs whitespace-nowrap">
                        <RelativeTime iso={item.at} />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-border bg-muted/20 border-b">
                        <td colSpan={4}>
                          <ActivityDetail id={item.id} error={item.error} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
