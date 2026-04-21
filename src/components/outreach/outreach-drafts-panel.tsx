"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Clock, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { EditableEmail } from "@/components/ui/editable-email";
import { StatusPill } from "@/components/ui/status-pill";
import { RelativeTime } from "@/components/ui/relative-time";
import { ReviewButton } from "@/components/outreach/review-button";
import { OUTREACH_STATUS, type OutreachStatus } from "@/lib/outreach/status";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export interface DraftRow {
  id: string;
  subject: string;
  to_email: string;
  review_status: "pending" | "approved" | "rejected";
  status: string;
  person_name: string;
  person_title: string | null;
  company_name: string | null;
  sequence_id: string | null;
  sequence_name: string | null;
  next_send_at: string | null;
  step_number: number;
  total_steps: number;
  enrollment_id: string | null;
  has_inbox: boolean;
}

type GroupKey = Extract<
  OutreachStatus,
  "ready" | "needs_review" | "waiting" | "blocked" | "rejected"
>;

const GROUPS: GroupKey[] = ["needs_review", "waiting", "blocked", "rejected"];

interface ContactDraftGroup {
  key: string;
  person_name: string;
  company_name: string | null;
  sequence_id: string | null;
  total_steps: number;
  drafts: DraftRow[];
}

function groupDraftsByContact(rows: DraftRow[]): ContactDraftGroup[] {
  const map = new Map<string, ContactDraftGroup>();
  for (const draft of rows) {
    const key =
      draft.enrollment_id ??
      `${draft.sequence_id ?? "seq"}:${draft.person_name}:${draft.company_name ?? ""}`;
    const existing = map.get(key);
    if (existing) {
      existing.drafts.push(draft);
      if (draft.total_steps > existing.total_steps)
        existing.total_steps = draft.total_steps;
    } else {
      map.set(key, {
        key,
        person_name: draft.person_name,
        company_name: draft.company_name,
        sequence_id: draft.sequence_id,
        total_steps: draft.total_steps,
        drafts: [draft],
      });
    }
  }
  for (const group of map.values()) {
    group.drafts.sort((a, b) => a.step_number - b.step_number);
  }
  return Array.from(map.values());
}

export function classifyDraft(draft: DraftRow): GroupKey | null {
  if (draft.review_status === "pending") return "needs_review";
  if (draft.review_status === "rejected") return "rejected";
  if (draft.review_status === "approved" && draft.status === "draft") {
    if (!draft.has_inbox || !draft.enrollment_id) return "blocked";
    const next = draft.next_send_at ? new Date(draft.next_send_at) : null;
    if (next && next.getTime() > Date.now()) return "waiting";
    return "ready";
  }
  return null;
}

interface OutreachDraftsPanelProps {
  drafts: DraftRow[];
  onRefresh: () => void;
}

export function OutreachDraftsPanel({
  drafts,
  onRefresh,
}: OutreachDraftsPanelProps) {
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(new Set());

  const grouped = new Map<GroupKey, DraftRow[]>();
  for (const key of GROUPS) grouped.set(key, []);
  for (const d of drafts) {
    const key = classifyDraft(d);
    if (key && grouped.has(key)) grouped.get(key)!.push(d);
  }

  const visibleGroups = GROUPS.filter(
    (key) => (grouped.get(key) ?? []).length > 0,
  );

  if (visibleGroups.length === 0) return null;

  const handleEmailEdit = async (draftIds: string[], next: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("email_drafts")
      .update({ to_email: next, updated_at: new Date().toISOString() })
      .in("id", draftIds);
    if (error) throw new Error(error.message);
    onRefresh();
  };

  const handleSendNow = async (draftId: string) => {
    setSendingIds((prev) => new Set(prev).add(draftId));
    try {
      const res = await fetch("/api/outreach/send-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "Failed to send");
        return;
      }
      toast.success("Email sent");
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSendingIds((prev) => {
        const next = new Set(prev);
        next.delete(draftId);
        return next;
      });
    }
  };

  const toggleGroup = (key: GroupKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Needs attention</h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {drafts.length} draft{drafts.length === 1 ? "" : "s"} in flight
        </span>
      </div>

      <div className="space-y-3">
        {visibleGroups.map((key) => {
          const def = OUTREACH_STATUS[key];
          const rows = grouped.get(key) ?? [];
          const isCollapsed = collapsed.has(key);
          const groups = groupDraftsByContact(rows);
          const displayCount = groups.length;
          return (
            <div
              key={key}
              className="border-border overflow-hidden rounded-lg border"
            >
              <button
                type="button"
                onClick={() => toggleGroup(key)}
                aria-expanded={!isCollapsed}
                className="hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:ring-ring flex w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2"
              >
                <StatusPill status={key}>{displayCount}</StatusPill>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{def.label}</div>
                  <div className="text-muted-foreground text-xs">
                    {def.description}
                  </div>
                </div>
                <ChevronDown
                  className={cn(
                    "text-muted-foreground size-4 shrink-0 transition-transform",
                    isCollapsed && "-rotate-90",
                  )}
                />
              </button>
              {!isCollapsed && (
                <ul className="border-border divide-border divide-y border-t">
                  {groups.map((group) => {
                    const firstDraft = group.drafts[0];
                    const earliestWaiting =
                      group.drafts.reduce<DraftRow | null>((best, d) => {
                        if (!d.next_send_at) return best;
                        if (!best || !best.next_send_at) return d;
                        return new Date(d.next_send_at).getTime() <
                          new Date(best.next_send_at).getTime()
                          ? d
                          : best;
                      }, null);
                    const stepSummary =
                      group.drafts.length === 1
                        ? `Step ${firstDraft.step_number}/${group.total_steps}`
                        : `${group.drafts.length} drafts · Steps ${group.drafts
                            .map((d) => d.step_number)
                            .join(", ")}/${group.total_steps}`;
                    return (
                      <li
                        key={group.key}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium">
                              {group.person_name}
                            </span>
                            {group.company_name && (
                              <span className="text-muted-foreground truncate text-xs">
                                @ {group.company_name}
                              </span>
                            )}
                            <span className="text-muted-foreground shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
                              {stepSummary}
                            </span>
                          </div>
                          <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                            <EditableEmail
                              value={firstDraft.to_email}
                              onSave={(next) =>
                                handleEmailEdit(
                                  group.drafts.map((d) => d.id),
                                  next,
                                )
                              }
                            />
                          </div>
                          <p className="text-muted-foreground mt-0.5 truncate text-xs">
                            {firstDraft.subject || "(no subject)"}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {key === "waiting" &&
                            earliestWaiting?.next_send_at && (
                              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums">
                                <Clock className="h-3 w-3" />
                                <RelativeTime
                                  iso={earliestWaiting.next_send_at}
                                />
                              </span>
                            )}

                          {key === "waiting" && earliestWaiting && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSendNow(earliestWaiting.id)}
                              disabled={sendingIds.has(earliestWaiting.id)}
                            >
                              {sendingIds.has(earliestWaiting.id) ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Send className="h-3.5 w-3.5" />
                              )}
                              Send now
                            </Button>
                          )}

                          {key === "blocked" && !firstDraft.has_inbox && (
                            <Link
                              href="/settings"
                              className={buttonVariants({
                                variant: "outline",
                                size: "sm",
                              })}
                            >
                              Configure inbox
                            </Link>
                          )}

                          {key === "blocked" &&
                            firstDraft.has_inbox &&
                            !firstDraft.enrollment_id && (
                              <span className="text-muted-foreground text-xs">
                                No enrollment
                              </span>
                            )}

                          {key === "needs_review" && group.sequence_id && (
                            <ReviewButton sequenceId={group.sequence_id} />
                          )}

                          {key === "rejected" && group.sequence_id && (
                            <ReviewButton
                              sequenceId={group.sequence_id}
                              variant="ghost"
                              label="View"
                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
