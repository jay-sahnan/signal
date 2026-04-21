import { NextResponse } from "next/server";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { listInboxes, createInbox } from "@/lib/services/agentmail-service";

export async function GET() {
  const ctx = await getSupabaseAndUser();
  if (!ctx)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { supabase, user } = ctx;

  const { data: settings } = await supabase
    .from("user_settings")
    .select("agentmail_inbox_id, from_name, reply_to_email")
    .eq("user_id", user.id)
    .maybeSingle();

  let inboxes: Array<{ inbox_id: string; display_name: string | null }> = [];
  try {
    const rawInboxes = await listInboxes();
    inboxes = rawInboxes.map((inbox) => ({
      inbox_id: inbox.inboxId ?? "",
      display_name: inbox.displayName ?? null,
    }));
  } catch {
    // AgentMail not configured or API key invalid -- return empty list
  }

  return NextResponse.json({
    settings: settings ?? {
      agentmail_inbox_id: null,
      from_name: null,
      reply_to_email: null,
    },
    is_configured: !!settings?.agentmail_inbox_id,
    inboxes,
  });
}

export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { supabase, user } = ctx;
  const body = await request.json();

  // Handle inbox creation
  if (body.action === "create_inbox") {
    const displayName = body.display_name;
    if (!displayName || typeof displayName !== "string") {
      return NextResponse.json(
        { error: "display_name is required" },
        { status: 400 },
      );
    }
    try {
      const inbox = await createInbox(displayName);
      return NextResponse.json({ inbox });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create inbox";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Save/update settings
  const { agentmail_inbox_id, from_name, reply_to_email } = body;

  const fields = {
    user_id: user.id,
    agentmail_inbox_id: agentmail_inbox_id ?? null,
    from_name: from_name ?? null,
    reply_to_email: reply_to_email ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("user_settings").upsert(fields, {
    onConflict: "user_id",
  });

  if (error) {
    return NextResponse.json(
      { error: `Failed to save settings: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ saved: true });
}
