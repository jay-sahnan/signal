import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  recordBounce,
  recordVerifiedEmail,
} from "@/lib/services/email-pattern";
import { getPostHogClient } from "@/lib/posthog-server";

export const runtime = "nodejs";

/**
 * AgentMail webhook receiver.
 *
 * - `message.received`  → flip a tracked outbound email's status to `replied`.
 * - `message.delivered` → promote the recipient's email to `send_confirmed`
 *                         (ground-truth verification + feeds the org pattern).
 * - `message.bounced`   → mark the email invalid + dent the org pattern's
 *                         confidence if the email was pattern-derived.
 *
 * Signature verification uses Svix (AGENTMAIL_WEBHOOK_SECRET, starts with `whsec_`).
 * Wire format is snake_case; the SDK's camelCase types do not apply here.
 */

type InboundEvent = {
  type?: string;
  event_type?: string;
  event_id?: string;
  message?: {
    thread_id?: string;
    message_id?: string;
    from?: string;
    to?: string;
    in_reply_to?: string;
  };
  thread?: { thread_id?: string };
};

interface SentEmailRow {
  id: string;
  campaign_people_id: string;
  status: string;
  to_email: string | null;
  person_id: string | null;
  user_id: string | null;
}

async function findSentEmail(
  supabase: ReturnType<typeof getAdminClient>,
  args: { threadId: string | null; messageId: string | null },
): Promise<SentEmailRow | null> {
  const select = "id, campaign_people_id, status, to_email, person_id, user_id";

  if (args.messageId) {
    const { data } = await supabase
      .from("sent_emails")
      .select(select)
      .eq("agentmail_message_id", args.messageId)
      .maybeSingle();
    if (data) return data as SentEmailRow;
  }

  if (args.threadId) {
    const { data } = await supabase
      .from("sent_emails")
      .select(select)
      .eq("agentmail_thread_id", args.threadId)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as SentEmailRow;
  }

  return null;
}

export async function POST(req: Request) {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "AGENTMAIL_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  const body = await req.text();
  const svixHeaders = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  let event: InboundEvent;
  try {
    event = new Webhook(secret).verify(body, svixHeaders) as InboundEvent;
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const threadId = event.message?.thread_id ?? event.thread?.thread_id ?? null;
  const messageId = event.message?.message_id ?? null;

  switch (event.event_type) {
    case "message.received": {
      // Reply detected. Match by thread first (typical case), then fall back
      // to in_reply_to → our stored message_id.
      const inReplyTo = event.message?.in_reply_to ?? null;
      const sent = await findSentEmail(supabase, {
        threadId,
        messageId: inReplyTo,
      });
      if (!sent) {
        return NextResponse.json({ ok: true, skipped: "untracked thread" });
      }
      if (sent.status === "replied") {
        return NextResponse.json({ ok: true, alreadyReplied: true });
      }
      await Promise.all([
        supabase
          .from("sent_emails")
          .update({ status: "replied" })
          .eq("id", sent.id),
        supabase
          .from("campaign_people")
          .update({ outreach_status: "replied" })
          .eq("id", sent.campaign_people_id),
      ]);
      if (sent.user_id) {
        getPostHogClient().capture({
          distinctId: sent.user_id,
          event: "email_replied",
          properties: {
            sent_email_id: sent.id,
            campaign_people_id: sent.campaign_people_id,
            person_id: sent.person_id,
          },
        });
      }
      return NextResponse.json({ ok: true, updated: sent.id });
    }

    case "message.delivered": {
      const sent = await findSentEmail(supabase, { threadId, messageId });
      if (!sent) {
        return NextResponse.json({ ok: true, skipped: "untracked message" });
      }
      // Mark as delivered (don't downgrade if already 'replied') AND promote
      // the recipient's address to `send_confirmed`. Three independent writes
      // hit different tables and run in parallel.
      const tasks: PromiseLike<unknown>[] = [];
      if (sent.status === "sent") {
        tasks.push(
          supabase
            .from("sent_emails")
            .update({ status: "delivered" })
            .eq("id", sent.id),
          // Don't clobber a downstream 'replied' that beat us here.
          supabase
            .from("campaign_people")
            .update({ outreach_status: "delivered" })
            .eq("id", sent.campaign_people_id)
            .eq("outreach_status", "sent"),
        );
      }
      if (sent.person_id && sent.to_email) {
        tasks.push(
          recordVerifiedEmail(supabase, {
            personId: sent.person_id,
            email: sent.to_email,
            source: "send_confirmed",
          }),
        );
      }
      await Promise.all(tasks);
      if (sent.user_id && sent.status === "sent") {
        getPostHogClient().capture({
          distinctId: sent.user_id,
          event: "email_delivered",
          properties: {
            sent_email_id: sent.id,
            campaign_people_id: sent.campaign_people_id,
            person_id: sent.person_id,
          },
        });
      }
      return NextResponse.json({ ok: true, delivered: sent.id });
    }

    case "message.bounced": {
      const sent = await findSentEmail(supabase, { threadId, messageId });
      if (!sent) {
        return NextResponse.json({ ok: true, skipped: "untracked message" });
      }
      const tasks: PromiseLike<unknown>[] = [
        supabase
          .from("sent_emails")
          .update({ status: "bounced" })
          .eq("id", sent.id),
        supabase
          .from("campaign_people")
          .update({ outreach_status: "bounced" })
          .eq("id", sent.campaign_people_id),
      ];
      if (sent.person_id && sent.to_email) {
        tasks.push(
          recordBounce(supabase, {
            personId: sent.person_id,
            email: sent.to_email,
          }),
        );
      }
      await Promise.all(tasks);
      if (sent.user_id) {
        getPostHogClient().capture({
          distinctId: sent.user_id,
          event: "email_bounced",
          properties: {
            sent_email_id: sent.id,
            campaign_people_id: sent.campaign_people_id,
            person_id: sent.person_id,
          },
        });
      }
      return NextResponse.json({ ok: true, bounced: sent.id });
    }

    default:
      return NextResponse.json({ ok: true, ignored: event.event_type });
  }
}
