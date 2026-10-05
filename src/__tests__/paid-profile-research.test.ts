import { executeWithCredits } from "@/lib/billing/credit-execution";
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({ rpc: h.rpc }) }));
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  ctx: vi.fn(),
  paid: vi.fn(),
  rpc: vi.fn(),
  existing: vi.fn(),
  research: vi.fn(),
  load: vi.fn(),
  dedupe: vi.fn(),
  profile: {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "user",
    company_url: "https://example.com",
  },
  db: { from: vi.fn() },
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => true }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAndUser: h.ctx }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid, hasPaidAction: h.existing }));
vi.mock("@/lib/services/sender-research", async (original) => ({
  ...(await original<object>()),
  researchSender: h.research,
  dedupeFacts: h.dedupe,
}));
vi.mock("@/lib/sender-facts", async (original) => ({
  ...(await original<object>()),
  loadAllSenderFacts: h.load,
}));
import { CreditExecutionError } from "@/lib/billing/credit-execution";
import { POST } from "@/app/api/profile/research-facts/route";
const request = () =>
  new Request("https://signal.example/api/profile/research-facts", {
    method: "POST",
    headers: { "Idempotency-Key": "22222222-2222-4222-8222-222222222222" },
    body: JSON.stringify({ profileId: h.profile.id }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.existing.mockResolvedValue(false);
  h.profile.company_url = "https://example.com";
  h.ctx.mockResolvedValue({ user: { id: "user" }, supabase: h.db });
  h.db.from.mockReturnValue({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: h.profile }) }),
    }),
  });
  h.paid.mockImplementation(async (_input, work) => work());
  h.research.mockResolvedValue({ ok: true, facts: [] });
  h.load.mockResolvedValue({ ok: true, facts: [] });
  h.dedupe.mockReturnValue([]);
});
it("stops before provider work when credits are exhausted", async () => {
  h.paid.mockRejectedValue(
    new CreditExecutionError("Insufficient credits", 402),
  );
  expect((await POST(request())).status).toBe(402);
  expect(h.research).not.toHaveBeenCalled();
});
it("authorizes the profile before reserving credits", async () => {
  h.db.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { ...h.profile, user_id: "foreign" },
        }),
      }),
    }),
  });
  expect((await POST(request())).status).toBe(404);
  expect(h.paid).not.toHaveBeenCalled();
});
it("passes a verified identity and stable key to credit execution", async () => {
  const result = await POST(request());
  expect(result.status).toBe(200);
  expect(h.paid).toHaveBeenCalledWith(
    expect.objectContaining({
      identity: { userId: "user", source: "web" },
      key: "22222222-2222-4222-8222-222222222222",
      kind: "profile.research",
    }),
    expect.any(Function),
  );
});
it("replays completed research without calling providers again", async () => {
  h.paid.mockResolvedValue({ added: 2, skippedAsDuplicates: 1 });
  expect(await (await POST(request())).json()).toEqual({
    added: 2,
    skippedAsDuplicates: 1,
  });
  expect(h.research).not.toHaveBeenCalled();
});
it("throws provider failures inside the ledger callback for uncertain settlement", async () => {
  h.research.mockResolvedValue({ ok: false, error: "provider timed out" });
  expect((await POST(request())).status).toBe(503);
  expect(h.load).not.toHaveBeenCalled();
});
it("rejects anonymous requests before lookup or billing", async () => {
  h.ctx.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  expect(h.db.from).not.toHaveBeenCalled();
  expect(h.paid).not.toHaveBeenCalled();
});
it("does not reserve credits for a profile with no research URLs", async () => {
  h.db.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { ...h.profile, company_url: null },
        }),
      }),
    }),
  });
  expect((await POST(request())).status).toBe(400);
  expect(h.paid).not.toHaveBeenCalled();
});
it("does not charge a successful result when the fact bank cannot be read", async () => {
  h.load.mockResolvedValue({ ok: false, error: "unavailable" });
  expect((await POST(request())).status).toBe(503);
  expect(h.dedupe).not.toHaveBeenCalled();
});

it("rejects unusable URLs before credit reservation", async () => {
  h.db.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { ...h.profile, company_url: "not a URL" },
        }),
      }),
    }),
  });
  expect((await POST(request())).status).toBe(400);
  expect(h.paid).not.toHaveBeenCalled();
});

it("keeps the request binding stable after profile URL edits", async () => {
  h.paid.mockResolvedValue({ added: 2 });
  await POST(request());
  h.profile.company_url = "https://changed.example";
  await POST(request());
  expect(h.paid.mock.calls[0][0].request).toEqual({ profileId: h.profile.id });
  expect(h.paid.mock.calls[1][0].request).toEqual(h.paid.mock.calls[0][0].request);
});
it("recovers saved results after removing the last profile URL", async () => {
  h.profile.company_url = "";
  h.existing.mockResolvedValue(true);
  h.paid.mockResolvedValue({ added: 2 });
  expect(await (await POST(request())).json()).toEqual({ added: 2 });
  expect(h.research).not.toHaveBeenCalled();
});

it("finishes an unstarted reservation at zero charge when all profile URLs were removed", async () => {
  h.profile.company_url = "";
  h.existing.mockResolvedValue(true);
  h.research.mockResolvedValue({ ok: false, error: "No usable URLs" });
  h.rpc.mockImplementation(async (name, args) => ({ data:
    name === "reserve_credit_quote" ? { id: args.p_key, state: "reserved", credits: 5 } : true,
  }));
  h.paid.mockImplementation((input, work) => executeWithCredits({
    ...input, identity: { ...input.identity, workspaceId: "workspace" }, credits: 5, rateVersion: "v1",
  }, work));
  expect(await (await POST(request())).json()).toHaveProperty("error");
  expect(h.research).not.toHaveBeenCalled();
  expect(h.rpc).toHaveBeenCalledWith("finish_serialized_credit_result", expect.objectContaining({ p_charged: 0 }));
  expect(h.rpc.mock.calls.some(([name]) => name === "mark_credit_operation_uncertain")).toBe(false);
});
