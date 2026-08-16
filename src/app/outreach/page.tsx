"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  classifyDraft,
  type DraftRow,
} from "@/components/outreach/outreach-drafts-panel";
import { ReadyToSendHero } from "@/components/outreach/ready-to-send-hero";
import { OutreachTabs } from "@/components/outreach/outreach-tabs";
import {
  CampaignPicker,
  type CampaignBucket,
} from "@/components/outreach/campaign-picker";
import { apiFetch } from "@/lib/api-fetch";
import type { ActivityItem } from "@/lib/outreach/activity";
import type { ActivityFilter } from "@/components/outreach/outreach-activity-panel";

export interface SequenceRow {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  campaign_name: string;
  /** Per-sequence send-window override; null inherits the user setting. */
  send_window_scope: "sender" | "recipient" | null;
  enrolled: number;
  waiting: number;
  sent: number;
  replied: number;
}

export interface EnrollmentCard {
  id: string;
  sequence_id: string;
  person_id: string;
  campaign_people_id: string;
  current_step: number;
  status: string;
  next_send_at: string | null;
  person_name: string;
  person_title: string | null;
  company_name: string | null;
  outreach_status: string | null;
  sequence_name: string;
  campaign_id: string | null;
  campaign_name: string | null;
}

export default function OutreachPage() {
  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentCard[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>(
    [],
  );
  // null = every campaign; otherwise a campaign id and every tab is scoped
  // to it. One picker for the whole page, not one per tab, so Inbox, Sent
  // and Pipeline never disagree about which campaign you are looking at.
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const supabase = createClient();

    const [
      seqsRes,
      enrollmentCountsRes,
      enrollmentsRes,
      draftsRes,
      settingsRes,
      stepRowsRes,
      activityRes,
      campaignsRes,
    ] = await Promise.all([
      supabase
        .from("sequences")
        .select(
          "id, name, status, campaign_id, send_window_scope, campaigns(name)",
        )
        .order("created_at", { ascending: false }),
      supabase.from("sequence_enrollments").select("sequence_id, status"),
      supabase
        .from("sequence_enrollments")
        .select(
          `
            id, sequence_id, person_id, campaign_people_id,
            current_step, status, next_send_at,
            people(name, title, organization_id, organizations!organization_id(name)),
            campaign_people(outreach_status),
            sequences(name, campaign_id, campaigns(name))
          `,
        )
        .in("status", ["waiting", "queued", "active", "replied"])
        .order("updated_at", { ascending: false }),
      supabase
        .from("email_drafts")
        .select(
          `
            id, subject, to_email, review_status, status, sent_at,
            enrollment_id, sequence_id, sequence_step_id, campaign_id,
            campaigns(name),
            sequence_enrollments(next_send_at, sequence_id),
            sequence_steps(step_number),
            sequences(name),
            people(name, title, organizations!organization_id(name))
          `,
        )
        .in("status", ["draft"])
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("user_settings").select("gmail_address").maybeSingle(),
      supabase.from("sequence_steps").select("sequence_id, step_number"),
      // In the same batch rather than after it, so the activity feed rides
      // the page's existing visibility-aware 10s poll without adding a second
      // timer or an extra round trip. Goes through apiFetch because it is an
      // API route, not a direct Supabase read like everything above.
      //
      // Fetched unfiltered and narrowed in the client: the whole set is what
      // the Sent tab's reply count is derived from, so refetching per chip
      // click would make that badge flicker between filters.
      apiFetch("/api/outreach/activity")
        .then((r) => r.json())
        // A failed activity fetch must not blank the rest of the page.
        .catch(() => ({ items: [] as ActivityItem[] })),
      supabase.from("campaigns").select("id, name").order("name"),
    ]);

    if (!mountedRef.current) return;

    const seqs = seqsRes.data ?? [];
    const enrollmentRows = enrollmentCountsRes.data ?? [];
    const cards = enrollmentsRes.data ?? [];
    const rawDrafts = draftsRes.data ?? [];
    const hasInbox = !!settingsRes.data?.gmail_address;

    // Sequence counts
    const countsBySeq = new Map<
      string,
      { enrolled: number; waiting: number; sent: number; replied: number }
    >();
    for (const e of enrollmentRows) {
      const prev = countsBySeq.get(e.sequence_id) ?? {
        enrolled: 0,
        waiting: 0,
        sent: 0,
        replied: 0,
      };
      prev.enrolled++;
      if (e.status === "waiting" || e.status === "queued") prev.waiting++;
      if (e.status === "active") prev.sent++;
      if (e.status === "replied") prev.replied++;
      countsBySeq.set(e.sequence_id, prev);
    }

    // Count total steps per sequence (for Step N/M display)
    const totalStepsBySeq = new Map<string, number>();
    const stepRows = stepRowsRes.data;
    for (const s of stepRows ?? []) {
      const cur = totalStepsBySeq.get(s.sequence_id) ?? 0;
      if (s.step_number > cur)
        totalStepsBySeq.set(s.sequence_id, s.step_number);
    }

    const sequenceRows: SequenceRow[] = seqs.map((s) => {
      const counts = countsBySeq.get(s.id) ?? {
        enrolled: 0,
        waiting: 0,
        sent: 0,
        replied: 0,
      };
      const campaign = s.campaigns as unknown as { name: string } | null;
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        campaign_id: s.campaign_id,
        campaign_name: campaign?.name ?? "Unknown",
        send_window_scope:
          s.send_window_scope === "recipient" ||
          s.send_window_scope === "sender"
            ? s.send_window_scope
            : null,
        ...counts,
      };
    });

    const enrollmentCards: EnrollmentCard[] = cards.map((c) => {
      const person = c.people as unknown as {
        name: string;
        title: string | null;
        organization_id: string | null;
        organizations: { name: string } | null;
      } | null;
      const cp = c.campaign_people as unknown as {
        outreach_status: string;
      } | null;
      const seq = c.sequences as unknown as {
        name: string;
        campaign_id: string | null;
        campaigns: { name: string } | null;
      } | null;
      return {
        id: c.id,
        sequence_id: c.sequence_id,
        person_id: c.person_id,
        campaign_people_id: c.campaign_people_id,
        current_step: c.current_step,
        status: c.status,
        next_send_at: c.next_send_at,
        person_name: person?.name ?? "Unknown",
        person_title: person?.title ?? null,
        company_name: person?.organizations?.name ?? null,
        outreach_status: cp?.outreach_status ?? null,
        sequence_name: seq?.name ?? "",
        campaign_id: seq?.campaign_id ?? null,
        campaign_name: seq?.campaigns?.name ?? null,
      };
    });

    const draftRows: DraftRow[] = rawDrafts.map((d) => {
      const person = d.people as unknown as {
        name: string;
        title: string | null;
        organizations: { name: string } | null;
      } | null;
      const enrollment = d.sequence_enrollments as unknown as {
        next_send_at: string | null;
        sequence_id: string | null;
      } | null;
      const step = d.sequence_steps as unknown as {
        step_number: number;
      } | null;
      const seq = d.sequences as unknown as { name: string } | null;
      const campaign = d.campaigns as unknown as { name: string } | null;
      // The draft's own column, not just the enrollment embed: a draft
      // written into a sequence before (or without) enrollment still
      // belongs to that sequence's review queue.
      const sequenceId = d.sequence_id ?? enrollment?.sequence_id ?? null;
      return {
        id: d.id,
        subject: d.subject ?? "",
        to_email: d.to_email ?? "",
        review_status: d.review_status as DraftRow["review_status"],
        status: d.status ?? "draft",
        person_name: person?.name ?? "Unknown",
        person_title: person?.title ?? null,
        company_name: person?.organizations?.name ?? null,
        sequence_id: sequenceId,
        sequence_name: seq?.name ?? null,
        campaign_id: d.campaign_id ?? null,
        campaign_name: campaign?.name ?? null,
        next_send_at: enrollment?.next_send_at ?? null,
        step_number: step?.step_number ?? 1,
        total_steps: sequenceId ? (totalStepsBySeq.get(sequenceId) ?? 1) : 1,
        enrollment_id: d.enrollment_id ?? null,
        has_inbox: hasInbox,
      };
    });

    setCampaigns(campaignsRes.data ?? []);
    setSequences(sequenceRows);
    setEnrollments(enrollmentCards);
    setDrafts(draftRows);
    setActivity(
      Array.isArray(activityRes?.items)
        ? (activityRes.items as ActivityItem[])
        : [],
    );
    setLoading(false);
  }, []);

  // Bucket counts per campaign, computed from the unfiltered sets so the
  // picker always shows the whole picture no matter which chip is active.
  const buckets = useMemo<CampaignBucket[]>(() => {
    const byId = new Map<string, CampaignBucket>();
    for (const c of campaigns) {
      byId.set(c.id, {
        id: c.id,
        name: c.name,
        drafts: 0,
        ready: 0,
        replied: 0,
      });
    }
    // Campaigns that only exist on rows (e.g. deleted from the list but a
    // draft still points at one) still get a chip so nothing is unreachable.
    const ensure = (id: string | null, name: string | null) => {
      if (!id) return null;
      let b = byId.get(id);
      if (!b) {
        b = { id, name: name ?? "Unknown", drafts: 0, ready: 0, replied: 0 };
        byId.set(id, b);
      }
      return b;
    };
    for (const d of drafts) {
      const b = ensure(d.campaign_id, d.campaign_name);
      if (!b) continue;
      b.drafts++;
      if (classifyDraft(d) === "ready") b.ready++;
    }
    for (const a of activity) {
      const b = ensure(a.campaign_id, a.campaign_name);
      if (b && a.state === "replied") b.replied++;
    }
    for (const s of sequences) ensure(s.campaign_id, s.campaign_name);
    return Array.from(byId.values());
  }, [campaigns, drafts, activity, sequences]);

  // If the selected campaign vanishes (deleted, or its rows all drained and
  // it was never in the campaigns table), behave as All rather than showing
  // an empty page with no way out. Derived, not reset in an effect.
  const activeCampaign =
    selectedCampaign && buckets.some((b) => b.id === selectedCampaign)
      ? selectedCampaign
      : null;

  const scoped = useMemo(() => {
    if (!activeCampaign) {
      return { drafts, enrollments, sequences, activity };
    }
    const id = activeCampaign;
    return {
      drafts: drafts.filter((d) => d.campaign_id === id),
      enrollments: enrollments.filter((e) => e.campaign_id === id),
      sequences: sequences.filter((s) => s.campaign_id === id),
      activity: activity.filter((a) => a.campaign_id === id),
    };
  }, [activeCampaign, drafts, enrollments, sequences, activity]);

  useEffect(() => {
    mountedRef.current = true;

    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Poll every 10s while the tab is visible — reflects approve/reject/cron progress
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (interval) return;
      interval = setInterval(load, 10_000);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };

    if (document.visibilityState === "visible") start();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        load();
        start();
      } else {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stop();
    };
  }, [load]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-8 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="type-title">Outreach</h1>
            <p className="text-muted-foreground text-sm">
              Signal-driven email sequences across all campaigns.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            <span className="text-muted-foreground text-sm">Loading...</span>
          </div>
        ) : // Also gated on activity: mail sent through the agent's sendEmail
        // tool has no sequence, and this empty state would otherwise hide the
        // whole Sent tab from anyone who has only ever sent that way.
        sequences.length === 0 && activity.length === 0 ? (
          <div className="border-border flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
            <p className="text-sm font-medium">No outreach sequences yet</p>
            <p className="text-muted-foreground text-xs">
              Open a campaign and ask the agent to set up a sequence.
            </p>
          </div>
        ) : (
          <>
            {buckets.length > 1 && (
              <CampaignPicker
                buckets={buckets}
                selectedId={activeCampaign}
                onSelect={setSelectedCampaign}
              />
            )}

            <ReadyToSendHero
              drafts={scoped.drafts.filter((d) => classifyDraft(d) === "ready")}
              onRefresh={load}
            />

            <OutreachTabs
              drafts={scoped.drafts}
              sequences={scoped.sequences}
              enrollments={scoped.enrollments}
              activity={scoped.activity}
              activityFilter={activityFilter}
              onActivityFilterChange={setActivityFilter}
              activityLoading={loading}
              onRefresh={load}
            />
          </>
        )}
      </div>
    </div>
  );
}
