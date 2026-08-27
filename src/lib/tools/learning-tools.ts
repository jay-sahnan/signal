import { tool } from "ai";
import { z } from "zod";
import { actingUserId } from "@/lib/auth/acting-user";

import { createClient } from "@/lib/supabase/server";
import {
  chunk,
  computeAggregates,
  LEARNING_CATEGORIES,
  LEARNING_CONFIDENCE,
  type SendOutcome,
} from "@/lib/services/outreach-learning";
import { intentRank, type ReplyIntent } from "@/lib/services/reply-intent";

/**
 * Agent tools over the outcome feedback loop: the email_learnings rows the
 * weekly analysis maintains, the per-user suppression list, and on-demand
 * performance breakdowns. All run on the RLS-scoped client, so tenancy is
 * enforced by policy rather than by these tools remembering to filter.
 */

export const listEmailLearnings = tool({
  description:
    "List the user's email learnings: durable, per-row lessons the weekly outcome analysis (and the user or agent) maintains from past sends and replies. Active copy/targeting learnings are automatically applied to future drafts; timing learnings record send-window findings and adjustments. Use this to show the user what the system has learned, or before adding one manually.",
  inputSchema: z.object({
    includeInactive: z
      .boolean()
      .optional()
      .describe("Include retired and dismissed learnings. Default false."),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    let query = supabase
      .from("email_learnings")
      .select(
        "id, category, statement, confidence, status, source, evidence, created_at, last_evaluated_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (!input.includeInactive) query = query.eq("status", "active");
    const { data, error } = await query;
    if (error) return { error: `Failed to load learnings: ${error.message}` };
    return { learnings: data ?? [] };
  },
});

export const addEmailLearning = tool({
  description:
    "Save an email learning the user states or agrees with ('short subjects work better for us', 'CTOs respond more than VPs'). Active copy and targeting learnings are injected into every future draft's prompt, so only add what the user actually wants applied. One imperative sentence per learning.",
  inputSchema: z.object({
    category: z
      .enum(LEARNING_CATEGORIES)
      .describe(
        "copy (wording, structure, angle) | timing (when to send) | targeting (which prospects convert)",
      ),
    statement: z
      .string()
      .min(1)
      .max(500)
      .describe(
        "One imperative sentence a drafting model can act on, e.g. 'Keep subjects under five words.'",
      ),
    confidence: z.enum(LEARNING_CONFIDENCE).optional().describe("Default low."),
  }),
  execute: async (input) => {
    const userId = await actingUserId();
    if (!userId) return { error: "Not authenticated." };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("email_learnings")
      .insert({
        user_id: userId,
        campaign_id: null,
        category: input.category,
        statement: input.statement.trim(),
        confidence: input.confidence ?? "low",
        evidence: {},
        status: "active",
        source: "agent",
      })
      .select("id")
      .single();
    if (error) return { error: `Failed to save learning: ${error.message}` };
    return { ok: true, learningId: data.id };
  },
});

export const setEmailLearningStatus = tool({
  description:
    "Retire, dismiss, or reactivate an email learning by id (from listEmailLearnings). 'retired' stops applying it but the weekly analysis may bring it back if new data supports it; 'user_dismissed' is permanent, the analysis will never re-propose it; 'active' reapplies it to future drafts.",
  inputSchema: z.object({
    learningId: z.string().uuid(),
    status: z.enum(["active", "retired", "user_dismissed"]),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("email_learnings")
      .update({ status: input.status })
      .eq("id", input.learningId)
      .select("id, statement, status")
      .maybeSingle();
    if (error) return { error: `Failed to update learning: ${error.message}` };
    if (!data) return { error: "No such learning." };
    return { ok: true, learning: data };
  },
});

export const suppressContact = tool({
  description:
    "Add an email address to the user's suppression list so no future outreach is ever sent to it: the send pipeline refuses suppressed addresses at the final gate and drafting skips them. Use when the user says to stop contacting someone. Automatic suppressions also happen when a reply is classified as an unsubscribe or a confident decline.",
  inputSchema: z.object({
    email: z.string().email(),
    detail: z
      .string()
      .max(1000)
      .optional()
      .describe("Why, shown in the suppression list UI."),
  }),
  execute: async (input) => {
    const userId = await actingUserId();
    if (!userId) return { error: "Not authenticated." };
    const supabase = await createClient();
    const { error } = await supabase.from("outreach_suppressions").upsert(
      {
        user_id: userId,
        email: input.email.toLowerCase(),
        reason: "user",
        source: "agent",
        detail: input.detail ?? null,
      },
      { onConflict: "user_id,email", ignoreDuplicates: true },
    );
    if (error) return { error: `Failed to suppress: ${error.message}` };
    return { ok: true, email: input.email.toLowerCase() };
  },
});

export const getOutreachPerformance = tool({
  description:
    "Reply-rate breakdowns from actual send outcomes: overall, by send time (weekday and day part), by sequence step, by triggering signal, and by subject length. Replies are intent-classified, so OOO auto-replies and bounces don't count. Use this when the user asks what's working, which signals convert, or when their emails get replies.",
  inputSchema: z.object({
    days: z
      .number()
      .int()
      .min(7)
      .max(365)
      .optional()
      .describe("Trailing window in days. Default 90."),
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Restrict to one campaign."),
  }),
  execute: async (input) => {
    const userId = await actingUserId();
    if (!userId) return { error: "Not authenticated." };
    const supabase = await createClient();
    const windowStart = new Date(
      Date.now() - (input.days ?? 90) * 86400_000,
    ).toISOString();

    let sendsQuery = supabase
      .from("sent_emails")
      .select(
        "id, sent_local_hour, sent_weekday, step_number, sequence_id, campaign_id, features",
      )
      .eq("user_id", userId)
      .gte("sent_at", windowStart)
      .limit(3000);
    if (input.campaignId)
      sendsQuery = sendsQuery.eq("campaign_id", input.campaignId);
    const { data: sends, error: sendsError } = await sendsQuery;
    if (sendsError)
      return { error: `Failed to load sends: ${sendsError.message}` };
    if (!sends || sends.length === 0) {
      return { sends: 0, message: "No sends in the window." };
    }

    // Chunked: .in() lists ride in the URL and thousands of ids blow proxy
    // limits, same constraint as the learn job.
    const intentBySend = new Map<string, ReplyIntent>();
    const bounced = new Set<string>();
    for (const ids of chunk(sends.map((s) => s.id as string))) {
      const { data: replies, error: repliesError } = await supabase
        .from("email_replies")
        .select("sent_email_id, kind, intent")
        .in("sent_email_id", ids);
      // A failed replies fetch is not zero replies: reporting 0% reply rate
      // off a swallowed error has the agent telling the user "nothing is
      // converting" as a fabricated conclusion.
      if (repliesError) {
        return {
          error: `Failed to load replies: ${repliesError.message}. No performance numbers were computed: retry.`,
        };
      }
      for (const r of replies ?? []) {
        const sendId = r.sent_email_id as string;
        if (r.kind === "bounce") {
          bounced.add(sendId);
        } else if (r.intent) {
          // Strongest intent per send: an OOO row must not overwrite the
          // real answer that followed it.
          const intent = r.intent as ReplyIntent;
          const current = intentBySend.get(sendId);
          if (!current || intentRank(intent) > intentRank(current)) {
            intentBySend.set(sendId, intent);
          }
        }
      }
    }

    const sequenceIds = [
      ...new Set(sends.map((s) => s.sequence_id).filter(Boolean)),
    ] as string[];
    const signalNames = new Map<string, string>();
    if (sequenceIds.length > 0) {
      const { data: seqs, error: seqsError } = await supabase
        .from("sequences")
        .select("id, signals(name)")
        .in("id", sequenceIds);
      // Same rule: an empty signal breakdown from a swallowed error reads as
      // "no signal is converting", which is a claim about the data, not about
      // the outage.
      if (seqsError) {
        return {
          error: `Failed to load signal names: ${seqsError.message}. No performance numbers were computed: retry.`,
        };
      }
      for (const seq of seqs ?? []) {
        const signal = Array.isArray(seq.signals)
          ? seq.signals[0]
          : seq.signals;
        if (signal?.name)
          signalNames.set(seq.id as string, signal.name as string);
      }
    }

    const outcomes: SendOutcome[] = sends.map((s) => {
      const features = (s.features ?? {}) as Record<string, unknown>;
      return {
        id: s.id as string,
        sentLocalHour: (s.sent_local_hour as number | null) ?? null,
        sentWeekday: (s.sent_weekday as number | null) ?? null,
        stepNumber: (s.step_number as number | null) ?? null,
        campaignId: (s.campaign_id as string | null) ?? null,
        signalName: s.sequence_id
          ? (signalNames.get(s.sequence_id as string) ?? null)
          : null,
        subjectLen:
          typeof features.subject_len === "number"
            ? features.subject_len
            : null,
        bodyWords:
          typeof features.body_words === "number" ? features.body_words : null,
        intent: intentBySend.get(s.id as string) ?? null,
        bounced: bounced.has(s.id as string),
      };
    });

    const aggregates = computeAggregates(outcomes);
    return {
      windowDays: input.days ?? 90,
      note: "Older sends (before attribution shipped) have no hour/step data and appear only in the totals.",
      ...aggregates,
    };
  },
});
