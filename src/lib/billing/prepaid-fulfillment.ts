import { getAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "./stripe";

export type CreditOrder = {
  id: string;
  workspace_id: string;
  customer_id: string;
  price_id: string;
  credits: number;
  rate_version: string;
  amount: number;
  currency: string;
  state: "pending" | "paid" | "expired" | "failed";
  session_id: string | null;
};
const idOf = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id;

/** Retrieve current Stripe state; never grant from an event snapshot or redirect. */
export async function fulfillCreditSession(
  sessionId: string,
  workspaceId?: string,
) {
  const session = await getStripe().checkout.sessions.retrieve(sessionId, {
    expand: ["line_items", "payment_intent.latest_charge"],
  });
  const reference = session.client_reference_id;
  if (
    !reference ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      reference,
    )
  )
    return "ignored";
  const db = getAdminClient();
  const { data, error } = await db
    .from("credit_orders")
    .select("*")
    .eq("id", reference)
    .maybeSingle();
  if (error) throw new Error("Credit order unavailable");
  if (!data) return "ignored";
  const order = data as CreditOrder;
  if (
    (workspaceId && order.workspace_id !== workspaceId) ||
    (order.session_id && order.session_id !== session.id) ||
    session.mode !== "payment" ||
    idOf(session.customer) !== order.customer_id
  )
    throw new Error("Checkout does not match credit order");
  if (session.payment_status !== "paid") {
    const intent = session.payment_intent;
    const failed =
      session.status === "complete" &&
      intent &&
      typeof intent !== "string" &&
      ["canceled", "requires_payment_method"].includes(intent.status);
    const state =
      session.status === "expired" ? "expired" : failed ? "failed" : null;
    if (!state) return "pending";
    const closed = await db.rpc("close_credit_order", {
      p_order: order.id,
      p_session: session.id,
      p_state: state,
    });
    if (closed.error) throw new Error("Cannot close unpaid checkout; retry");
    return state;
  }
  const line = session.line_items?.data[0];
  const payment = session.payment_intent;
  if (
    !line ||
    session.line_items?.has_more ||
    session.line_items?.data.length !== 1 ||
    line.quantity !== 1 ||
    line.price?.id !== order.price_id ||
    session.amount_total !== Number(order.amount) ||
    session.currency !== order.currency ||
    !payment ||
    typeof payment === "string" ||
    payment.status !== "succeeded" ||
    idOf(payment.customer) !== order.customer_id ||
    payment.amount_received !== Number(order.amount) ||
    payment.currency !== order.currency
  )
    throw new Error("Settled payment does not match credit order");
  const charge = payment.latest_charge;
  if (!charge || typeof charge === "string" || !charge.paid)
    throw new Error("Settled charge unavailable");
  if (charge.refunded || charge.amount_refunded > 0 || charge.disputed) {
    const hold = await db
      .from("workspace_billing")
      .update({ risk_hold: true })
      .eq("workspace_id", order.workspace_id);
    if (hold.error) throw new Error("Cannot hold refunded credit purchase");
    console.warn("Credit purchase requires payment review", {
      orderId: order.id,
    });
    return "held";
  }
  const credited = await db.rpc("fulfill_credit_order", {
    p_order: order.id,
    p_session: session.id,
    p_payment: payment.id,
    p_amount: session.amount_total,
    p_currency: session.currency,
  });
  if (credited.error || !credited.data)
    throw new Error("Cannot fulfill credit purchase; retry");
  return "paid";
}
