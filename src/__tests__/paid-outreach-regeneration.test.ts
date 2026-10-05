import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ hosted: true, authenticated: true, owner: "owner", status: "draft", review: "pending", writeOk: true,
  paid: vi.fn(), compose: vi.fn(), writes: vi.fn(), filters: {} as Record<string, unknown>, scoped: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid }));
vi.mock("@/lib/email-composition/compose", () => ({ composeEmail: h.compose }));
vi.mock("@/lib/email-composition/load-voice", () => ({ loadVoiceProfile: async () => null }));
vi.mock("@/lib/sender-facts", () => ({ loadSenderFacts: async () => [], renderFactBank: () => "" }));
vi.mock("@/lib/email-learnings", () => ({ loadActiveLearnings: async () => [], renderLearningsBlock: () => "" }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAndUser: async () => h.authenticated ? { user: { id: "owner" }, supabase: { from: h.scoped } } : null }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({ from: h.admin }) }));
import { POST } from "@/app/api/outreach/regenerate/route";
import { CreditExecutionError } from "@/lib/billing/credit-execution";
const draftId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const call = () => POST(new Request("https://signal.test", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ draftId }) }));
beforeEach(() => {
  vi.clearAllMocks(); h.hosted = true; h.authenticated = true; h.owner = "owner"; h.status = "draft"; h.review = "pending"; h.writeOk = true; h.filters = {};
  const from = (table: string) => {
    let writing = false;
    const result = () => ({ data: writing ? (h.writeOk ? { id: draftId } : null) : table === "email_drafts" ? {
      id: draftId, user_id: h.owner, status: h.status, review_status: h.review, person_id: "person", campaign_id: "campaign", updated_at: "version-1",
    } : table === "people" ? { name: "Alice" } : { name: "Campaign" }, error: null });
    const q = { select: () => q, eq: (field: string, value: unknown) => { if (writing) h.filters[field] = value; return q; },
      update: (value: unknown) => { writing = true; h.writes(value); return q; }, single: async () => result(), maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => resolve(result()) };
    return q;
  };
  h.scoped.mockImplementation(from); h.admin.mockImplementation(from);
  h.compose.mockResolvedValue({ ok: true, email: { subject: "Hello", bodyHtml: "<p>Hello</p>", bodyText: "Hello" } });
  h.paid.mockImplementation(async (_input, work, prepare) => { await prepare?.(); return work(); });
});
it("refuses an empty wallet before composing or writing", async () => {
  h.paid.mockRejectedValue(new CreditExecutionError("Insufficient credits", 402));
  expect((await call()).status).toBe(402); expect(h.compose).not.toHaveBeenCalled(); expect(h.writes).not.toHaveBeenCalled();
});
it("replays completed work even when the draft has since been approved", async () => {
  h.review = "approved"; const saved = { ok: true, draftId, subject: "Original" }; h.paid.mockResolvedValue(saved);
  expect(await (await call()).json()).toEqual(saved); expect(h.compose).not.toHaveBeenCalled();
  expect(h.paid).toHaveBeenCalledWith(expect.objectContaining({ key, kind: "outreach.regenerate", request: { draftId }, identity: { userId: "owner", source: "web" } }), expect.any(Function), expect.any(Function));
});
it("rejects another user's draft before billing", async () => {
  h.owner = "other"; expect((await call()).status).toBe(403); expect(h.paid).not.toHaveBeenCalled(); expect(h.compose).not.toHaveBeenCalled();
});
it("uses scoped reads and conditionally replaces only the unchanged pending draft", async () => {
  expect((await call()).status).toBe(200); expect(h.admin).not.toHaveBeenCalled();
  expect(h.filters).toEqual({ id: draftId, user_id: "owner", status: "draft", review_status: "pending", updated_at: "version-1" });
});
it("does not start new work for an approved draft", async () => {
  h.review = "approved"; expect((await call()).status).toBe(409); expect(h.compose).not.toHaveBeenCalled(); expect(h.writes).not.toHaveBeenCalled();
});
it("throws from paid work on a failed composition instead of settling it as success", async () => {
  h.compose.mockResolvedValue({ ok: false, error: "provider timeout" });
  let failure: unknown; h.paid.mockImplementation(async (_input, work, prepare) => { await prepare(); try { return await work(); } catch (error) { failure = error; throw error; } });
  const response = await call(); expect(response.status).toBe(500); expect(failure).toBeInstanceOf(Error);
  expect((await response.json()).error).toMatch(/support/i); expect(h.writes).not.toHaveBeenCalled();
});
it("does not settle success if the draft changed during generation", async () => {
  h.writeOk = false; expect((await call()).status).toBe(500); expect(h.compose).toHaveBeenCalledOnce();
});
it("preserves self-hosted regeneration without billing", async () => {
  h.hosted = false; expect((await call()).status).toBe(200); expect(h.paid).not.toHaveBeenCalled(); expect(h.compose).toHaveBeenCalledOnce();
});
