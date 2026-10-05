import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  owner: vi.fn(),
  rpc: vi.fn(),
  find: vi.fn(),
  fulfill: vi.fn(),
  portal: vi.fn(),
  queries: [] as unknown[][],
  order: null as Record<string, unknown> | null,
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/workspace", () => ({
  isHostedMode: () => true,
  resolveWorkspace: async () => "trusted",
}));
vi.mock("@/lib/billing/account", async (original) => ({
  ...(await original<typeof import("@/lib/billing/account")>()),
  requireBillingOwner: h.owner,
}));
vi.mock("@/lib/billing/prepaid-config", () => ({
  prepaidConfig: () => ({ credits: 100 }),
  stripeConnectionConfig: () => ({ origin: "https://signal.test" }),
}));
vi.mock("@/lib/billing/checkout-history", () => ({
  findCheckoutSession: h.find,
}));
vi.mock("@/lib/billing/prepaid-fulfillment", () => ({
  fulfillCreditSession: h.fulfill,
}));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ billingPortal: { sessions: { create: h.portal } } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: h.rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => {
          h.queries.push([table, ...args]);
          return query;
        },
        maybeSingle: async () => ({
          error: null,
          data:
            table === "workspaces"
              ? { owner_user_id: "owner" }
              : table === "credit_orders"
                ? h.order
                : { stripe_customer_id: "cus_private", risk_hold: false },
        }),
      };
      return query;
    },
  }),
}));
import {
  prepaidStatus,
  refreshPrepaidBilling,
  openPrepaidPortal,
} from "@/lib/billing/prepaid-management";
const request = new Request("https://signal.test", {
  method: "POST",
  body: JSON.stringify({ session: "cs_forged", workspace: "other" }),
});
beforeEach(() => {
  vi.resetAllMocks();
  h.queries = [];
  h.order = null;
  h.auth.mockResolvedValue({ userId: "member" });
  h.owner.mockResolvedValue({ workspaceId: "trusted", userId: "owner" });
  h.rpc.mockResolvedValue({
    data: { available: 50, reserved: 20, spent: 30 },
    error: null,
  });
  h.portal.mockResolvedValue({ url: "https://billing.stripe.com/owned" });
});
it("returns safe wallet totals and pack size for the authenticated workspace", async () => {
  const status = await prepaidStatus();
  expect(status).toMatchObject({
    available: 50,
    reserved: 20,
    spent: 30,
    canManage: false,
    packCredits: 100,
  });
  expect(status).not.toHaveProperty("stripe_customer_id");
  expect(h.rpc).toHaveBeenCalledWith("credit_summary", {
    p_workspace: "trusted",
    p_user: "member",
  });
});
it("rejects anonymous wallet reads", async () => {
  h.auth.mockResolvedValue({ userId: null });
  await expect(prepaidStatus()).rejects.toThrow("Sign in required");
  expect(h.rpc).not.toHaveBeenCalled();
});
it("fails closed rather than showing a zero balance after a database error", async () => {
  h.rpc.mockResolvedValue({ error: { message: "unavailable" } });
  await expect(prepaidStatus()).rejects.toThrow("Credit balance unavailable");
});
it("refreshes only the stored pending checkout within the owner's workspace", async () => {
  h.order = { id: "order", session_id: "cs_owned", customer_id: "cus_private" };
  await refreshPrepaidBilling(request);
  expect(h.fulfill).toHaveBeenCalledWith("cs_owned", "trusted");
  expect(h.queries).toContainEqual([
    "credit_orders",
    "workspace_id",
    "trusted",
  ]);
});
it("recovers a lost checkout binding by verified customer and order", async () => {
  h.order = { id: "order", session_id: null, customer_id: "cus_private" };
  h.find.mockResolvedValue({ id: "cs_recovered" });
  await refreshPrepaidBilling(request);
  expect(h.find).toHaveBeenCalledWith("cus_private", "order");
  expect(h.fulfill).toHaveBeenCalledWith("cs_recovered", "trusted");
});
it("requires ownership before any Stripe management operation", async () => {
  h.owner.mockRejectedValue(new Error("Owner required"));
  await expect(refreshPrepaidBilling(request)).rejects.toThrow(
    "Owner required",
  );
  await expect(openPrepaidPortal(request)).rejects.toThrow("Owner required");
  expect(h.fulfill).not.toHaveBeenCalled();
  expect(h.portal).not.toHaveBeenCalled();
});
it("uses the stored customer and fixed website return URL for the portal", async () => {
  await openPrepaidPortal(request);
  expect(h.portal).toHaveBeenCalledWith({
    customer: "cus_private",
    return_url: "https://signal.test/settings/billing",
  });
});

it("keeps the pending purchase quantity distinct from a changed pack", async () => {
  h.order = { id: "order", credits: 75 };
  expect(await prepaidStatus()).toMatchObject({
    packCredits: 100,
    pendingCredits: 75,
  });
});
