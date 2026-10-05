import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  price: vi.fn(),
  claim: vi.fn(),
  find: vi.fn(),
  retrieve: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  fulfill: vi.fn(),
}));
vi.mock("@/lib/billing/prepaid-config", () => ({
  prepaidConfig: () => ({
    priceId: "price_current",
    credits: 200,
    rateVersion: "v2",
  }),
  stripeConnectionConfig: () => ({ origin: "https://signal.test" }),
}));
vi.mock("@/lib/billing/customer", () => ({
  ensureBillingCustomer: async () => "cus_owner",
}));
vi.mock("@/lib/billing/checkout-history", () => ({
  findCheckoutSession: h.find,
}));
vi.mock("@/lib/billing/prepaid-fulfillment", () => ({
  fulfillCreditSession: h.fulfill,
}));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({
    prices: { retrieve: h.price },
    checkout: { sessions: { retrieve: h.retrieve, create: h.create } },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: h.claim,
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => ({ is: () => ({ select: h.save }) }) }),
      }),
      select: () => ({ eq: () => ({ single: h.read }) }),
    }),
  }),
}));
import { beginPrepaidCheckout } from "@/lib/billing/prepaid-checkout";
const account = { userId: "owner", workspaceId: "workspace" };
const order = {
  id: "order",
  workspace_id: "workspace",
  customer_id: "cus_owner",
  price_id: "price_original",
  credits: 100,
  rate_version: "v1",
  amount: 1000,
  currency: "usd",
  state: "pending",
  session_id: null,
};
const session = {
  id: "cs_owned",
  customer: "cus_owner",
  client_reference_id: "order",
  mode: "payment",
  status: "open",
  url: "https://checkout.stripe.com/owned",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.price.mockResolvedValue({
    active: true,
    type: "one_time",
    unit_amount: 1000,
    currency: "usd",
  });
  h.claim.mockResolvedValue({ data: order, error: null });
  h.find.mockResolvedValue(null);
  h.create.mockResolvedValue(session);
  h.save.mockResolvedValue({ data: [{ id: "order" }], error: null });
  h.fulfill.mockResolvedValue("paid");
});
it("creates one-time checkout using frozen order terms and a durable key", async () => {
  expect(await beginPrepaidCheckout(account)).toBe(session.url);
  expect(h.create).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "payment",
      customer: "cus_owner",
      client_reference_id: "order",
      line_items: [{ price: "price_original", quantity: 1 }],
      success_url: "https://signal.test/settings/billing?checkout=success",
    }),
    { idempotencyKey: "signal-credit-order:order" },
  );
  expect(h.create.mock.calls[0][0]).not.toHaveProperty("subscription_data");
});
it("rejects a recurring Stripe price before claiming an order", async () => {
  h.price.mockResolvedValue({
    active: true,
    type: "recurring",
    unit_amount: 1000,
  });
  await expect(beginPrepaidCheckout(account)).rejects.toThrow("one-time");
  expect(h.claim).not.toHaveBeenCalled();
});
it("recovers a lost successful checkout response", async () => {
  h.find.mockResolvedValue(session);
  expect(await beginPrepaidCheckout(account)).toBe(session.url);
  expect(h.create).not.toHaveBeenCalled();
});
it("requires completion of a pending payment before another top-up", async () => {
  h.find.mockResolvedValue({ ...session, status: "complete" });
  h.fulfill.mockResolvedValue("pending");
  await expect(beginPrepaidCheckout(account)).rejects.toThrow("pending");
  expect(h.create).not.toHaveBeenCalled();
});
it("fulfills a paid checkout before starting a deliberate new top-up", async () => {
  h.find.mockResolvedValueOnce({ ...session, status: "complete" });
  h.claim
    .mockResolvedValueOnce({ data: order })
    .mockResolvedValueOnce({ data: { ...order, id: "next" } });
  await beginPrepaidCheckout(account);
  expect(h.fulfill).toHaveBeenCalledWith("cs_owned", "workspace");
  expect(h.create.mock.calls[0][1]).toEqual({
    idempotencyKey: "signal-credit-order:next",
  });
});
it("rotates only the order whose session expired", async () => {
  h.find.mockResolvedValueOnce({ ...session, status: "expired" });
  await beginPrepaidCheckout(account);
  expect(h.claim.mock.calls[1][1].p_previous).toBe("order");
});
it("rejects a checkout session owned by another customer", async () => {
  h.find.mockResolvedValue({ ...session, customer: "cus_other" });
  await expect(beginPrepaidCheckout(account)).rejects.toThrow(
    "ownership mismatch",
  );
});
it("accepts a concurrent identical session binding without overwriting it", async () => {
  h.save.mockResolvedValue({ data: [], error: null });
  h.read.mockResolvedValue({ data: { session_id: "cs_owned" }, error: null });
  expect(await beginPrepaidCheckout(account)).toBe(session.url);
});

it("reports an archived frozen price without replacing the pending order", async () => {
  h.price
    .mockResolvedValueOnce({
      active: true,
      type: "one_time",
      unit_amount: 1000,
      currency: "usd",
    })
    .mockResolvedValueOnce({ active: false });
  await expect(beginPrepaidCheckout(account)).rejects.toThrow(
    "contact support",
  );
  expect(h.claim).toHaveBeenCalledTimes(1);
  expect(h.create).not.toHaveBeenCalled();
});
