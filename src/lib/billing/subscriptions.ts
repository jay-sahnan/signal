import { getAdminClient } from "@/lib/supabase/admin";
import { billingConfig } from "./config";
import { getStripe } from "./stripe";
import { subscriptionState } from "./subscription-state";

/** Serialize provider reads per customer; fence late workers after lease expiry. */
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
  try {
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
    if (live.length > 1)
      console.warn("Multiple live subscriptions require operator review", {
        customerId,
      });
    // Multiple live subscriptions are ambiguous: deny work until corrected.
    const state = subscriptionState(
      !subscriptions.has_more && live.length === 1 ? live[0] : null,
      billingConfig(),
    );
    const { data, error } = await db.rpc("finish_subscription_sync", {
      p_customer_id: customerId,
      p_revision: revision,
      p_state: state,
    });
    if (error || data !== true)
      throw new Error("Subscription sync failed or superseded; retry");
    return true;
  } finally {
    // Crashed workers recover through the lease timeout; late workers cannot
    // release another attempt's lease. Preserve the original provider failure.
    try {
      await db.rpc("release_subscription_sync", {
        p_customer_id: customerId,
        p_revision: revision,
      });
    } catch {
      /* Lease expiration is the recovery path. */
    }
  }
}
