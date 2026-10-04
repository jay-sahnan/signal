import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  owner: vi.fn(),
  resolve: vi.fn(),
  row: null as Record<string, unknown> | null,
  portal: vi.fn(),
  reconcile: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/workspace", () => ({
  isHostedMode: () => true,
  resolveWorkspace: h.resolve,
}));
vi.mock("@/lib/billing/account", async (original) => ({
  ...(await original<typeof import("@/lib/billing/account")>()),
  requireBillingOwner: h.owner,
}));
vi.mock("@/lib/billing/config", () => ({
  billingConfig: () => ({
    origin: "https://signal.test",
    monthlyUnits: 100,
    monitorLimit: 5,
  }),
}));
vi.mock("@/lib/billing/subscriptions", () => ({
  reconcileCustomer: h.reconcile,
}));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ billingPortal: { sessions: { create: h.portal } } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (...args: unknown[]) => {
          h.eq(table, ...args);
          return {
            maybeSingle: async () => ({
              data: table === "workspaces" ? { owner_user_id: "owner" } : h.row,
              error: null,
            }),
          };
        },
      }),
    }),
  }),
}));
import {
  billingStatus,
  openBillingPortal,
  refreshBilling,
} from "@/lib/billing/management";
const request = new Request("https://signal.test/api/billing/portal", {
  method: "POST",
  body: JSON.stringify({
    workspaceId: "forged",
    customer: "cus_forged",
    return_url: "https://evil.test",
  }),
});
beforeEach(() => {
  vi.resetAllMocks();
  h.auth.mockResolvedValue({ userId: "owner" });
  h.resolve.mockResolvedValue("trusted");
  h.owner.mockResolvedValue({ userId: "owner", workspaceId: "trusted" });
  h.row = {
    stripe_customer_id: "cus_owned",
    stripe_subscription_id: "sub_private",
    status: "active",
    monthly_units: 100,
    monitor_limit: 5,
    risk_hold: false,
  };
  h.portal.mockResolvedValue({ url: "https://billing.stripe.com/session" });
});
it("opens the stored customer's portal with a fixed return URL", async () => {
  expect(await openBillingPortal(request)).toBe(
    "https://billing.stripe.com/session",
  );
  expect(h.portal).toHaveBeenCalledWith({
    customer: "cus_owned",
    return_url: "https://signal.test/settings/billing",
  });
  expect(h.eq).toHaveBeenCalledWith(
    "workspace_billing",
    "workspace_id",
    "trusted",
  );
});
it("requires the owner before contacting Stripe", async () => {
  h.owner.mockRejectedValue(new Error("Owner required"));
  await expect(openBillingPortal(request)).rejects.toThrow("Owner required");
  expect(h.portal).not.toHaveBeenCalled();
});
it("does not create a customer just to open a portal", async () => {
  h.row = null;
  await expect(openBillingPortal(request)).rejects.toThrow(
    "No billing account",
  );
});
it("returns only safe billing fields for the authenticated workspace", async () => {
  h.auth.mockResolvedValue({ userId: "member" });
  const status = await billingStatus();
  expect(status).toMatchObject({
    status: "active",
    canManage: false,
    hasCustomer: true,
  });
  expect(status).not.toHaveProperty("stripe_customer_id");
  expect(status).not.toHaveProperty("stripe_subscription_id");
  expect(h.resolve).toHaveBeenCalledWith("member");
});
it("rejects anonymous status reads", async () => {
  h.auth.mockResolvedValue({ userId: null });
  await expect(billingStatus()).rejects.toThrow("Sign in required");
  expect(h.eq).not.toHaveBeenCalled();
});
it("refreshes using only the stored customer, never a redirect result", async () => {
  await refreshBilling(request);
  expect(h.reconcile).toHaveBeenCalledWith("cus_owned");
});
