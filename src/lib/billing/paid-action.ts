import { createHash } from "node:crypto";
import { getCurrentIdentity, type Identity } from "@/lib/auth/identity";
import { isHostedMode, resolveWorkspace } from "@/lib/auth/workspace";
import { CreditExecutionError, executeWithCredits } from "./credit-execution";
import { getAdminClient } from "@/lib/supabase/admin";
import { quoteCredits } from "./credit-pricing";

type PaidAction = {
  /** Verified server identity, never a request body field. */
  identity: Identity;
  /** Caller persists this UUID and reuses it for retries. */
  key: string | null;
  kind: string;
  request: unknown;
  /** Quantity derived from validated input, not a client-supplied credit amount. */
  units?: number;
};

type ActionIdentity = Pick<PaidAction, "identity" | "key" | "kind">;

async function resolveAction(input: ActionIdentity) {
  if (
    !input.key ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.key,
    )
  )
    throw new CreditExecutionError("A stable operation UUID is required", 400);
  if (!input.identity.userId)
    throw new CreditExecutionError("Authentication required", 401);
  if (input.identity.operationId || getCurrentIdentity()?.operationId)
    throw new CreditExecutionError(
      "Nested paid actions require explicit accounting",
      409,
    );
  const workspaceId = await resolveWorkspace(input.identity.userId);
  if (input.identity.workspaceId && input.identity.workspaceId !== workspaceId)
    throw new CreditExecutionError("Workspace mismatch", 403);
  // Workspace members and separate action types cannot collide on a supplied UUID.
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        input.identity.source,
        input.identity.userId,
        input.kind,
        input.key.toLowerCase(),
      ]),
    )
    .digest("hex");
  return { identity: { ...input.identity, workspaceId }, key };
}

/** Call only after resource authorization. Existing work must bypass free-cache
 * shortcuts and enter executePaidAction for replay or unresolved-state checks. */
export async function hasPaidAction(input: ActionIdentity): Promise<boolean> {
  if (!isHostedMode() || !input.key) return false;
  const { identity, key } = await resolveAction(input);
  const { data, error } = await getAdminClient()
    .from("credit_operations")
    .select("id")
    .eq("workspace_id", identity.workspaceId)
    .eq("user_id", identity.userId)
    .eq("kind", input.kind)
    .eq("source", identity.source)
    .eq("operation_key", key)
    .maybeSingle();
  if (error)
    throw new CreditExecutionError("Credit operation lookup unavailable", 503);
  return data !== null;
}

/** Invoke after authentication, validation and resource authorization. */
export async function executePaidAction<T>(
  input: PaidAction,
  work: () => Promise<T>,
): Promise<T> {
  if (!isHostedMode()) return work();
  const { identity, key } = await resolveAction(input);
  const units = input.units ?? 1;
  let quote: { credits: number | null; rateVersion: string | null } = {
    credits: null,
    rateVersion: null,
  };
  try {
    quote = quoteCredits(input.kind, units);
  } catch {
    // The ledger may reuse an existing immutable quote. Null cannot fund new work.
  }
  return executeWithCredits(
    {
      identity,
      key,
      kind: input.kind,
      request: { input: input.request, units },
      ...quote,
    },
    work,
  );
}
