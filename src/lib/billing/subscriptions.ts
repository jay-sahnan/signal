import { getAdminClient } from "@/lib/supabase/admin";
import { billingConfig } from "./config";
import { getStripe } from "./stripe";
import { subscriptionState } from "./subscription-state";

/** Newer sync attempts fence off slow responses from older event deliveries. */
export async function reconcileCustomer(customerId: string): Promise<boolean> {
  const db = getAdminClient();
  const { data: revision, error: beginError } = await db.rpc(
    "begin_subscription_sync",
    {
      p_customer_id: customerId,
    },
  );
  if (beginError) throw new Error("Cannot begin subscription synchronization");
  if (revision == null) return false; // A Stripe customer outside this app.
  const subscriptions = await getStripe().subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
    expand: ["data.latest_invoice"],
  });
  if (subscriptions.has_more) {
    console.warn("Subscription history requires operator review", {
      customerId,
    });
  }
  const live = subscriptions.data.filter(
    (s) => !["canceled", "incomplete_expired"].includes(s.status),
  );
  // Multiple live subscriptions are ambiguous: deny work until corrected.
  const state = subscriptionState(
    !subscriptions.has_more && live.length === 1 ? live[0] : null,
    billingConfig(),
  );
  const { data, error } = await db
    .from("workspace_billing")
    .update({ ...state, reconciled_at: new Date().toISOString() })
    .eq("stripe_customer_id", customerId)
    .eq("sync_revision", revision)
    .select("workspace_id");
  if (error || data?.length !== 1)
    throw new Error("Subscription sync failed or superseded; retry");
  return true;
}
