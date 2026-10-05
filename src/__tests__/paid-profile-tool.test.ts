import { executeWithCredits } from "@/lib/billing/credit-execution";
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({ rpc: h.rpc }) }));
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  paid: vi.fn(),
  rpc: vi.fn(),
  existing: vi.fn(),
  research: vi.fn(),
  profile: {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "owner",
    company_url: "https://example.com",
  },
}));
vi.mock("@/lib/auth/acting-user", () => ({
  actingUserId: async () => "owner",
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => true }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid, hasPaidAction: h.existing }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: h.profile }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/services/sender-research", async (original) => ({
  ...(await original<object>()),
  researchSender: h.research,
}));
import { researchSenderProfile } from "@/lib/tools/sender-fact-tools";
import { runWithIdentity } from "@/lib/auth/identity";
const key = "22222222-2222-4222-8222-222222222222";
const execute = (
  input: object,
  source: "web" | "mcp" = "mcp",
  toolCallId = "call_123",
) =>
  runWithIdentity({ userId: "owner", source }, () =>
    researchSenderProfile.execute!(input as never, {
      toolCallId,
      messages: [],
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.existing.mockResolvedValue(false);
  h.profile.company_url = "https://example.com";
  h.profile.user_id = "owner";
  h.paid.mockResolvedValue({ ok: true, added: 2 });
});
it("sends verified MCP identity and the explicit retry UUID through the ledger", async () => {
  await expect(
    execute({ profileId: h.profile.id, operationId: key }),
  ).resolves.toEqual({ ok: true, added: 2 });
  expect(h.paid).toHaveBeenCalledWith(
    expect.objectContaining({
      identity: { userId: "owner", source: "mcp" },
      key,
      kind: "profile.research",
    }),
    expect.any(Function),
  );
  expect(h.research).not.toHaveBeenCalled();
});
it("does not manufacture a new MCP retry key", async () => {
  await execute({ profileId: h.profile.id });
  expect(h.paid).toHaveBeenCalledWith(
    expect.objectContaining({ key: null }),
    expect.any(Function),
  );
});
it("rejects foreign profile ownership before any reservation", async () => {
  h.profile.user_id = "foreign";
  await expect(
    execute({ profileId: h.profile.id, operationId: key }),
  ).resolves.toHaveProperty("error");
  expect(h.paid).not.toHaveBeenCalled();
});
it("derives stable web keys from the SDK tool call and separates calls", async () => {
  await execute({ profileId: h.profile.id }, "web", "call_1");
  await execute({ profileId: h.profile.id }, "web", "call_1");
  await execute({ profileId: h.profile.id }, "web", "call_2");
  const keys = h.paid.mock.calls.map(([input]) => input.key);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[0]).not.toBe(keys[2]);
  expect(keys[0]).toMatch(/^[a-f0-9-]{36}$/);
});
it("blocks provider work when the credit ledger denies the action", async () => {
  h.paid.mockRejectedValue(new Error("Insufficient credits"));
  await expect(
    execute({ profileId: h.profile.id, operationId: key }),
  ).rejects.toThrow("Insufficient credits");
  expect(h.research).not.toHaveBeenCalled();
});

it("binds retries to the owned profile rather than mutable source fields", async () => {
  await execute({ profileId: h.profile.id, operationId: key });
  h.profile.company_url = "https://changed.example";
  await execute({ profileId: h.profile.id, operationId: key });
  expect(h.paid.mock.calls[0][0].request).toEqual({ profileId: h.profile.id });
  expect(h.paid.mock.calls[1][0].request).toEqual(h.paid.mock.calls[0][0].request);
});
it("recovers existing research after the last profile URL is removed", async () => {
  h.profile.company_url = "";
  h.existing.mockResolvedValue(true);
  expect(await execute({ profileId: h.profile.id, operationId: key })).toEqual({ ok: true, added: 2 });
  expect(h.research).not.toHaveBeenCalled();
});
it("still rejects a new profile research request without a URL", async () => {
  h.profile.company_url = "";
  expect(await execute({ profileId: h.profile.id, operationId: key })).toHaveProperty("error");
  expect(h.paid).not.toHaveBeenCalled();
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
  expect(await execute({ profileId: h.profile.id, operationId: key })).toHaveProperty("error");
  expect(h.research).not.toHaveBeenCalled();
  expect(h.rpc).toHaveBeenCalledWith("finish_serialized_credit_result", expect.objectContaining({ p_charged: 0 }));
  expect(h.rpc.mock.calls.some(([name]) => name === "mark_credit_operation_uncertain")).toBe(false);
});
