import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who the current request acts as, when it did not arrive through Clerk's
 * cookie session. The MCP route sets this around each tool call; everything
 * that reads user identity (getSupabaseAndUser, the tools that call Clerk's
 * auth() for a userId) checks here first and falls back to Clerk otherwise.
 */
export type Identity = {
  userId: string;
  /** Where the request came from, for cost and telemetry attribution. */
  source: "mcp";
};

const store = new AsyncLocalStorage<Identity>();

export function runWithIdentity<T>(identity: Identity, fn: () => T): T {
  return store.run(identity, fn);
}

export function getCurrentIdentity(): Identity | undefined {
  return store.getStore();
}

/**
 * The acting user id: the injected identity if present, else whatever the
 * caller's resolver (normally Clerk's auth()) says.
 */
export async function getCurrentUserId(
  fallback: () => Promise<string | null | undefined>,
): Promise<string | null> {
  const injected = store.getStore();
  if (injected) return injected.userId;
  return (await fallback()) ?? null;
}
