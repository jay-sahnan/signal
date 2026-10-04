import { auth } from "@clerk/nextjs/server";
import { isHostedMode, resolveWorkspace } from "@/lib/auth/workspace";
import { getAdminClient } from "@/lib/supabase/admin";
import { BillingRequestError, requireBillingOwner } from "./account";
import { billingConfig } from "./config";
import { getStripe } from "./stripe";
import { reconcileCustomer } from "./subscriptions";

async function readAccount(workspaceId: string) {
  const { data, error } = await getAdminClient()
    .from("workspace_billing")
    .select(
      "status, stripe_customer_id, period_end, monthly_units, monitor_limit, cancel_at_period_end, risk_hold, reconciled_at",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error("Billing account unavailable");
  return data;
}

export async function billingStatus() {
  if (!isHostedMode())
    throw new BillingRequestError("Billing unavailable", 404);
  const { userId } = await auth();
  if (!userId) throw new BillingRequestError("Sign in required", 401);
  const workspaceId = await resolveWorkspace(userId);
  const [row, owner] = await Promise.all([
    readAccount(workspaceId),
    getAdminClient()
      .from("workspaces")
      .select("owner_user_id")
      .eq("id", workspaceId)
      .maybeSingle(),
  ]);
  if (owner.error || !owner.data) throw new Error("Workspace unavailable");
  const plan = billingConfig();
  return {
    status: (row?.status ?? "none") as string,
    canManage: owner.data.owner_user_id === userId,
    hasCustomer: Boolean(row?.stripe_customer_id),
    periodEnd: (row?.period_end ?? null) as string | null,
    monthlyUnits: Number(row?.monthly_units ?? 0),
    monitorLimit: Number(row?.monitor_limit ?? 0),
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    riskHold: Boolean(row?.risk_hold),
    reconciledAt: (row?.reconciled_at ?? null) as string | null,
    plan: { monthlyUnits: plan.monthlyUnits, monitorLimit: plan.monitorLimit },
  };
}

async function ownedCustomer(request: Request) {
  const { workspaceId } = await requireBillingOwner(request);
  const row = await readAccount(workspaceId);
  if (!row?.stripe_customer_id)
    throw new BillingRequestError("No billing account", 409);
  return row.stripe_customer_id as string;
}

export async function openBillingPortal(request: Request): Promise<string> {
  const customer = await ownedCustomer(request);
  const session = await getStripe().billingPortal.sessions.create({
    customer,
    return_url: `${billingConfig().origin}/settings/billing`,
  });
  return session.url;
}

export async function refreshBilling(request: Request): Promise<void> {
  await reconcileCustomer(await ownedCustomer(request));
}
