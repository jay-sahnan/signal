import { tool } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";

import {
  listChats as listStoredChats,
  loadChat,
} from "@/lib/services/chat-history";
import { createClient } from "@/lib/supabase/server";

/**
 * Read-only access to the web chat's history, so a terminal session (Claude
 * Code, Codex over MCP) can pick up where a browser conversation left off.
 * Chats are RLS-scoped to the caller, like everything else.
 */

const MAX_TEXT_CHARS = 2000;

type Part = { type: string; text?: string; state?: string; output?: unknown };

/** Text plus the names of tools each turn called; tool payloads are dropped. */
export function compactMessage(m: UIMessage): {
  role: string;
  text: string;
  tools: string[];
} {
  const parts = (m.parts ?? []) as Part[];
  const text = parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n")
    .trim();
  const tools = parts
    .filter((p) => p.type.startsWith("tool-"))
    .map((p) => p.type.slice("tool-".length));
  return {
    role: m.role,
    text:
      text.length > MAX_TEXT_CHARS
        ? text.slice(0, MAX_TEXT_CHARS - 1) + "…"
        : text,
    tools,
  };
}

export const listChats = tool({
  description:
    "List the user's saved web-chat conversations, newest first: id, title, campaign and last update. Use getChat to read one. Read-only.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Max chats to return, default 30."),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const chats = await listStoredChats(supabase, input.limit ?? 30);
    if (chats === null) {
      return { error: "Could not load chat history. Try again." };
    }
    return { chats };
  },
});

export const getChat = tool({
  description:
    "Read one saved web-chat conversation as compact turns (role, text, tool names called). Returns the most recent turns; pass maxMessages for more. Tool inputs and outputs are omitted. Read-only.",
  inputSchema: z.object({
    chatId: z.string().uuid().describe("Chat id from listChats."),
    maxMessages: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("How many of the latest turns to return, default 40."),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const loaded = await loadChat(supabase, input.chatId);
    if (!loaded.ok) return { error: `Could not load chat: ${loaded.error}` };
    if (!loaded.chat) return { error: "No chat with that id." };
    const all = loaded.chat.messages ?? [];
    const max = input.maxMessages ?? 40;
    const messages = all.slice(-max).map(compactMessage);
    return {
      id: loaded.chat.id,
      title: loaded.chat.title,
      campaignId: loaded.chat.campaign_id,
      totalMessages: all.length,
      returned: messages.length,
      messages,
    };
  },
});
