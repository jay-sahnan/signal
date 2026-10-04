import type Stripe from "stripe";
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  fulfill: vi.fn(),
  hold: vi.fn(),
}));
vi.mock("@/lib/billing/prepaid-fulfillment", () => ({
  fulfillCreditSession: h.fulfill,
}));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({
    charges: { retrieve: async () => ({ customer: "cus_test" }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>) => {
        if (!h.rows.has(row.id as string))
          h.rows.set(row.id as string, { ...row, processed_at: null });
        return { error: null };
      },
      select: () => ({
        eq: (_: string, id: string) => ({
          single: async () => ({ data: h.rows.get(id), error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async (_: string, id: string) => {
          if (table === "workspace_billing") h.hold(patch, id);
          else Object.assign(h.rows.get(id)!, patch);
          return { error: null };
        },
      }),
    }),
  }),
}));
import { processBillingEvent } from "@/lib/billing/events";
const event = (type = "checkout.session.completed") =>
  ({
    id: "evt_test",
    type,
    data: {
      object: { id: "cs_test", customer: "cus_test", charge: "ch_test" },
    },
  }) as unknown as Stripe.Event;
beforeEach(() => {
  h.rows.clear();
  vi.clearAllMocks();
  h.fulfill.mockResolvedValue(true);
});
it("durably deduplicates completed deliveries", async () => {
  await processBillingEvent(event());
  await processBillingEvent(event());
  expect(h.fulfill).toHaveBeenCalledTimes(1);
  expect(h.rows.get("evt_test")?.processed_at).toEqual(expect.any(String));
});
it("leaves failed events pending so retries can fulfill", async () => {
  h.fulfill.mockRejectedValueOnce(new Error("provider unavailable"));
  await expect(processBillingEvent(event())).rejects.toThrow(
    "provider unavailable",
  );
  expect(h.rows.get("evt_test")?.processed_at).toBeNull();
  await processBillingEvent(event());
  expect(h.fulfill).toHaveBeenCalledTimes(2);
});
it.each([
  "charge.refunded",
  "charge.dispute.created",
  "radar.early_fraud_warning.created",
])("holds access without monthly configuration for %s", async (type) => {
  await processBillingEvent(event(type));
  expect(h.hold).toHaveBeenCalledWith({ risk_hold: true }, "cus_test");
  expect(h.fulfill).not.toHaveBeenCalled();
});
it("ignores a refunded non-customer charge without retrying forever", async () => {
  const refund = {
    id: "evt_refund",
    type: "charge.refunded",
    data: { object: { id: "ch_other", customer: null } },
  } as unknown as Stripe.Event;
  await expect(processBillingEvent(refund)).resolves.toBeUndefined();
  expect(h.fulfill).not.toHaveBeenCalled();
  expect(h.rows.size).toBe(0);
});

it("handles delayed settlement using fresh payment verification", async () => {
  await processBillingEvent(event("checkout.session.async_payment_succeeded"));
  expect(h.fulfill).toHaveBeenCalledWith("cs_test");
});
it("acknowledges an unpaid completion without preventing later success", async () => {
  h.fulfill.mockResolvedValueOnce("pending").mockResolvedValueOnce("paid");
  await processBillingEvent(event());
  await processBillingEvent({
    ...event("checkout.session.async_payment_succeeded"),
    id: "evt_later",
  });
  expect(h.fulfill).toHaveBeenCalledTimes(2);
});
it("ignores old subscription events in prepaid mode", async () => {
  await processBillingEvent(event("invoice.paid"));
  expect(h.fulfill).not.toHaveBeenCalled();
  expect(h.rows.size).toBe(0);
});

it("lets fresh verification ignore unrelated customerless checkout", async () => {
  h.fulfill.mockResolvedValueOnce("ignored");
  const unrelated = event();
  Object.assign(unrelated.data.object, { customer: null });
  await expect(processBillingEvent(unrelated)).resolves.toBeUndefined();
  expect(h.fulfill).toHaveBeenCalledWith("cs_test");
  expect(h.rows.size).toBe(0);
});
it("still rejects a customerless checkout referencing a known order", async () => {
  h.fulfill.mockRejectedValueOnce(
    new Error("Checkout does not match credit order"),
  );
  const invalid = event();
  Object.assign(invalid.data.object, { customer: null });
  await expect(processBillingEvent(invalid)).rejects.toThrow("does not match");
});
