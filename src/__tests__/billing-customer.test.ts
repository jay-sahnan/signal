import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  customer: null as string | null,
  create: vi.fn(),
  saveError: false,
}));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ customers: { create: h.create } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      upsert: async () => ({ error: null }),
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { stripe_customer_id: h.customer },
            error: null,
          }),
        }),
      }),
      update: (row: { stripe_customer_id: string }) => ({
        eq: () => ({
          is: async () => {
            if (h.saveError)
              return { error: new Error("database unavailable") };
            h.customer ??= row.stripe_customer_id;
            return { error: null };
          },
        }),
      }),
    }),
  }),
}));
import { ensureBillingCustomer } from "@/lib/billing/customer";
beforeEach(() => {
  h.customer = null;
  h.saveError = false;
  vi.clearAllMocks();
  h.create.mockResolvedValue({ id: "cus_created" });
});
it("reuses the durable customer without contacting Stripe", async () => {
  h.customer = "cus_existing";
  expect(await ensureBillingCustomer("workspace")).toBe("cus_existing");
  expect(h.create).not.toHaveBeenCalled();
});
it("uses the same server-owned idempotency key for concurrent creation", async () => {
  expect(
    await Promise.all([
      ensureBillingCustomer("workspace"),
      ensureBillingCustomer("workspace"),
    ]),
  ).toEqual(["cus_created", "cus_created"]);
  for (const args of h.create.mock.calls)
    expect(args).toEqual([
      { metadata: { workspace_id: "workspace" } },
      { idempotencyKey: "signal-customer:workspace" },
    ]);
});
it("does not bind failed creation and reuses its key on retry", async () => {
  h.create.mockRejectedValueOnce(new Error("Stripe unavailable"));
  await expect(ensureBillingCustomer("workspace")).rejects.toThrow(
    "Stripe unavailable",
  );
  expect(h.customer).toBeNull();
  expect(await ensureBillingCustomer("workspace")).toBe("cus_created");
  expect(h.create.mock.calls[0]).toEqual(h.create.mock.calls[1]);
});

it("recovers a successful Stripe creation after a failed database save", async () => {
  h.saveError = true;
  await expect(ensureBillingCustomer("workspace")).rejects.toThrow(
    "Cannot save billing customer",
  );
  expect(h.customer).toBeNull();
  h.saveError = false;
  expect(await ensureBillingCustomer("workspace")).toBe("cus_created");
  expect(h.create.mock.calls[0]).toEqual(h.create.mock.calls[1]);
});
