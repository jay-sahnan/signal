import { expect, it } from "vitest";
import { bindWebBillingTurn, getWebBillingTurn, webBillingTurnId } from "@/lib/billing/web-billing-turn";
it("retains the user message identity across regenerated assistant responses", () => {
  const user = { id: "user-1", role: "user" };
  expect(webBillingTurnId("chat", [user, { id: "old", role: "assistant" }]))
    .toBe(webBillingTurnId("chat", [user, { id: "new", role: "assistant" }]));
  expect(webBillingTurnId("chat", [user])).not.toBe(webBillingTurnId("chat", [{ ...user, id: "user-2" }]));
  expect(webBillingTurnId(null, [user])).toBeNull();
  expect(webBillingTurnId("chat", [{ role: "user" }])).toBeNull();
});
it("scopes async executions separately and leaves SDK call IDs untouched", async () => {
  const tools = { read: { inputSchema: {} as never, execute: async (_input: unknown, opts: { toolCallId: string }) => {
    await Promise.resolve();
    return [getWebBillingTurn(), opts.toolCallId];
  } } };
  const a = bindWebBillingTurn(tools, "turn-a");
  const b = bindWebBillingTurn(tools, "turn-b");
  expect(await Promise.all([
    a.read.execute({}, { toolCallId: "sdk-a" }),
    b.read.execute({}, { toolCallId: "sdk-b" }),
  ])).toEqual([["turn-a", "sdk-a"], ["turn-b", "sdk-b"]]);
  expect(getWebBillingTurn()).toBeUndefined();
});
