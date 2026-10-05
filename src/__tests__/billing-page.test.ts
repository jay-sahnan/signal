import { expect, it, vi } from "vitest";
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => true }));
vi.mock("@/lib/billing/prepaid-management", () => ({
  prepaidStatus: async () => {
    throw new BillingRequestError("Sign in required", 401);
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
import { BillingRequestError } from "@/lib/billing/account";
import BillingPage from "@/app/settings/billing/page";
it("returns anonymous owners to the real login route", async () => {
  await expect(BillingPage()).rejects.toThrow("/login");
});
