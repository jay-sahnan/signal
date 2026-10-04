import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  retrieve: vi.fn(),
  fulfill: vi.fn(),
  hold: vi.fn(),
  order: null as Record<string, unknown> | null,
}));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { retrieve: h.retrieve } } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: h.fulfill,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: h.order, error: null }),
        }),
      }),
      update: (patch: unknown) => ({
        eq: async (_key: string, value: string) => {
          h.hold(patch, value);
          return { error: null };
        },
      }),
    }),
  }),
}));
import { fulfillCreditSession } from "@/lib/billing/prepaid-fulfillment";
const orderId = "11111111-1111-4111-8111-111111111111";
function paidSession() {
  return {
    id: "cs_paid",
    status: "complete",
    client_reference_id: orderId,
    mode: "payment",
    customer: "cus_owner",
    payment_status: "paid",
    amount_total: 1000,
    currency: "usd",
    line_items: {
      has_more: false,
      data: [{ quantity: 1, price: { id: "price_original" } }],
    },
    payment_intent: {
      id: "pi_paid",
      status: "succeeded",
      customer: "cus_owner",
      amount_received: 1000,
      currency: "usd",
      latest_charge: {
        id: "ch_paid",
        paid: true,
        refunded: false,
        amount_refunded: 0,
        disputed: false,
      },
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.order = {
    id: orderId,
    workspace_id: "workspace",
    customer_id: "cus_owner",
    price_id: "price_original",
    amount: 1000,
    currency: "usd",
    credits: 100,
    rate_version: "old-version",
  };
  h.retrieve.mockResolvedValue(paidSession());
  h.fulfill.mockResolvedValue({ data: "grant", error: null });
});
it("credits a freshly verified payment using its immutable order", async () => {
  expect(await fulfillCreditSession("cs_paid", "workspace")).toBe("paid");
  expect(h.retrieve).toHaveBeenCalledWith("cs_paid", {
    expand: ["line_items", "payment_intent.latest_charge"],
  });
  expect(h.fulfill).toHaveBeenCalledWith("fulfill_credit_order", {
    p_order: orderId,
    p_session: "cs_paid",
    p_payment: "pi_paid",
    p_amount: 1000,
    p_currency: "usd",
  });
});
it("does not grant credits for completed checkout whose payment is pending", async () => {
  const session = paidSession();
  session.payment_status = "unpaid";
  h.retrieve.mockResolvedValue(session);
  expect(await fulfillCreditSession("cs_paid")).toBe("pending");
  expect(h.fulfill).not.toHaveBeenCalled();
});
it.each(["customer", "price", "amount", "currency", "mode", "intent"])(
  "rejects a mismatched %s",
  async (field) => {
    const session = paidSession();
    if (field === "customer") session.customer = "cus_other";
    if (field === "price") session.line_items.data[0].price.id = "price_other";
    if (field === "amount") session.payment_intent.amount_received = 1;
    if (field === "currency") session.currency = "eur";
    if (field === "mode") session.mode = "subscription";
    if (field === "intent") session.payment_intent.status = "processing";
    h.retrieve.mockResolvedValue(session);
    await expect(fulfillCreditSession("cs_paid")).rejects.toThrow();
    expect(h.fulfill).not.toHaveBeenCalled();
  },
);
it("rejects another workspace's session during an owner refresh", async () => {
  await expect(
    fulfillCreditSession("cs_paid", "other-workspace"),
  ).rejects.toThrow();
  expect(h.fulfill).not.toHaveBeenCalled();
});
it("holds refunded or disputed purchases without minting credits", async () => {
  const session = paidSession();
  session.payment_intent.latest_charge.amount_refunded = 100;
  h.retrieve.mockResolvedValue(session);
  expect(await fulfillCreditSession("cs_paid")).toBe("held");
  expect(h.hold).toHaveBeenCalledWith({ risk_hold: true }, "workspace");
  expect(h.fulfill).not.toHaveBeenCalled();
});
it("ignores checkout from another product without a known order", async () => {
  h.order = null;
  expect(await fulfillCreditSession("cs_external")).toBe("ignored");
  expect(h.fulfill).not.toHaveBeenCalled();
});
it("propagates a failed grant so webhook delivery remains retryable", async () => {
  h.fulfill.mockResolvedValue({
    data: null,
    error: { message: "unavailable" },
  });
  await expect(fulfillCreditSession("cs_paid")).rejects.toThrow();
});

it.each(["expired", "failed"])(
  "closes a freshly verified unpaid %s checkout without granting",
  async (state) => {
    const session = paidSession();
    session.payment_status = "unpaid";
    session.status = state === "expired" ? "expired" : "complete";
    session.payment_intent.status =
      state === "expired" ? "canceled" : "requires_payment_method";
    session.payment_intent.latest_charge.paid = false;
    h.retrieve.mockResolvedValue(session);
    expect(await fulfillCreditSession("cs_paid")).toBe(state);
    expect(h.fulfill).toHaveBeenCalledWith("close_credit_order", {
      p_order: orderId,
      p_session: "cs_paid",
      p_state: state,
    });
    expect(h.fulfill).not.toHaveBeenCalledWith(
      "fulfill_credit_order",
      expect.anything(),
    );
  },
);
it("does not close a still-processing delayed payment", async () => {
  const session = paidSession();
  session.payment_status = "unpaid";
  session.payment_intent.status = "processing";
  h.retrieve.mockResolvedValue(session);
  expect(await fulfillCreditSession("cs_paid")).toBe("pending");
  expect(h.fulfill).not.toHaveBeenCalled();
});
