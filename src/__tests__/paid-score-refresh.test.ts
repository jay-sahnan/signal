import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ hosted: true, owner: "owner", links: [] as Array<{ id: string; person: { enrichment_status: string; name: string } }>, paid: vi.fn(), model: vi.fn(), writes: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid }));
vi.mock("@/lib/profile", () => ({ getProfileForPrompt: h.profile }));
vi.mock("ai", async original => ({ ...(await original<typeof import("ai")>()), generateObject: h.model }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "model" }));
vi.mock("@/lib/services/cost-tracker", () => ({ withAction: (_label: string, work: () => unknown) => work(), trackUsage: vi.fn(), estimateClaudeCostFromUsage: () => 0 }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAndUser: async () => ({ user: { id: "owner" }, supabase: { from: (table: string) => {
  let writing = false;
  const filters: Record<string, unknown> = {};
  const q = { select: () => q, eq: (name: string, value: unknown) => { filters[name] = value; return q; }, in: () => q,
    update: (value: unknown) => { writing = true; h.writes(value); return q; },
    single: async () => ({ data: { user_id: h.owner, name: "Campaign", icp: {}, offering: {} }, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve(writing ? { data: h.writes.mock.results.at(-1)?.value === false ? [] : [{ id: filters.id }], error: null }
      : { data: table === "campaign_people" ? h.links : [], error: null }) };
  return q;
} } }) }));
import { POST } from "@/app/api/refresh-scores/route";
import { CreditExecutionError, CompletedWithoutCharge } from "@/lib/billing/credit-execution";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
const call = (ids: string[] | undefined = [id]) => POST(new Request("https://signal.test/api/refresh-scores", {
  method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ campaignId: "campaign", campaignContactIds: ids }),
}));
beforeEach(() => {
  vi.clearAllMocks(); h.hosted = true; h.owner = "owner";
  h.links = [{ id, person: { enrichment_status: "enriched", name: "Alice" } }];
  h.profile.mockResolvedValue(null); h.writes.mockReturnValue(true);
  h.model.mockResolvedValue({ object: { scores: [{ id, score: 7, reason: "Fit" }] }, usage: {} });
  h.paid.mockImplementation(async (_input, work) => { const value = await work(); return value instanceof CompletedWithoutCharge ? value.value : value; });
});
it("denies before the model and score writes when credits are unavailable", async () => {
  h.paid.mockRejectedValue(new CreditExecutionError("Insufficient credits", 402));
  expect((await call()).status).toBe(402);
  expect(h.model).not.toHaveBeenCalled(); expect(h.writes).not.toHaveBeenCalled();
});
it("replays the saved result without model or score writes", async () => {
  const saved = { scored: 1, scores: [{ id, score: 9, reason: "Original" }] };
  h.paid.mockResolvedValue(saved);
  expect(await (await call()).json()).toEqual(saved);
  expect(h.paid).toHaveBeenCalledWith(expect.objectContaining({ kind: "contact.score", key, units: 1, request: { campaignId: "campaign", campaignContactIds: [id] } }), expect.any(Function));
  expect(h.model).not.toHaveBeenCalled(); expect(h.writes).not.toHaveBeenCalled();
});
it("rejects foreign selection before reserving or generating", async () => {
  h.links = [];
  expect((await call()).status).toBe(404); expect(h.paid).not.toHaveBeenCalled(); expect(h.model).not.toHaveBeenCalled();
});
it("rejects a foreign campaign before reserving", async () => {
  h.owner = "someone-else";
  expect((await call()).status).toBe(403); expect(h.paid).not.toHaveBeenCalled();
});
for (const ids of [[], [id, id], Array(51).fill(id), ["invalid"]]) {
  it(`rejects invalid selection ${ids.length}`, async () => {
    expect((await call(ids)).status).toBe(400); expect(h.paid).not.toHaveBeenCalled();
  });
}
it("does not write model-generated IDs outside the authorized selection", async () => {
  h.model.mockResolvedValue({ object: { scores: [{ id: other, score: 8, reason: "Wrong" }] }, usage: {} });
  expect((await call()).status).toBe(500); expect(h.model).toHaveBeenCalledOnce(); expect(h.writes).not.toHaveBeenCalled();
});
it("throws from paid work when persistence fails instead of settling success", async () => {
  h.writes.mockReturnValue(false);
  let workError: unknown;
  h.paid.mockImplementation(async (_input, work) => { try { return await work(); } catch (error) { workError = error; throw error; } });
  expect((await call()).status).toBe(500); expect(workError).toBeInstanceOf(Error); expect(h.writes).toHaveBeenCalledOnce();
});
it("preserves self-hosted scoring without prepaid billing", async () => {
  h.hosted = false;
  expect(await (await call()).json()).toMatchObject({ scored: 1 }); expect(h.paid).not.toHaveBeenCalled();
});
it("binds a canonical contact selection and charges per selected contact", async () => {
  h.links.push({ id: other, person: { enrichment_status: "enriched", name: "Bob" } });
  h.model.mockResolvedValue({ object: { scores: h.links.map(link => ({ id: link.id, score: 7, reason: "Fit" })) }, usage: {} });
  expect(await (await call([other, id])).json()).toMatchObject({ scored: 2 });
  expect(h.paid).toHaveBeenCalledWith(expect.objectContaining({ units: 2, request: { campaignId: "campaign", campaignContactIds: [id, other] } }), expect.any(Function));
  expect(h.writes).toHaveBeenCalledTimes(2);
});
it("settles an unenriched selection without a model call or charge", async () => {
  h.links[0].person.enrichment_status = "pending";
  let outcome: unknown;
  h.paid.mockImplementation(async (_input, work) => { outcome = await work(); return (outcome as CompletedWithoutCharge<unknown>).value; });
  expect(await (await call()).json()).toMatchObject({ scored: 0 });
  expect(outcome).toBeInstanceOf(CompletedWithoutCharge); expect(h.model).not.toHaveBeenCalled();
});
it("requires the stable request key before hosted scoring", async () => {
  const response = await POST(new Request("https://signal.test", { method: "POST", body: JSON.stringify({ campaignId: "campaign", campaignContactIds: [id] }) }));
  expect(response.status).toBe(400); expect(h.paid).not.toHaveBeenCalled(); expect(h.model).not.toHaveBeenCalled();
});
