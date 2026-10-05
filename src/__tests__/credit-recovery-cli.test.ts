import { beforeEach, expect, it, vi } from "vitest";
import { runCreditRecovery } from "../../scripts/reconcile-credit-operations.mjs";
const id = "11111111-1111-4111-8111-111111111111";
const attempt = "22222222-2222-4222-8222-222222222222";
const request = vi.fn(); const print = vi.fn(); const read = vi.fn();
const deps = { env: { NODE_ENV: "test" as const, SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "test-only" }, request, print, read };
const decision = { operationId: id, attemptId: attempt, operator: "oncall", evidenceReference: "ticket/provider-receipt-1", outcome: "no_work", applicationWritesChecked: true, executionStopped: true, charged: 0, result: { error: "Confirmed no work", contacts: [], totalFound: 0 } };
beforeEach(() => {
  vi.clearAllMocks(); read.mockResolvedValue(JSON.stringify(decision));
  request.mockImplementation(async (url: string) => Response.json(url.includes("/rpc/") ? true : url.includes("/api_usage?") ? [] : [{ id, execution_attempt: attempt, state: "uncertain", credits: 5, user_id: "owner" }]));
});
it("lists uncertain operations without mutating anything", async () => {
  await runCreditRecovery(["list"], deps);
  expect(request.mock.calls[0][0]).toContain("state=eq.uncertain");
  expect(request.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
});
it("inspects operation and usage, without treating absent telemetry as proof", async () => {
  await runCreditRecovery(["inspect", id], deps);
  expect(request.mock.calls.some(([url]) => url.includes(`credit_operation_id=eq.${id}`))).toBe(true);
  expect(JSON.stringify(print.mock.calls)).toContain("not proof");
});
it("requires evidence and reviewed application writes before sending any settlement", async () => {
  read.mockResolvedValue(JSON.stringify({ ...decision, applicationWritesChecked: false }));
  await expect(runCreditRecovery(["apply", "decision.json"], deps)).rejects.toThrow("evidence");
  expect(request).not.toHaveBeenCalled();
});
it("submits an audited decision with the inspected attempt and saved result", async () => {
  await runCreditRecovery(["apply", "decision.json"], deps);
  const [, options] = request.mock.calls.find(([url]) => url.includes("/rpc/"))!;
  expect(JSON.parse(options.body)).toMatchObject({ p_id: id, p_attempt: attempt, p_operator: "oncall", p_charged: 0, p_result: JSON.stringify(decision.result) });
});
it("refuses a changed execution attempt or running work", async () => {
  request.mockResolvedValue(Response.json([{ id, execution_attempt: attempt, state: "running", credits: 5 }]));
  await expect(runCreditRecovery(["apply", "decision.json"], deps)).rejects.toThrow("uncertain");
  expect(request.mock.calls.some(([url]) => url.includes("/rpc/"))).toBe(false);
});
it("does not charge a no-work decision or permit a quote overrun", async () => {
  read.mockResolvedValue(JSON.stringify({ ...decision, charged: 5 }));
  await expect(runCreditRecovery(["apply", "decision.json"], deps)).rejects.toThrow("charge");
});
it("does not expose credentials when the database rejects a request", async () => {
  request.mockResolvedValue(new Response("secret", { status: 403 }));
  await expect(runCreditRecovery(["list"], deps)).rejects.toThrow("HTTP 403");
  expect(JSON.stringify(print.mock.calls)).not.toContain("test-only");
});
it("can retry an identical applied decision after the response was lost", async () => {
  request.mockImplementation(async (url: string) => Response.json(url.includes("/rpc/") ? false : [{ id, execution_attempt: attempt, state: "succeeded", credits: 5 }]));
  await runCreditRecovery(["apply", "decision.json"], deps);
  expect(JSON.stringify(print.mock.calls)).toContain("already applied");
});
it("refuses a different inspected attempt without posting", async () => {
  request.mockResolvedValue(Response.json([{ id, execution_attempt: id, state: "uncertain", credits: 5 }]));
  await expect(runCreditRecovery(["apply", "decision.json"], deps)).rejects.toThrow("inspect again");
  expect(request.mock.calls.some(([url]) => url.includes("/rpc/"))).toBe(false);
});
it("rejects a charge above the frozen quote", async () => {
  read.mockResolvedValue(JSON.stringify({ ...decision, outcome: "completed", charged: 6 }));
  await expect(runCreditRecovery(["apply", "decision.json"], deps)).rejects.toThrow("reserved quote");
  expect(request.mock.calls.some(([url]) => url.includes("/rpc/"))).toBe(false);
});

it("requires confirmation that execution has stopped", async () => {
  read.mockResolvedValue(JSON.stringify({ ...decision, executionStopped: false }));
  await expect(runCreditRecovery(["apply", "decision.json"], deps)).rejects.toThrow("evidence");
  expect(request).not.toHaveBeenCalled();
});
it("can explicitly waive an unresolved charge without claiming no provider work occurred", async () => {
  read.mockResolvedValue(JSON.stringify({ ...decision, outcome: "waived", evidenceReference: "support/approved-cost-waiver", result: { error: "Outcome unknown; charge waived", contacts: [] } }));
  await runCreditRecovery(["apply", "decision.json"], deps);
  const [, options] = request.mock.calls.find(([url]) => url.includes("/rpc/"))!;
  expect(JSON.parse(options.body)).toMatchObject({ p_charged: 0, p_evidence: "waived: support/approved-cost-waiver" });
});
it("lists every hold using a stable next-page cursor", async () => {
  const operations = Array.from({ length: 101 }, (_, i) => ({ id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}` }));
  request.mockResolvedValueOnce(Response.json(operations)).mockResolvedValueOnce(Response.json([operations[100]]));
  await runCreditRecovery(["list"], deps);
  const first = JSON.parse(print.mock.calls[0][0]);
  expect(first.operations).toHaveLength(100);
  expect(first.nextAfter).toBe(operations[99].id);
  await runCreditRecovery(["list", first.nextAfter], deps);
  expect(request.mock.calls[1][0]).toContain(`id=gt.${first.nextAfter}`);
  expect(JSON.parse(print.mock.calls[1][0])).toMatchObject({ operations: [operations[100]], nextAfter: null });
});
it("does not tell operators to repeat a decision after ordinary completion", async () => {
  request.mockImplementation(async (url: string) => Response.json(url.includes("credit_operation_reconciliations") ? [] : [{ id, execution_attempt: attempt, state: "succeeded", credits: 5 }]));
  await expect(runCreditRecovery(["apply", "decision.json"], deps)).rejects.toThrow("completed outside operator recovery");
  expect(request.mock.calls.some(([url]) => url.includes("/rpc/"))).toBe(false);
});
