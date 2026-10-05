import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  paid: vi.fn(),
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
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid }));
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
