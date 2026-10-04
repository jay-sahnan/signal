import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ rpc: h.rpc, from: () => ({ update: h.update }) }),
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
  h.rpc.mockResolvedValue({ data: 7, error: null });
  h.list.mockResolvedValue({ data: [], has_more: false });
  h.update.mockReturnValue({ eq: h.eq });
  h.eq.mockReturnValue({ eq: h.eq, select: h.select });
  h.select.mockResolvedValue({
    data: [{ workspace_id: "workspace" }],
    error: null,
  });
});
it("fences a fresh provider response by customer and revision", async () => {
  await expect(reconcileCustomer("cus_owned")).resolves.toBe(true);
  expect(h.rpc).toHaveBeenCalledWith("begin_subscription_sync", {
    p_customer_id: "cus_owned",
  });
  expect(h.eq.mock.calls).toEqual([
    ["stripe_customer_id", "cus_owned"],
    ["sync_revision", 7],
  ]);
  expect(h.update.mock.calls[0][0]).not.toHaveProperty("risk_hold");
});
it("ignores unrelated customers before provider requests", async () => {
  h.rpc.mockResolvedValue({ data: null, error: null });
  await expect(reconcileCustomer("cus_other")).resolves.toBe(false);
  expect(h.list).not.toHaveBeenCalled();
});
it("requests retry when a newer synchronization supersedes this response", async () => {
  h.select.mockResolvedValue({ data: [], error: null });
  await expect(reconcileCustomer("cus_owned")).rejects.toThrow("superseded");
});
it("never writes state after a failed provider request", async () => {
  h.list.mockRejectedValue(new Error("Stripe unavailable"));
  await expect(reconcileCustomer("cus_owned")).rejects.toThrow(
    "Stripe unavailable",
  );
  expect(h.update).not.toHaveBeenCalled();
});

it("persists denied access when Stripe history cannot be inspected completely", async () => {
  h.list.mockResolvedValue({ data: [], has_more: true });
  await expect(reconcileCustomer("cus_owned")).resolves.toBe(true);
  expect(h.update.mock.calls[0][0]).toMatchObject({
    status: "none",
    monthly_units: 0,
  });
});
