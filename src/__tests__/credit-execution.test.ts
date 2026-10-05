import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rpc: vi.fn(), hosted: true }));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ rpc: h.rpc }),
}));
import { executeWithCredits } from "@/lib/billing/credit-execution";
import { getCurrentIdentity } from "@/lib/auth/identity";
const input = {
  identity: {
    userId: "owner",
    workspaceId: "workspace",
    source: "web" as const,
  },
  key: "stable-client-operation",
  kind: "research",
  request: { company: "example" },
  credits: 5,
  rateVersion: "v1",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.hosted = true;
  h.rpc.mockImplementation(async (name) => ({
    error: null,
    data:
      name === "reserve_credit_quote"
        ? { id: "operation", state: "reserved", credits: 5 }
        : true,
  }));
});
it("reserves and starts before work, then settles once with its replayable result", async () => {
  const work = vi.fn(async () => {
    expect(h.rpc.mock.calls.map((c) => c[0])).toEqual([
      "reserve_credit_quote",
      "claim_credit_execution",
    ]);
    expect(getCurrentIdentity()?.operationId).toBe("operation");
    return { found: 2 };
  });
  expect(await executeWithCredits(input, work)).toEqual({ found: 2 });
  expect(h.rpc).toHaveBeenLastCalledWith(
    "finish_serialized_credit_result",
    expect.objectContaining({
      p_charged: 5,
      p_result: JSON.stringify({ found: 2 }),
    }),
  );
});
it("blocks provider work when credit reservation fails", async () => {
  h.rpc.mockResolvedValue({
    error: { code: "23514", message: "Insufficient credits" },
  });
  const work = vi.fn();
  await expect(executeWithCredits(input, work)).rejects.toThrow(
    "Insufficient credits",
  );
  expect(work).not.toHaveBeenCalled();
});
it("returns a completed replay without running the provider again", async () => {
  h.rpc
    .mockResolvedValueOnce({ data: { id: "operation", state: "succeeded" } })
    .mockResolvedValueOnce({ data: JSON.stringify({ found: 2 }) });
  const work = vi.fn();
  expect(await executeWithCredits(input, work)).toEqual({ found: 2 });
  expect(work).not.toHaveBeenCalled();
});
it.each(["running", "uncertain", "released"])(
  "does not restart a %s operation",
  async (state) => {
    h.rpc.mockResolvedValue({ data: { id: "operation", state } });
    const work = vi.fn();
    await expect(executeWithCredits(input, work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  },
);
it("does not run after another request wins the start transition", async () => {
  h.rpc
    .mockResolvedValueOnce({
      data: { id: "operation", state: "reserved", credits: 5 },
    })
    .mockResolvedValueOnce({ data: false });
  const work = vi.fn();
  await expect(executeWithCredits(input, work)).rejects.toThrow();
  expect(work).not.toHaveBeenCalled();
});
it("retains the reservation on ambiguous provider failure", async () => {
  await expect(
    executeWithCredits(input, async () => {
      throw new Error("timeout");
    }),
  ).rejects.toThrow("timeout");
  expect(h.rpc).toHaveBeenLastCalledWith(
    "finish_credit_operation",
    expect.objectContaining({
      p_state: "uncertain",
      p_charged: null,
      p_result: null,
    }),
  );
});
it("never repeats work when saving a successful result fails", async () => {
  h.rpc.mockImplementation(async (name) => ({
    data:
      name === "reserve_credit_quote"
        ? { id: "operation", state: "reserved", credits: 5 }
        : true,
    error:
      name === "finish_serialized_credit_result"
        ? { message: "offline" }
        : null,
  }));
  const work = vi.fn(async () => ({ found: 2 }));
  await expect(executeWithCredits(input, work)).rejects.toThrow("settlement");
  expect(work).toHaveBeenCalledTimes(1);
});
it("preserves self-hosted operation without a billing database", async () => {
  h.hosted = false;
  expect(await executeWithCredits(input, async () => "done")).toBe("done");
  expect(h.rpc).not.toHaveBeenCalled();
});
it("hashes object keys consistently for semantic retries", async () => {
  await executeWithCredits(
    { ...input, request: { b: 2, a: 1 } },
    async () => null,
  );
  await executeWithCredits(
    { ...input, request: { a: 1, b: 2 } },
    async () => null,
  );
  const calls = h.rpc.mock.calls.filter((c) => c[0] === "reserve_credit_quote");
  expect(calls[0][1].p_hash).toBe(calls[1][1].p_hash);
});

it("settles the frozen quote returned by the database after a rate change", async () => {
  await executeWithCredits(
    { ...input, credits: 10, rateVersion: "v2" },
    async () => null,
  );
  expect(h.rpc).toHaveBeenLastCalledWith(
    "finish_serialized_credit_result",
    expect.objectContaining({ p_charged: 5 }),
  );
});

it("stores and replays research payloads larger than the inline ledger limit", async () => {
  const result = { body: "x".repeat(100000) };
  expect(await executeWithCredits(input, async () => result)).toEqual(result);
  expect(h.rpc).toHaveBeenLastCalledWith(
    "finish_serialized_credit_result",
    expect.objectContaining({ p_result: JSON.stringify(result) }),
  );
});

it("sends the exact bounded serialized result, avoiding JSONB numeric expansion", async () => {
  const result = Array(10_000).fill(5e-324);
  expect(await executeWithCredits(input, async () => result)).toEqual(result);
  expect(h.rpc).toHaveBeenLastCalledWith(
    "finish_serialized_credit_result",
    expect.objectContaining({ p_result: JSON.stringify(result) }),
  );
});
it("confirms a lost start response with the same private execution token before work", async () => {
  let starts = 0;
  h.rpc.mockImplementation(async (name) => {
    if (name === "reserve_credit_quote")
      return { data: { id: "operation", state: "reserved", credits: 5 } };
    if (name === "claim_credit_execution" && ++starts === 1)
      throw new Error("response lost");
    return { data: true };
  });
  const work = vi.fn(async () => ({ ok: true }));
  await executeWithCredits(input, work);
  const calls = h.rpc.mock.calls.filter(
    ([name]) => name === "claim_credit_execution",
  );
  expect(calls).toHaveLength(2);
  expect(calls[0][1].p_attempt).toBe(calls[1][1].p_attempt);
  expect(work).toHaveBeenCalledTimes(1);
});
