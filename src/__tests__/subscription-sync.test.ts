import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn(), finish: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ rpc: h.rpc }),
}));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ subscriptions: { list: h.list } }),
}));
vi.mock("@/lib/billing/config", () => ({
  billingConfig: () => ({ priceId: "price_test" }),
}));
import { reconcileCustomer } from "@/lib/billing/subscriptions";
beforeEach(() => {
  vi.clearAllMocks();
  h.finish.mockResolvedValue({ data: true, error: null });
  h.rpc.mockImplementation((name, args) =>
    name === "finish_subscription_sync"
      ? h.finish(args)
      : Promise.resolve({ data: 7, error: null }),
  );
  h.list.mockResolvedValue({ data: [], has_more: false });
});
it("fences a fresh provider response by customer and revision", async () => {
  await expect(reconcileCustomer("cus_owned")).resolves.toBe(true);
  expect(h.finish).toHaveBeenCalledWith(
    expect.objectContaining({ p_customer_id: "cus_owned", p_revision: 7 }),
  );
  expect(h.finish.mock.calls[0][0].p_state).not.toHaveProperty("risk_hold");
  expect(h.rpc).toHaveBeenCalledWith("release_subscription_sync", {
    p_customer_id: "cus_owned",
    p_revision: 7,
  });
});
it("ignores unrelated customers before provider requests", async () => {
  h.rpc.mockResolvedValue({ data: null, error: null });
  await expect(reconcileCustomer("cus_other")).resolves.toBe(false);
  expect(h.list).not.toHaveBeenCalled();
});
it("requests retry when a newer synchronization supersedes this response", async () => {
  h.finish.mockResolvedValue({ data: false, error: null });
  await expect(reconcileCustomer("cus_owned")).rejects.toThrow("superseded");
});
it("releases its lease after a failed provider request without writing state", async () => {
  h.list.mockRejectedValue(new Error("Stripe unavailable"));
  await expect(reconcileCustomer("cus_owned")).rejects.toThrow(
    "Stripe unavailable",
  );
  expect(h.finish).not.toHaveBeenCalled();
  expect(h.rpc).toHaveBeenCalledWith("release_subscription_sync", {
    p_customer_id: "cus_owned",
    p_revision: 7,
  });
});
it("persists denied access when Stripe history cannot be inspected completely", async () => {
  h.list.mockResolvedValue({ data: [], has_more: true });
  await expect(reconcileCustomer("cus_owned")).resolves.toBe(true);
  expect(h.finish.mock.calls[0][0].p_state).toMatchObject({
    status: "none",
    monthly_units: 0,
  });
});
it("does not fetch Stripe when another worker holds the lease", async () => {
  h.rpc.mockResolvedValue({ data: null, error: { code: "55P03" } });
  await expect(reconcileCustomer("cus_owned")).rejects.toThrow("Cannot begin");
  expect(h.list).not.toHaveBeenCalled();
});
