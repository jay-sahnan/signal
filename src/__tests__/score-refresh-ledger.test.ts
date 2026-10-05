import { expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ selected: [] as string[], rpc: vi.fn(), model: vi.fn(), writes: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => true, resolveWorkspace: async () => "workspace" }));
vi.mock("@/lib/billing/credit-pricing", () => ({ quoteCredits: () => ({ credits: 2, rateVersion: "v1" }) }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({ rpc: h.rpc }) }));
vi.mock("@/lib/profile", () => ({ getProfileForPrompt: async () => null }));
vi.mock("ai", async original => ({ ...(await original<typeof import("ai")>()), generateObject: h.model }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "model" }));
vi.mock("@/lib/services/cost-tracker", () => ({ withAction: (_name: string, work: () => unknown) => work(), trackUsage: vi.fn(), estimateClaudeCostFromUsage: () => 0 }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAndUser: async () => ({ user: { id: "owner" }, supabase: { from: () => {
  let writing = false;
  const q = { select: () => q, eq: () => q, in: (_column: string, ids: string[]) => { h.selected = ids; return q; },
    update: (value: unknown) => { writing = true; h.writes(value); return q; },
    single: async () => ({ data: { user_id: "owner", name: "Campaign", icp: {}, offering: {} } }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: writing ? [{ id: h.selected[0] }] : h.selected.map(id => ({ id, person: { name: "Alice", enrichment_status: "enriched" } })) }) };
  return q;
} } }) }));
import { POST } from "@/app/api/refresh-scores/route";
it("runs through real billing wrappers, replays once, and rejects changed selection under the same key", async () => {
  let hash = "", state = "reserved", payload = "";
  h.rpc.mockImplementation(async (name, args) => {
    if (name === "reserve_credit_quote") {
      if (hash && hash !== args.p_hash) return { error: { code: "23505", message: "Idempotency conflict" } };
      hash = args.p_hash;
      return { data: { id: "operation", state, credits: 2 } };
    }
    if (name === "claim_credit_execution") state = "running";
    else if (name === "finish_serialized_credit_result") { state = "succeeded"; payload = args.p_result; }
    else if (name === "read_serialized_credit_result") return { data: payload };
    else throw new Error(`Unexpected RPC ${name}`);
    return { data: true };
  });
  h.model.mockImplementation(async () => ({ object: { scores: h.selected.map(id => ({ id, score: 8, reason: "Fit" })) }, usage: {} }));
  const call = (id: string) => POST(new Request("https://signal.test", { method: "POST",
    headers: { "Idempotency-Key": "33333333-3333-4333-8333-333333333333" }, body: JSON.stringify({ campaignId: "campaign", campaignContactIds: [id] }) }));
  const id = "11111111-1111-4111-8111-111111111111";
  const first = await (await call(id)).json();
  expect(first).toMatchObject({ scored: 1 });
  expect(await (await call(id)).json()).toEqual(first);
  expect((await call("22222222-2222-4222-8222-222222222222")).status).toBe(409);
  expect(h.model).toHaveBeenCalledOnce(); expect(h.writes).toHaveBeenCalledOnce();
  expect(h.rpc.mock.calls.filter(([name]) => name === "finish_serialized_credit_result")).toHaveLength(1);
});
