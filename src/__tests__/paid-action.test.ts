import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  hosted: true,
  resolve: vi.fn(),
  execute: vi.fn(),
  quote: vi.fn(),
}));
vi.mock("@/lib/auth/workspace", () => ({
  isHostedMode: () => h.hosted,
  resolveWorkspace: h.resolve,
}));
vi.mock("@/lib/billing/credit-pricing", () => ({ quoteCredits: h.quote }));
vi.mock("@/lib/billing/credit-execution", async (original) => ({
  ...(await original<object>()),
  executeWithCredits: h.execute,
}));
import { runWithIdentity } from "@/lib/auth/identity";
import { executePaidAction } from "@/lib/billing/paid-action";
const input = {
  identity: { userId: "user", source: "web" as const },
  key: "a1111111-1111-4111-8111-111111111111",
  kind: "profile.research",
  request: { profileId: "profile" },
};
beforeEach(() => {
  vi.clearAllMocks();
  h.hosted = true;
  h.resolve.mockResolvedValue("workspace");
  h.quote.mockReturnValue({ credits: 3, rateVersion: "v1" });
  h.execute.mockImplementation(async (_input, work) => work());
});
it("resolves the verified user's workspace and quotes before executing", async () => {
  const work = vi.fn().mockResolvedValue({ ok: true });
  await expect(executePaidAction(input, work)).resolves.toEqual({ ok: true });
  expect(h.resolve).toHaveBeenCalledWith("user");
  expect(h.quote).toHaveBeenCalledWith("profile.research", 1);
  expect(h.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      identity: { ...input.identity, workspaceId: "workspace" },
      credits: 3,
      request: { input: input.request, units: 1 },
    }),
    work,
  );
});
it("keeps retries stable while separating callers and actions", async () => {
  for (const value of [
    input,
    input,
    { ...input, kind: "other" },
    { ...input, identity: { ...input.identity, userId: "other" } },
  ])
    await executePaidAction(value, async () => null);
  const keys = h.execute.mock.calls.map(([v]) => v.key);
  expect(keys[0]).toBe(keys[1]);
  expect(new Set(keys).size).toBe(3);
});
it("rejects missing operation keys before any paid work", async () => {
  const work = vi.fn();
  await expect(
    executePaidAction({ ...input, key: null }, work),
  ).rejects.toMatchObject({ status: 400 });
  expect(work).not.toHaveBeenCalled();
  expect(h.execute).not.toHaveBeenCalled();
});
it("rejects mismatched workspace context", async () => {
  await expect(
    executePaidAction(
      { ...input, identity: { ...input.identity, workspaceId: "foreign" } },
      vi.fn(),
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(h.execute).not.toHaveBeenCalled();
});
it("fails closed when an unplanned nested charge would occur", async () => {
  await expect(
    executePaidAction(
      { ...input, identity: { ...input.identity, operationId: "running" } },
      vi.fn(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(h.execute).not.toHaveBeenCalled();
});
it("does not impose hosted requirements on self-hosted users", async () => {
  h.hosted = false;
  await expect(
    executePaidAction({ ...input, key: null }, async () => "ok"),
  ).resolves.toBe("ok");
  expect(h.resolve).not.toHaveBeenCalled();
  expect(h.quote).not.toHaveBeenCalled();
});

it("rejects a nested charge even when the caller reconstructs its identity", async () => {
  await expect(
    runWithIdentity({ ...input.identity, operationId: "running" }, () =>
      executePaidAction(input, vi.fn()),
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(h.execute).not.toHaveBeenCalled();
});
it("lets the ledger recover an existing quote when current rates are removed", async () => {
  h.quote.mockImplementation(() => {
    throw new Error("Rate unavailable");
  });
  await expect(executePaidAction(input, async () => "replay")).resolves.toBe(
    "replay",
  );
  expect(h.execute).toHaveBeenCalledWith(
    expect.objectContaining({ credits: null, rateVersion: null }),
    expect.any(Function),
  );
});
