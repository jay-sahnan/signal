import { auth } from "@clerk/nextjs/server";
import { isHostedMode, resolveWorkspace } from "@/lib/auth/workspace";
import { getAdminClient } from "@/lib/supabase/admin";
import { BillingRequestError, requireBillingOwner } from "./account";
import { prepaidConfig, stripeConnectionConfig } from "./prepaid-config";
import { getStripe } from "./stripe";
import { findCheckoutSession } from "./checkout-history";
import { fulfillCreditSession } from "./prepaid-fulfillment";

async function accountRow(workspace: string) {
  const row = await getAdminClient()
    .from("workspace_billing")
    .select("stripe_customer_id, risk_hold")
    .eq("workspace_id", workspace)
    .maybeSingle();
  if (row.error) throw new Error("Billing account unavailable");
  return row.data;
}
async function pendingOrder(workspace: string) {
  const row = await getAdminClient()
    .from("credit_orders")
    .select("id, session_id, customer_id, credits")
    .eq("workspace_id", workspace)
    .eq("state", "pending")
    .maybeSingle();
  if (row.error) throw new Error("Pending purchase unavailable");
  return row.data;
}
export async function prepaidStatus() {
  if (!isHostedMode())
    throw new BillingRequestError("Billing unavailable", 404);
  const { userId } = await auth();
  if (!userId) throw new BillingRequestError("Sign in required", 401);
  const workspaceId = await resolveWorkspace(userId);
  const db = getAdminClient();
  const [account, owner, wallet, pending] = await Promise.all([
    accountRow(workspaceId),
    db
      .from("workspaces")
      .select("owner_user_id")
      .eq("id", workspaceId)
      .maybeSingle(),
    db.rpc("credit_summary", { p_workspace: workspaceId, p_user: userId }),
    pendingOrder(workspaceId),
  ]);
  if (owner.error || !owner.data) throw new Error("Workspace unavailable");
  if (wallet.error || !wallet.data)
    throw new Error("Credit balance unavailable");
  const totals = wallet.data as {
    available: number;
    reserved: number;
    spent: number;
  };
  if (
    ![totals.available, totals.reserved, totals.spent].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    throw new Error("Credit balance unavailable");
  let packCredits: number | null = null;
  try {
    packCredits = prepaidConfig().credits;
  } catch {
    // Existing balances remain available while checkout configuration is repaired.
  }
  return {
    available: totals.available,
    reserved: totals.reserved,
    spent: totals.spent,
    canManage: owner.data.owner_user_id === userId,
    hasCustomer: Boolean(account?.stripe_customer_id),
    riskHold: Boolean(account?.risk_hold),
    pendingPurchase: Boolean(pending),
    pendingCredits: pending ? Number(pending.credits) : null,
    packCredits,
  };
}
export async function refreshPrepaidBilling(request: Request): Promise<void> {
  const { workspaceId } = await requireBillingOwner(request);
  const order = await pendingOrder(workspaceId);
  if (!order) return;
  const sessionId =
    order.session_id ??
    (await findCheckoutSession(order.customer_id, order.id))?.id;
  if (sessionId) await fulfillCreditSession(sessionId, workspaceId);
}
export async function openPrepaidPortal(request: Request): Promise<string> {
  const { workspaceId } = await requireBillingOwner(request);
  const account = await accountRow(workspaceId);
  if (!account?.stripe_customer_id)
    throw new BillingRequestError("No billing account", 409);
  const session = await getStripe().billingPortal.sessions.create({
    customer: account.stripe_customer_id,
    return_url: `${stripeConnectionConfig().origin}/settings/billing`,
  });
  return session.url;
}
