import { auth } from "@clerk/nextjs/server";
import { isHostedMode, resolveWorkspace } from "@/lib/auth/workspace";
import { getAdminClient } from "@/lib/supabase/admin";
import { billingConfig } from "./config";

export class BillingRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Cookie-authenticated website mutations only; never accept a requested owner. */
export async function requireBillingOwner(request: Request) {
  if (!isHostedMode())
    throw new BillingRequestError("Billing unavailable", 404);
  if (request.headers.get("origin") !== billingConfig().origin) {
    throw new BillingRequestError("Invalid request origin", 403);
  }
  const { userId } = await auth();
  if (!userId) throw new BillingRequestError("Sign in required", 401);
  const workspaceId = await resolveWorkspace(userId);
  const { data, error } = await getAdminClient()
    .from("workspaces")
    .select("owner_user_id")
    .eq("id", workspaceId)
    .single();
  if (error) throw new Error("Workspace ownership unavailable");
  if (data?.owner_user_id !== userId)
    throw new BillingRequestError("Workspace owner required", 403);
  return { userId, workspaceId };
}
