import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

import {
  estimateClaudeCostFromUsage,
  trackUsage,
} from "@/lib/services/cost-tracker";
import { getSupabaseAndUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  const { chatId } = (await request.json()) as { chatId: string };
  if (!chatId) {
    return Response.json({ error: "chatId required" }, { status: 400 });
  }

  // Fetch the chat. Scope to the signed-in user (defense in depth on top
  // of RLS) -- a mismatch yields the same 404 as a missing row.
  const { data: chat, error } = await supabase
    .from("chats")
    .select("messages, title, user_id")
    .eq("id", chatId)
    .single();

  if (error || !chat) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }
  if (chat.user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const messages = chat.messages as Array<{
    role: string;
    parts: Array<{ type: string; text?: string }>;
  }>;

  if (!messages || messages.length === 0) {
    return Response.json({ title: chat.title });
  }

  // Build a compact transcript (text parts only, truncated)
  const lines: string[] = [];
  let charCount = 0;
  const MAX_CHARS = 2000;

  for (const msg of messages) {
    if (charCount >= MAX_CHARS) break;
    const textParts = (msg.parts ?? [])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!);
    if (textParts.length === 0) continue;
    const text = textParts.join(" ").slice(0, MAX_CHARS - charCount);
    lines.push(`${msg.role}: ${text}`);
    charCount += text.length;
  }

  const { text: title, usage } = await generateText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system:
      "Summarize this conversation in 6-10 words as a short title. No quotes, no punctuation at the end. Be specific about the topic, not generic.",
    prompt: lines.join("\n"),
  });

  trackUsage({
    service: "claude",
    operation: "chat-summarize",
    tokens_input: usage.inputTokens ?? 0,
    tokens_output: usage.outputTokens ?? 0,
    estimated_cost_usd: estimateClaudeCostFromUsage("haiku", usage),
    metadata: { model: "claude-haiku-4.5", chatId },
    user_id: user.id,
  });

  // Update the title
  const trimmed = title.trim().slice(0, 120);
  await supabase.from("chats").update({ title: trimmed }).eq("id", chatId);

  return Response.json({ title: trimmed });
}
