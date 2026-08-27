import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listChats: vi.fn(),
  loadChat: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/services/chat-history", () => ({
  listChats: h.listChats,
  loadChat: h.loadChat,
}));

import { compactMessage, getChat, listChats } from "@/lib/tools/chat-tools";

const msg = (role: string, parts: unknown[]) =>
  ({ id: "m", role, parts }) as never;

describe("chat tools", () => {
  it("compacts a turn to text plus tool names", () => {
    const c = compactMessage(
      msg("assistant", [
        { type: "step-start" },
        { type: "text", text: "Looking that up." },
        {
          type: "tool-getCompanies",
          state: "output-available",
          output: { big: "x".repeat(5000) },
        },
        { type: "text", text: "Found 3." },
      ]),
    );
    expect(c).toEqual({
      role: "assistant",
      text: "Looking that up.\nFound 3.",
      tools: ["getCompanies"],
    });
    expect(JSON.stringify(c)).not.toContain("xxxx");
  });

  it("listChats surfaces a load failure distinctly from an empty list", async () => {
    h.listChats.mockResolvedValueOnce(null);
    expect(await listChats.execute!({}, {} as never)).toMatchObject({
      error: expect.any(String),
    });
    h.listChats.mockResolvedValueOnce([]);
    expect(await listChats.execute!({}, {} as never)).toEqual({ chats: [] });
  });

  it("getChat returns the latest N turns and the true total", async () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      msg(i % 2 ? "assistant" : "user", [{ type: "text", text: `t${i}` }]),
    );
    h.loadChat.mockResolvedValueOnce({
      ok: true,
      chat: { id: "c1", title: "T", campaign_id: null, messages },
    });
    const r = (await getChat.execute!(
      { chatId: "0b1d1a5e-0000-4000-8000-000000000000", maxMessages: 2 },
      {} as never,
    )) as {
      totalMessages: number;
      returned: number;
      messages: Array<{ text: string }>;
    };
    expect(r.totalMessages).toBe(5);
    expect(r.returned).toBe(2);
    expect(r.messages.map((m) => m.text)).toEqual(["t3", "t4"]);
  });

  it("getChat distinguishes a missing chat from a failed query", async () => {
    h.loadChat.mockResolvedValueOnce({ ok: true, chat: null });
    expect(
      await getChat.execute!(
        { chatId: "0b1d1a5e-0000-4000-8000-000000000000" },
        {} as never,
      ),
    ).toEqual({ error: "No chat with that id." });
    h.loadChat.mockResolvedValueOnce({ ok: false, error: "boom" });
    expect(
      await getChat.execute!(
        { chatId: "0b1d1a5e-0000-4000-8000-000000000000" },
        {} as never,
      ),
    ).toMatchObject({ error: expect.stringContaining("boom") });
  });
});
