import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolve: vi.fn(),
  single: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/workspace", () => ({
  isHostedMode: () => true,
  resolveWorkspace: h.resolve,
}));
vi.mock("@/lib/billing/prepaid-config", () => ({
  stripeConnectionConfig: () => ({ origin: "https://signal.example" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ from: () => ({ select: () => ({ eq: h.eq }) }) }),
}));
import { requireBillingOwner } from "@/lib/billing/account";
const request = (origin = "https://signal.example") =>
  new Request("https://signal.example/api/billing/checkout", {
    method: "POST",
    headers: { origin },
    body: JSON.stringify({
      userId: "victim",
      workspaceId: "victim-workspace",
      priceId: "price_free",
    }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ userId: "verified-user" });
  h.resolve.mockResolvedValue("verified-workspace");
  h.eq.mockReturnValue({ eq: h.eq, single: h.single });
  h.single.mockResolvedValue({
    data: { owner_user_id: "verified-user" },
    error: null,
  });
});
it("uses verified identity and membership instead of forged billing input", async () => {
  expect(await requireBillingOwner(request())).toEqual({
    userId: "verified-user",
    workspaceId: "verified-workspace",
  });
  expect(h.resolve).toHaveBeenCalledWith("verified-user");
  expect(h.eq).toHaveBeenCalledWith("id", "verified-workspace");
});
it("rejects a workspace member who is not its billing owner", async () => {
  h.single.mockResolvedValue({
    data: { owner_user_id: "other-owner" },
    error: null,
  });
  await expect(requireBillingOwner(request())).rejects.toMatchObject({
    status: 403,
  });
});
it("rejects cross-origin and signed-out requests before provisioning", async () => {
  await expect(
    requireBillingOwner(request("https://evil.example")),
  ).rejects.toMatchObject({ status: 403 });
  h.auth.mockResolvedValue({ userId: null });
  await expect(requireBillingOwner(request())).rejects.toMatchObject({
    status: 401,
  });
  expect(h.resolve).not.toHaveBeenCalled();
});
