import type Stripe from "stripe";
import { getAdminClient } from "@/lib/supabase/admin";
import { BillingRequestError } from "./account";
import { prepaidConfig, stripeConnectionConfig } from "./prepaid-config";
import { ensureBillingCustomer } from "./customer";
import { findCheckoutSession } from "./checkout-history";
import { fulfillCreditSession, type CreditOrder } from "./prepaid-fulfillment";
import { getStripe } from "./stripe";

/** Call with the verified active owner; request bodies never supply pack terms. */
export async function beginPrepaidCheckout(account: {
  userId: string;
  workspaceId: string;
}): Promise<string> {
  const customer = await ensureBillingCustomer(account.workspaceId);
  const stripe = getStripe();
  const pack = prepaidConfig();
  const price = await stripe.prices.retrieve(pack.priceId);
  if (
    !price.active ||
    price.type !== "one_time" ||
    price.unit_amount == null ||
    !Number.isSafeInteger(price.unit_amount) ||
    price.unit_amount < 1 ||
    price.unit_amount > 99_999_999
  )
    throw new Error("Configure an active fixed one-time credit price");
  const db = getAdminClient();
  let previous: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const claim = await db.rpc("claim_credit_order", {
      p_workspace: account.workspaceId,
      p_user: account.userId,
      p_price: pack.priceId,
      p_credits: pack.credits,
      p_version: pack.rateVersion,
      p_amount: price.unit_amount,
      p_currency: price.currency,
      p_previous: previous,
    });
    if (claim.error || !claim.data)
      throw new BillingRequestError(
        "Credit checkout unavailable; account may need review",
        409,
      );
    const order = claim.data as CreditOrder;
    if (
      order.workspace_id !== account.workspaceId ||
      order.customer_id !== customer
    )
      throw new Error("Credit order ownership mismatch");
    let session: Stripe.Checkout.Session | null = order.session_id
      ? await stripe.checkout.sessions.retrieve(order.session_id)
      : await findCheckoutSession(customer, order.id);
    if (session) {
      const owner =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
      if (
        owner !== customer ||
        session.client_reference_id !== order.id ||
        session.mode !== "payment"
      )
        throw new Error("Checkout ownership mismatch");
      if (session.status === "expired") {
        previous = order.id;
        continue;
      }
      if (session.status === "complete") {
        const state = await fulfillCreditSession(
          session.id,
          account.workspaceId,
        );
        if (state !== "paid" && state !== "failed")
          throw new BillingRequestError(
            "Payment is pending or needs review; refresh your credit balance",
            409,
          );
        previous = null; // Fulfillment closes the old order; a deliberate top-up gets a new one.
        continue;
      }
      if (session.status !== "open")
        throw new Error("Checkout state unavailable");
    } else {
      const frozenPrice =
        order.price_id === price.id
          ? price
          : await stripe.prices.retrieve(order.price_id);
      if (!frozenPrice.active)
        throw new BillingRequestError(
          "This pending top-up needs price recovery; contact support",
          409,
        );
      const { origin } = stripeConnectionConfig();
      session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer,
          client_reference_id: order.id,
          line_items: [{ price: order.price_id, quantity: 1 }],
          success_url: `${origin}/settings/billing?checkout=success`,
          cancel_url: `${origin}/settings/billing`,
          metadata: {
            workspace_id: account.workspaceId,
            credit_order_id: order.id,
          },
          payment_intent_data: { metadata: { credit_order_id: order.id } },
        },
        { idempotencyKey: `signal-credit-order:${order.id}` },
      );
    }
    if (!session.url) throw new Error("Checkout URL unavailable");
    const saved = await db
      .from("credit_orders")
      .update({ session_id: session.id })
      .eq("id", order.id)
      .eq("workspace_id", account.workspaceId)
      .is("session_id", null)
      .select("id");
    if (saved.error) throw new Error("Cannot save credit checkout; retry");
    if (saved.data?.length !== 1) {
      const existing = await db
        .from("credit_orders")
        .select("session_id")
        .eq("id", order.id)
        .single();
      if (existing.error || existing.data?.session_id !== session.id)
        throw new Error("Credit checkout changed; retry");
    }
    return session.url;
  }
  throw new BillingRequestError("Checkout changed; please retry", 409);
}
