import { createHash } from "node:crypto";
import { getCurrentIdentity, type Identity } from "@/lib/auth/identity";
import { isHostedMode, resolveWorkspace } from "@/lib/auth/workspace";
import { CreditExecutionError, executeWithCredits } from "./credit-execution";
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

/** Invoke after authentication, validation and resource authorization. */
export async function executePaidAction<T>(
  input: PaidAction,
  work: () => Promise<T>,
): Promise<T> {
  if (!isHostedMode()) return work();
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
  const units = input.units ?? 1;
  const quote = quoteCredits(input.kind, units);
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
  return executeWithCredits(
    {
      identity: { ...input.identity, workspaceId },
      key,
      kind: input.kind,
      request: { input: input.request, units },
      ...quote,
    },
    work,
  );
}
