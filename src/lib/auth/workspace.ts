import { getAdminClient } from "@/lib/supabase/admin";

/** An explicit server deployment choice, never a request or user preference. */
export function isHostedMode(): boolean {
  const mode = process.env.SIGNAL_DEPLOYMENT_MODE;
  if (!mode || mode === "self-hosted") return false;
  if (mode === "hosted") return true;
  throw new Error("Invalid SIGNAL_DEPLOYMENT_MODE");
}

/** Call only with identity verified by Clerk or a trusted job owner. */
export async function resolveWorkspace(userId: string): Promise<string> {
  if (!userId.trim()) throw new Error("Identity required");
  const { data, error } = await getAdminClient().rpc("ensure_workspace", {
    p_user_id: userId,
  });
  if (
    error ||
    typeof data !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      data,
    )
  ) {
    throw new Error("Workspace unavailable");
  }
  return data;
}
