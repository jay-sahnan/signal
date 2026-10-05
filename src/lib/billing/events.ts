import type Stripe from "stripe";
import { getAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "./stripe";
import { fulfillCreditSession } from "./prepaid-fulfillment";

const riskEvents = new Set([
  "charge.refunded",
  "charge.dispute.created",
  "radar.early_fraud_warning.created",
]);
const checkoutEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);
const objectId = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;

/** Accept only SDK-verified events. Keep raw payment data out of local storage. */
export async function processBillingEvent(event: Stripe.Event): Promise<void> {
  const risk = riskEvents.has(event.type);
  const checkout = checkoutEvents.has(event.type);
  if (!risk && !checkout) return;
  const object = event.data.object as unknown as {
    id: string;
    customer?: string | { id: string };
    charge?: string | { id: string };
  };
  let customerId = objectId(object.customer);
  if (!customerId && event.type === "charge.refunded") return;
  if (!customerId && risk) {
    const chargeId = objectId(object.charge);
    if (!chargeId) throw new Error("Risk event has no charge");
    customerId = objectId(
      (await getStripe().charges.retrieve(chargeId)).customer,
    );
  }
  if (!customerId) {
    if (checkout) await fulfillCreditSession(object.id);
    return; // Non-customer charges outside Signal billing.
  }
  const db = getAdminClient();
  const { error: insertError } = await db.from("billing_events").upsert(
    {
      id: event.id,
      event_type: event.type,
      customer_id: customerId,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (insertError) throw new Error("Cannot persist billing event");
  const { data: existing, error: readError } = await db
    .from("billing_events")
    .select("processed_at")
    .eq("id", event.id)
    .single();
  if (readError || !existing) throw new Error("Cannot read billing event");
  if (existing.processed_at) return;
  if (risk) {
    const { error } = await db
      .from("workspace_billing")
      .update({ risk_hold: true })
      .eq("stripe_customer_id", customerId);
    if (error) throw new Error("Cannot apply billing hold");
  }
  if (checkout) await fulfillCreditSession(object.id);
  const { error } = await db
    .from("billing_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", event.id);
  if (error) throw new Error("Cannot complete billing event");
}
