import { createClient } from "@/lib/supabase/client";
import type { UIMessage } from "ai";

// ---------------------------------------------------------------------------
// Title generation (pure function, no LLM call)
// ---------------------------------------------------------------------------

function generateTitle(messages: UIMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!firstUserMsg) return "New chat";

  const text = firstUserMsg.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();

  if (!text) return "New chat";
  if (text.length <= 80) return text;
  const truncated = text.slice(0, 77).replace(/\s+\S*$/, "");
  return truncated ? `${truncated}...` : `${text.slice(0, 77)}...`;
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export interface ChatSummary {
  id: string;
  title: string;
  campaign_id: string | null;
  updated_at: string;
}

export async function saveChat(
  chatId: string,
  messages: UIMessage[],
  campaignId?: string,
): Promise<void> {
  const supabase = createClient();
  const title = generateTitle(messages);

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("chats").upsert(
    {
      id: chatId,
      title,
      campaign_id: campaignId ?? null,
      messages: JSON.parse(JSON.stringify(messages)),
      updated_at: new Date().toISOString(),
      user_id: authUser?.id,
    },
    { onConflict: "id" },
  );

  if (error) console.error("[chat-history] save failed:", error.message);
}

export async function loadChat(chatId: string): Promise<{
  id: string;
  title: string;
  campaign_id: string | null;
  messages: UIMessage[];
} | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("chats")
    .select("id, title, campaign_id, messages")
    .eq("id", chatId)
    .single();

  if (error || !data) return null;
  return data as {
    id: string;
    title: string;
    campaign_id: string | null;
    messages: UIMessage[];
  };
}

export async function loadCampaignChat(
  campaignId: string,
): Promise<{ id: string; messages: UIMessage[] } | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("chats")
    .select("id, messages")
    .eq("campaign_id", campaignId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;
  return data as { id: string; messages: UIMessage[] };
}

export async function listChats(limit = 30): Promise<ChatSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("chats")
    .select("id, title, campaign_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as ChatSummary[];
}

export async function deleteChat(chatId: string): Promise<void> {
  const supabase = createClient();
  await supabase.from("chats").delete().eq("id", chatId);
}
