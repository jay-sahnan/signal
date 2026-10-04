import type Stripe from "stripe";
import { expect, it } from "vitest";
import { subscriptionState } from "@/lib/billing/subscription-state";

const config = {
  priceId: "price_test",
  planVersion: "v1",
  monthlyUnits: 100,
  monitorLimit: 5,
};
const subscription = (patch: Record<string, unknown> = {}) =>
  ({
    id: "sub_test",
    status: "active",
    cancel_at_period_end: false,
    pause_collection: null,
    latest_invoice: { status: "paid" },
    items: {
      data: [
        {
          quantity: 1,
          price: {
            id: "price_test",
            recurring: { interval: "month", interval_count: 1 },
          },
          current_period_start: 1_780_000_000,
          current_period_end: 1_782_592_000,
        },
      ],
    },
    ...patch,
  }) as unknown as Stripe.Subscription;

it("retains access through a paid period scheduled for cancellation", () => {
  expect(
    subscriptionState(subscription({ cancel_at_period_end: true }), config),
  ).toMatchObject({
    status: "active",
    cancel_at_period_end: true,
    monthly_units: 100,
  });
});
it.each(["past_due", "canceled", "paused", "unpaid", "incomplete", "trialing"])(
  "does not turn %s into paid access",
  (status) => {
    expect(subscriptionState(subscription({ status }), config).status).toBe(
      status,
    );
  },
);
it("denies active status without a paid invoice or with paused collection", () => {
  expect(
    subscriptionState(
      subscription({ latest_invoice: { status: "open" } }),
      config,
    ).status,
  ).toBe("incomplete");
  expect(
    subscriptionState(
      subscription({ pause_collection: { behavior: "void" } }),
      config,
    ).status,
  ).toBe("paused");
});
it("rejects unknown prices and multiple subscription items", () => {
  expect(
    subscriptionState(subscription(), { ...config, priceId: "price_other" })
      .status,
  ).toBe("none");
  const s = subscription();
  s.items.data.push(s.items.data[0]);
  expect(subscriptionState(s, config).status).toBe("none");
});
it("represents missing subscriptions without access", () => {
  expect(subscriptionState(null, config)).toMatchObject({
    status: "none",
    monthly_units: 0,
    period_end: null,
  });
});
