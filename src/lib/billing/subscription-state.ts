import type Stripe from "stripe";
import type { billingConfig } from "./config";

type Plan = Pick<
  ReturnType<typeof billingConfig>,
  "priceId" | "planVersion" | "monthlyUnits" | "monitorLimit"
>;

/** Build access state from a fresh Stripe response, never an event snapshot. */
export function subscriptionState(
  subscription: Stripe.Subscription | null,
  plan: Plan,
) {
  const denied = {
    stripe_subscription_id: subscription?.id ?? null,
    status: "none" as string,
    price_id: null as string | null,
    plan_version: null as string | null,
    period_start: null as string | null,
    period_end: null as string | null,
    monthly_units: 0,
    monitor_limit: 0,
    cancel_at_period_end: false,
  };
  const item = subscription?.items.data[0];
  if (
    !subscription ||
    !item ||
    subscription.items.data.length !== 1 ||
    item.price.id !== plan.priceId ||
    item.quantity !== 1 ||
    item.price.recurring?.interval !== "month" ||
    item.price.recurring.interval_count !== 1 ||
    !Number.isFinite(item.current_period_start) ||
    !Number.isFinite(item.current_period_end) ||
    item.current_period_end <= item.current_period_start
  )
    return denied;
  const invoice = subscription.latest_invoice;
  const paid = typeof invoice === "object" && invoice?.status === "paid";
  const status = subscription.pause_collection
    ? "paused"
    : subscription.status === "active" && !paid
      ? "incomplete"
      : subscription.status;
  return {
    ...denied,
    status,
    price_id: plan.priceId,
    plan_version: plan.planVersion,
    period_start: new Date(item.current_period_start * 1000).toISOString(),
    period_end: new Date(item.current_period_end * 1000).toISOString(),
    monthly_units: plan.monthlyUnits,
    monitor_limit: plan.monitorLimit,
    cancel_at_period_end: subscription.cancel_at_period_end,
  };
}
