import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * AgentMail webhook receiver. Handles `message.received` to flip a tracked
 * outbound email's status to `replied`. Signature verification uses Svix
 * (AGENTMAIL_WEBHOOK_SECRET, starts with `whsec_`).
 *
 * Wire format is snake_case; the SDK's camelCase types do not apply here
 * because the payload arrives directly from AgentMail's servers.
 */

type InboundEvent = {
  type?: string;
  event_type?: string;
  event_id?: string;
  message?: {
    thread_id?: string;
    message_id?: string;
    from?: string;
    in_reply_to?: string;
  };
  thread?: { thread_id?: string };
};

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

  if (event.event_type !== "message.received") {
    return NextResponse.json({ ok: true, ignored: event.event_type });
  }

  const threadId = event.message?.thread_id ?? event.thread?.thread_id ?? null;
  const inReplyTo = event.message?.in_reply_to ?? null;

  const supabase = getAdminClient();

  let sent: {
    id: string;
    campaign_people_id: string;
    status: string;
  } | null = null;

  if (threadId) {
    const { data } = await supabase
      .from("sent_emails")
      .select("id, campaign_people_id, status")
      .eq("agentmail_thread_id", threadId)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    sent = data;
  }

  // Fallback for rows sent before thread_id was captured: match the
  // inbound message's in_reply_to to our stored message_id.
  if (!sent && inReplyTo) {
    const { data } = await supabase
      .from("sent_emails")
      .select("id, campaign_people_id, status")
      .eq("agentmail_message_id", inReplyTo)
      .maybeSingle();
    sent = data;
  }

  if (!sent) {
    return NextResponse.json({ ok: true, skipped: "untracked thread" });
  }

  if (sent.status === "replied") {
    return NextResponse.json({ ok: true, alreadyReplied: true });
  }

  await supabase
    .from("sent_emails")
    .update({ status: "replied" })
    .eq("id", sent.id);

  await supabase
    .from("campaign_people")
    .update({ outreach_status: "replied" })
    .eq("id", sent.campaign_people_id);

  return NextResponse.json({ ok: true, updated: sent.id });
}
