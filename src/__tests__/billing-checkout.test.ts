import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  subscriptions: vi.fn(),
  sessions: vi.fn(),
  retrieve: vi.fn(),
  create: vi.fn(),
  subscription: vi.fn(),
  claim: vi.fn(),
  save: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("@/lib/billing/config", () => ({
  billingConfig: () => ({
    origin: "https://signal.test",
    priceId: "price_fixed",
  }),
}));
vi.mock("@/lib/billing/customer", () => ({
  ensureBillingCustomer: async () => "cus_owned",
}));
vi.mock("@/lib/billing/subscriptions", () => ({
  reconcileCustomer: h.reconcile,
}));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({
    subscriptions: { list: h.subscriptions, retrieve: h.subscription },
    checkout: {
      sessions: { list: h.sessions, retrieve: h.retrieve, create: h.create },
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: h.claim,
    from: () => ({
      update: () => ({ eq: () => ({ eq: () => ({ select: h.save }) }) }),
    }),
  }),
}));
import { beginCheckout } from "@/lib/billing/checkout";
const account = { userId: "owner", workspaceId: "workspace" };
const session = {
  id: "cs_one",
  customer: "cus_owned",
  client_reference_id: "key",
  status: "open",
  url: "https://checkout.stripe.com/one",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.reconcile.mockResolvedValue(true);
  h.subscriptions.mockResolvedValue({ data: [], has_more: false });
  h.sessions.mockResolvedValue({ data: [], has_more: false });
  h.claim.mockResolvedValue({
    data: { checkout_key: "key", checkout_session_id: null },
    error: null,
  });
  h.save.mockResolvedValue({
    data: [{ workspace_id: "workspace" }],
    error: null,
  });
  h.create.mockResolvedValue(session);
});
it("uses the server's price, customer, return URLs and durable idempotency key", async () => {
  expect(await beginCheckout(account)).toBe(session.url);
  expect(h.create).toHaveBeenCalledWith(
    expect.objectContaining({
      customer: "cus_owned",
      mode: "subscription",
      client_reference_id: "key",
      line_items: [{ price: "price_fixed", quantity: 1 }],
      success_url: "https://signal.test/settings/billing?checkout=success",
      cancel_url: "https://signal.test/settings/billing",
    }),
    { idempotencyKey: "signal-checkout:key" },
  );
});
it.each(["active", "incomplete", "past_due", "paused"])(
  "blocks another checkout for %s subscriptions",
  async (status) => {
    h.subscriptions.mockResolvedValue({ data: [{ status }], has_more: false });
    await expect(beginCheckout(account)).rejects.toThrow(
      "Manage the existing subscription",
    );
    expect(h.create).not.toHaveBeenCalled();
  },
);
it("refuses truncated history rather than assuming no active subscription", async () => {
  h.subscriptions.mockResolvedValue({ data: [], has_more: true });
  await expect(beginCheckout(account)).rejects.toThrow(
    "Manage the existing subscription",
  );
});
it("recovers a session created before a failed local save", async () => {
  h.sessions.mockResolvedValue({ data: [session], has_more: false });
  expect(await beginCheckout(account)).toBe(session.url);
  expect(h.create).not.toHaveBeenCalled();
});
it("rotates an expired session with compare-and-swap before creating", async () => {
  h.sessions.mockResolvedValueOnce({
    data: [{ ...session, status: "expired" }],
    has_more: false,
  });
  h.claim
    .mockResolvedValueOnce({ data: { checkout_key: "key" } })
    .mockResolvedValueOnce({ data: { checkout_key: "next" } });
  await beginCheckout(account);
  expect(h.claim).toHaveBeenLastCalledWith("claim_checkout", {
    p_workspace: "workspace",
    p_user_id: "owner",
    p_previous: "key",
  });
  expect(h.create.mock.calls[0][1]).toEqual({
    idempotencyKey: "signal-checkout:next",
  });
});
it("does not rotate a completed session with a still-live subscription", async () => {
  h.sessions.mockResolvedValue({
    data: [{ ...session, status: "complete", subscription: "sub_one" }],
    has_more: false,
  });
  h.subscription.mockResolvedValue({ status: "active" });
  await expect(beginCheckout(account)).rejects.toThrow(
    "Manage the existing subscription",
  );
  expect(h.create).not.toHaveBeenCalled();
});
it("rejects a stored session belonging to another customer", async () => {
  h.claim.mockResolvedValue({
    data: { checkout_key: "key", checkout_session_id: "cs_other" },
  });
  h.retrieve.mockResolvedValue({ ...session, customer: "cus_other" });
  await expect(beginCheckout(account)).rejects.toThrow(
    "Checkout ownership mismatch",
  );
});
it("does not create when reconciliation or the ownership claim fails", async () => {
  h.claim.mockResolvedValue({ data: null, error: { message: "denied" } });
  await expect(beginCheckout(account)).rejects.toThrow();
  expect(h.create).not.toHaveBeenCalled();
});
it("leaves failed Stripe requests retryable with the same checkout key", async () => {
  h.create.mockRejectedValueOnce(new Error("Stripe unavailable"));
  await expect(beginCheckout(account)).rejects.toThrow("Stripe unavailable");
  expect(await beginCheckout(account)).toBe(session.url);
  expect(h.create.mock.calls[0]).toEqual(h.create.mock.calls[1]);
});
it("refuses to guess when session history is truncated", async () => {
  h.sessions.mockResolvedValue({ data: [], has_more: true });
  await expect(beginCheckout(account)).rejects.toThrow();
  expect(h.create).not.toHaveBeenCalled();
});
it("does not return a checkout URL if its durable claim changed", async () => {
  h.save.mockResolvedValue({ data: [], error: null });
  await expect(beginCheckout(account)).rejects.toThrow("Checkout changed");
});
