import type Stripe from "stripe";
import { isHostedMode } from "@/lib/auth/workspace";
import { billingConfig } from "@/lib/billing/config";
import { getStripe } from "@/lib/billing/stripe";
import { processBillingEvent } from "@/lib/billing/events";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!isHostedMode()) return new Response(null, { status: 404 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 1_000_000)
    return new Response(null, { status: 413 });
  const stripe = getStripe();
  const secret = billingConfig().webhookSecret;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      raw,
      request.headers.get("stripe-signature") ?? "",
      secret,
    );
  } catch {
    return Response.json(
      { error: "Invalid webhook signature" },
      { status: 400 },
    );
  }
  try {
    await processBillingEvent(event);
    return Response.json({ received: true });
  } catch {
    // Stripe retries non-2xx deliveries; the durable inbox stays pending.
    return Response.json(
      { error: "Billing processing failed; retry" },
      { status: 500 },
    );
  }
}
