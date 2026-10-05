import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  allowed: true,
  hosted: true,
  rpc: vi.fn(),
  find: vi.fn(),
  fulfill: vi.fn(),
}));
vi.mock("@/lib/services/jobs", () => ({
  isJobRequestAuthorized: () => h.allowed,
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ rpc: h.rpc }),
}));
vi.mock("@/lib/billing/checkout-history", () => ({
  findCheckoutSession: h.find,
}));
vi.mock("@/lib/billing/prepaid-fulfillment", () => ({
  fulfillCreditSession: h.fulfill,
}));
import { GET } from "@/app/api/billing/reconcile/route";
const request = new Request("https://signal.test/api/billing/reconcile");
beforeEach(() => {
  vi.resetAllMocks();
  h.allowed = true;
  h.hosted = true;
  h.rpc.mockImplementation(async (name) => ({
    data:
      name === "claim_credit_reconciliation"
        ? [
            {
              id: "order",
              workspace_id: "workspace",
              customer_id: "cus_owner",
              session_id: "cs_owned",
            },
          ]
        : 1,
    error: null,
  }));
  h.fulfill.mockResolvedValue("paid");
});
it("rejects unauthenticated scheduler calls without touching billing", async () => {
  h.allowed = false;
  expect((await GET(request)).status).toBe(401);
  expect(h.rpc).not.toHaveBeenCalled();
});
it("does not run hosted billing recovery in self-hosted deployments", async () => {
  h.hosted = false;
  expect((await GET(request)).status).toBe(404);
  expect(h.rpc).not.toHaveBeenCalled();
});
it("releases only expired unstarted reservations then reconciles bounded purchases", async () => {
  expect((await GET(request)).status).toBe(200);
  expect(h.rpc).toHaveBeenCalledWith("release_expired_credit_reservations", {
    p_limit: 100,
  });
  expect(h.rpc).toHaveBeenCalledWith("claim_credit_reconciliation", {
    p_limit: 2,
  });
  expect(h.fulfill).toHaveBeenCalledWith("cs_owned", "workspace");
});
it("recovers lost checkout responses using the stored customer and order", async () => {
  h.rpc
    .mockResolvedValueOnce({ data: 0 })
    .mockResolvedValueOnce({
      data: [
        {
          id: "order",
          customer_id: "cus_owner",
          workspace_id: "workspace",
          session_id: null,
        },
      ],
    });
  h.find.mockResolvedValue({ id: "cs_found" });
  await GET(request);
  expect(h.find).toHaveBeenCalledWith("cus_owner", "order");
  expect(h.fulfill).toHaveBeenCalledWith("cs_found", "workspace");
});
it("reports failures without treating them as paid or dropping the order", async () => {
  h.fulfill.mockRejectedValue(new Error("Stripe unavailable"));
  const response = await GET(request);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ failed: 1 });
});
