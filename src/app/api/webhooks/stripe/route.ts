import type Stripe from "stripe";
import { isHostedMode } from "@/lib/auth/workspace";
import { stripeConnectionConfig } from "@/lib/billing/prepaid-config";
import { getStripe } from "@/lib/billing/stripe";
import { processBillingEvent } from "@/lib/billing/events";

export const runtime = "nodejs";
async function boundedBody(request: Request): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) return Buffer.concat(chunks, size);
    size += value.byteLength;
    if (size > 1_000_000) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

export async function POST(request: Request) {
  if (!isHostedMode()) return new Response(null, { status: 404 });
  const raw = await boundedBody(request);
  if (raw === null) return new Response(null, { status: 413 });
  const stripe = getStripe();
  const secret = stripeConnectionConfig().webhookSecret;
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
  } catch (error) {
    console.error("Stripe webhook processing failed", {
      eventId: event.id,
      eventType: event.type,
      reason:
        error instanceof Error ? error.message : "Unknown processing failure",
    });
    // Stripe retries non-2xx deliveries; the durable inbox stays pending.
    return Response.json(
      { error: "Billing processing failed; retry" },
      { status: 500 },
    );
  }
}
