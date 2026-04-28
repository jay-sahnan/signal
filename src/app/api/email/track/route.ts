import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getMessage } from "@/lib/services/agentmail-service";

/**
 * Delivery tracking endpoint. Call via cron or QStash schedule.
 * Polls AgentMail for delivery status of recently sent emails
 * and updates outreach_status accordingly.
 */

// Status priority -- only move forward, never regress
const STATUS_PRIORITY: Record<string, number> = {
  not_contacted: 0,
  queued: 1,
  sent: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
  replied: 6,
  bounced: 6,
  complained: 6,
};

export async function POST(request: Request) {
  // Cron/internal route — verify caller has the service-role key
  const authHeader = request.headers.get("authorization") ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();

  // Load recent sent emails that haven't reached a terminal state
  const { data: emails, error } = await supabase
    .from("sent_emails")
    .select("id, agentmail_message_id, campaign_people_id, user_id, status")
    .in("status", ["sent", "delivered", "opened"])
    .order("sent_at", { ascending: false })
    .limit(100);

  if (error || !emails || emails.length === 0) {
    return NextResponse.json({ checked: 0, updated: 0 });
  }

  // Load user settings to get inbox IDs
  const userIds = [...new Set(emails.map((e) => e.user_id))];
  const { data: settingsRows } = await supabase
    .from("user_settings")
    .select("user_id, agentmail_inbox_id")
    .in("user_id", userIds);

  const inboxByUser = new Map<string, string>();
  for (const row of settingsRows ?? []) {
    if (row.agentmail_inbox_id) {
      inboxByUser.set(row.user_id, row.agentmail_inbox_id);
    }
  }

  let updated = 0;

  for (const email of emails) {
    const inboxId = inboxByUser.get(email.user_id);
    if (!inboxId) continue;

    try {
      const msg = await getMessage(inboxId, email.agentmail_message_id);
      if (!msg) continue;

      // Map AgentMail message labels/status to outreach_status
      // AgentMail uses labels on messages -- check for delivery-related labels
      const msgLabels = (msg.labels ?? []) as string[];
      const msgStatus = msgLabels.join(",").toLowerCase();
      let newStatus: string | null = null;

      if (msgStatus.includes("delivered")) newStatus = "delivered";
      else if (msgStatus.includes("bounced") || msgStatus.includes("bounce"))
        newStatus = "bounced";
      else if (msgStatus.includes("opened")) newStatus = "opened";
      else if (msgStatus.includes("clicked")) newStatus = "clicked";
      else if (msgStatus.includes("complained") || msgStatus.includes("spam"))
        newStatus = "complained";

      if (!newStatus) continue;

      // Only move forward in the pipeline
      const currentPriority = STATUS_PRIORITY[email.status] ?? 0;
      const newPriority = STATUS_PRIORITY[newStatus] ?? 0;
      if (newPriority <= currentPriority) continue;

      // Update sent_emails
      await supabase
        .from("sent_emails")
        .update({ status: newStatus })
        .eq("id", email.id);

      // Update campaign_people outreach_status
      await supabase
        .from("campaign_people")
        .update({ outreach_status: newStatus })
        .eq("id", email.campaign_people_id);

      updated++;
    } catch {
      // Skip individual failures -- don't break the loop
    }
  }

  return NextResponse.json({ checked: emails.length, updated });
}
