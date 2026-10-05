import type Stripe from "stripe";
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  reconcile: vi.fn(),
  hold: vi.fn(),
}));
vi.mock("@/lib/billing/subscriptions", () => ({
  reconcileCustomer: h.reconcile,
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
const event = (type = "invoice.paid") =>
  ({
    id: "evt_test",
    type,
    data: { object: { customer: "cus_test", charge: "ch_test" } },
  }) as unknown as Stripe.Event;
beforeEach(() => {
  h.rows.clear();
  vi.clearAllMocks();
  h.reconcile.mockResolvedValue(true);
});
it("durably deduplicates completed deliveries", async () => {
  await processBillingEvent(event());
  await processBillingEvent(event());
  expect(h.reconcile).toHaveBeenCalledTimes(1);
  expect(h.rows.get("evt_test")?.processed_at).toEqual(expect.any(String));
});
it("leaves failed events pending so retries can reconcile", async () => {
  h.reconcile.mockRejectedValueOnce(new Error("provider unavailable"));
  await expect(processBillingEvent(event())).rejects.toThrow(
    "provider unavailable",
  );
  expect(h.rows.get("evt_test")?.processed_at).toBeNull();
  await processBillingEvent(event());
  expect(h.reconcile).toHaveBeenCalledTimes(2);
});
it.each([
  "charge.refunded",
  "charge.dispute.created",
  "radar.early_fraud_warning.created",
])("holds access before reconciling %s", async (type) => {
  await processBillingEvent(event(type));
  expect(h.hold).toHaveBeenCalledWith({ risk_hold: true }, "cus_test");
  expect(h.hold.mock.invocationCallOrder[0]).toBeLessThan(
    h.reconcile.mock.invocationCallOrder[0],
  );
});
it("ignores a refunded non-customer charge without retrying forever", async () => {
  const refund = {
    id: "evt_refund",
    type: "charge.refunded",
    data: { object: { id: "ch_other", customer: null } },
  } as unknown as Stripe.Event;
  await expect(processBillingEvent(refund)).resolves.toBeUndefined();
  expect(h.reconcile).not.toHaveBeenCalled();
  expect(h.rows.size).toBe(0);
});
