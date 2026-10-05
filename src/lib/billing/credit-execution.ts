import { createHash } from "node:crypto";
import { type Identity, runWithIdentity } from "@/lib/auth/identity";
import { isHostedMode } from "@/lib/auth/workspace";
import { getAdminClient } from "@/lib/supabase/admin";

export class CreditExecutionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
function requestHash(value: unknown) {
  const serialized = JSON.stringify(value, (_key, item) => {
    if (
      item === undefined ||
      typeof item === "function" ||
      (typeof item === "number" && !Number.isFinite(item))
    )
      throw new CreditExecutionError("Credit request must be JSON", 400);
    if (item && typeof item === "object" && !Array.isArray(item))
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, item[key]]),
      );
    return item;
  });
  if (!serialized || Buffer.byteLength(serialized) > 65_536)
    throw new CreditExecutionError("Credit request is too large", 400);
  return createHash("sha256").update(serialized).digest("hex");
}
type CreditExecution = {
  identity: Identity;
  key: string;
  kind: string;
  request: unknown;
  /** Trusted server quote; never copy credit amounts from request bodies. */
  credits: number | null;
  rateVersion: string | null;
};

/** Caller supplies verified identity and a durable operation key reused on retries. */
export async function executeWithCredits<T>(
  input: CreditExecution,
  work: () => Promise<T>,
): Promise<T> {
  if (!isHostedMode()) return work();
  const { identity } = input;
  if (!identity.workspaceId || !identity.userId)
    throw new CreditExecutionError("Workspace identity required", 401);
  const hash = requestHash(input.request);
  const db = getAdminClient();
  const reserved = await db.rpc("reserve_credit_quote", {
    p_workspace: identity.workspaceId,
    p_user: identity.userId,
    p_key: input.key,
    p_hash: hash,
    p_kind: input.kind,
    p_source: identity.source,
    p_credits: input.credits,
    p_version: input.rateVersion,
  });
  if (reserved.error || !reserved.data) {
    if (reserved.error?.message === "Insufficient credits")
      throw new CreditExecutionError(
        "Insufficient credits; top up in Signal settings",
        402,
      );
    throw new CreditExecutionError(
      "Credit reservation unavailable or conflicting; retry with the same operation key",
      409,
    );
  }
  const op = reserved.data as {
    id: string;
    state: string;
    credits: number;
    result: T;
  };
  if (op.state === "succeeded") {
    const replay = await db.rpc("read_serialized_credit_result", {
      p_id: op.id,
      p_user: identity.userId,
    });
    if (replay.error)
      throw new Error("Credit result unavailable; retry with the same key");
    return JSON.parse(replay.data as string) as T;
  }
  if (op.state !== "reserved")
    throw new CreditExecutionError(
      "Operation already started or closed; check its outcome before retrying",
      409,
    );
  const started = await db.rpc("start_credit_operation", {
    p_id: op.id,
    p_user: identity.userId,
  });
  if (started.error || started.data !== true)
    throw new CreditExecutionError(
      "Operation could not start; no provider work was run",
      409,
    );
  try {
    const result = await runWithIdentity(
      { ...identity, operationId: op.id },
      work,
    );
    const serialized = JSON.stringify(result);
    // Large research responses live separately from the compact credit ledger.
    if (serialized === undefined || Buffer.byteLength(serialized) > 1_000_000)
      throw new Error("Credit result requires a durable reference");
    const settled = await db.rpc("finish_serialized_credit_result", {
      p_id: op.id,
      p_user: identity.userId,
      p_charged: op.credits,
      p_result: serialized,
    });
    if (settled.error)
      throw new Error(
        "Credit settlement unavailable; result needs reconciliation",
      );
    return JSON.parse(serialized) as T;
  } catch (error) {
    // A timeout may have happened after the provider acted. Never refund or rerun
    // automatically; even a failed uncertainty write leaves the operation running.
    try {
      await db.rpc("finish_credit_operation", {
        p_id: op.id,
        p_user: identity.userId,
        p_state: "uncertain",
        p_charged: null,
        p_result: null,
      });
    } catch {
      /* Preserve the original provider/settlement error. */
    }
    throw error;
  }
}
