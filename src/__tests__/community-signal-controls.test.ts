import { expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: h.rpc }) }));
import { toggleCampaignSignal } from "@/lib/tools/signal-tools";
import { preferPrivateSignalCopies } from "@/lib/signals/community-copies";
it("activates through the atomic owned-copy operation and returns the local link", async () => {
  const row = { signal_id: "local-copy", campaign_id: "campaign", enabled: true };
  h.rpc.mockResolvedValue({ data: row, error: null });
  expect(await toggleCampaignSignal.execute!({ campaignId: "campaign", signalId: "public-source", enabled: true }, {} as never))
    .toMatchObject({ campaignSignal: row });
  expect(h.rpc).toHaveBeenCalledWith("set_campaign_signal", { p_campaign: "campaign", p_signal: "public-source", p_enabled: true });
});
it("shows a private local copy instead of a misleading second source toggle", () => {
  const source = { id: "source", is_builtin: false, is_public: true };
  const copy = { id: "copy", is_builtin: false, is_public: false, source_signal_id: "source" };
  expect(preferPrivateSignalCopies([source, copy])).toEqual([copy]);
  expect(preferPrivateSignalCopies([copy])).toEqual([copy]);
});
it("cannot hide a recipe through another publisher's public copy marker", () => {
  const source = { id: "source", is_builtin: false, is_public: true };
  const copy = { id: "copy", is_builtin: false, is_public: true, source_signal_id: "source" };
  expect(preferPrivateSignalCopies([source, copy])).toEqual([source, copy]);
  expect(preferPrivateSignalCopies([{ ...source, is_builtin: true }, { ...copy, is_public: false }])).toHaveLength(2);
});
it("does not report a missing activation result as success", async () => {
  h.rpc.mockResolvedValue({ data: null, error: null });
  await expect(toggleCampaignSignal.execute!({ campaignId: "campaign", signalId: "source", enabled: true }, {} as never))
    .rejects.toThrow("no result");
});

it("preserves legacy toggles when the new RPC is explicitly absent", async () => {
  const { setCampaignSignal } = await import("@/lib/signals/community-copies");
  const row = { signal_id: "signal", campaign_id: "campaign", enabled: true };
  const single = vi.fn().mockResolvedValue({ data: row, error: null });
  const upsert = vi.fn().mockReturnValue({ select: () => ({ single }) });
  const db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find public.set_campaign_signal" } }), from: vi.fn().mockReturnValue({ upsert }) };
  expect(await setCampaignSignal(db as never, "campaign", "signal", true)).toMatchObject({ data: row, error: null });
  expect(upsert).toHaveBeenCalledWith({ campaign_id: "campaign", signal_id: "signal", enabled: true }, { onConflict: "campaign_id,signal_id" });
});
for (const code of ["42501", "PGRST000", "42883"]) {
  it(`never bypasses installed-RPC failures (${code}) with a direct write`, async () => {
    const { setCampaignSignal } = await import("@/lib/signals/community-copies");
    const error = { code, message: "Internal dependency failed" };
    const db = { rpc: vi.fn().mockResolvedValue({ data: null, error }), from: vi.fn() };
    expect(await setCampaignSignal(db as never, "campaign", "signal", true)).toHaveProperty("error", error);
    expect(db.from).not.toHaveBeenCalled();
  });
}
