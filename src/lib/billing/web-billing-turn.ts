import { AsyncLocalStorage } from "node:async_hooks";
const turn = new AsyncLocalStorage<string>();
/** Route supplies the persisted chat/user-message identity, never a model call ID. */
export function withWebBillingTurn<T>(id: string, work: () => T): T {
  return turn.run(id, work);
}
export function getWebBillingTurn() { return turn.getStore(); }

/** Keep original SDK options (including streamed call IDs) unchanged. */
export function bindWebBillingTurn<T extends import("ai").ToolSet>(tools: T, id: string): T {
  return Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, {
    ...tool,
    ...(tool.execute ? { execute: (input: unknown, opts: Parameters<NonNullable<typeof tool.execute>>[1]) =>
      withWebBillingTurn(id, () => tool.execute!(input, opts)),
    } : {}),
  }])) as T;
}
export function webBillingTurnId(chatId: string | null, messages: unknown): string | null {
  if (!chatId || !Array.isArray(messages)) return null;
  const user = [...messages].reverse().find(message => message?.role === "user");
  if (typeof user?.id !== "string" || !user.id.trim() || user.id.length > 200) return null;
  return JSON.stringify([chatId, user.id]);
}
