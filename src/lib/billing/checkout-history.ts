import type Stripe from "stripe";
import { getStripe } from "./stripe";

/** Search all history pages; never infer absence from a truncated first page. */
export async function findCheckoutSession(
  customer: string,
  key: string,
): Promise<Stripe.Checkout.Session | null> {
  const stripe = getStripe();
  const cursors = new Set<string>();
  const deadline = Date.now() + 60_000;
  let cursor: string | undefined;
  do {
    if (Date.now() >= deadline)
      throw new Error("Checkout recovery timed out; contact support");
    const page: Stripe.ApiList<Stripe.Checkout.Session> =
      await stripe.checkout.sessions.list({
        customer,
        limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
      });
    const session = page.data.find(
      (candidate) => candidate.client_reference_id === key,
    );
    if (session) return session;
    if (!page.has_more) return null;
    cursor = page.data.at(-1)?.id;
    if (!cursor || cursors.has(cursor))
      throw new Error("Checkout history cursor did not advance");
    cursors.add(cursor);
  } while (true);
}
