import type Stripe from "stripe";
import { getAdminClient } from "@/lib/supabase/admin";
import { BillingRequestError } from "./account";
import { billingConfig } from "./config";
import { ensureBillingCustomer } from "./customer";
import { getStripe } from "./stripe";
import { reconcileCustomer } from "./subscriptions";

const terminal = (status: string) =>
  ["canceled", "incomplete_expired"].includes(status);
const conflict = () =>
  new BillingRequestError(
    "Manage the existing subscription or contact support",
    409,
  );

/** Requires a verified active owner; checkout choices are exclusively server-owned. */
export async function beginCheckout(account: {
  userId: string;
  workspaceId: string;
}): Promise<string> {
  const customer = await ensureBillingCustomer(account.workspaceId);
  if (!(await reconcileCustomer(customer))) throw conflict();
  const stripe = getStripe();
  // A denied local state can mean ambiguous subscriptions, not just no subscription.
  const subscriptions = await stripe.subscriptions.list({
    customer,
    status: "all",
    limit: 100,
  });
  if (
    subscriptions.has_more ||
    subscriptions.data.some((s) => !terminal(s.status))
  )
    throw conflict();
  const db = getAdminClient();
  const config = billingConfig();
  let previous: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const {
      data: claim,
      error,
    }: {
      data: { checkout_key: string; checkout_session_id?: string } | null;
      error: unknown;
    } = await db.rpc("claim_checkout", {
      p_workspace: account.workspaceId,
      p_user_id: account.userId,
      p_previous: previous,
    });
    if (error || !claim?.checkout_key) throw conflict();
    const key = claim.checkout_key as string;
    let session: Stripe.Checkout.Session | null = claim.checkout_session_id
      ? await stripe.checkout.sessions.retrieve(claim.checkout_session_id)
      : null;
    if (!session) {
      // Recover a successful Stripe creation even if saving its ID failed, including
      // retries after Stripe's 24-hour idempotency retention window.
      const sessions = await stripe.checkout.sessions.list({
        customer,
        limit: 100,
      });
      session =
        sessions.data.find((s) => s.client_reference_id === key) ?? null;
      if (!session && sessions.has_more) throw conflict();
    }
    if (session) {
      const sessionCustomer =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
      if (sessionCustomer !== customer || session.client_reference_id !== key)
        throw new Error("Checkout ownership mismatch");
      if (session.status !== "open") {
        if (session.status === "complete") {
          const id =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription?.id;
          if (
            !id ||
            !terminal((await stripe.subscriptions.retrieve(id)).status)
          )
            throw conflict();
        } else if (session.status !== "expired") throw conflict();
        previous = key;
        continue;
      }
    } else {
      session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer,
          client_reference_id: key,
          line_items: [{ price: config.priceId, quantity: 1 }],
          success_url: `${config.origin}/settings/billing?checkout=success`,
          cancel_url: `${config.origin}/settings/billing`,
          metadata: { workspace_id: account.workspaceId },
          subscription_data: {
            metadata: { workspace_id: account.workspaceId },
          },
        },
        { idempotencyKey: `signal-checkout:${key}` },
      );
    }
    if (!session.url) throw new Error("Checkout URL unavailable");
    const saved = await db
      .from("workspace_billing")
      .update({ checkout_session_id: session.id })
      .eq("workspace_id", account.workspaceId)
      .eq("checkout_key", key)
      .select("workspace_id");
    if (saved.error || saved.data?.length !== 1)
      throw new Error("Checkout changed; retry");
    return session.url;
  }
  throw conflict();
}
