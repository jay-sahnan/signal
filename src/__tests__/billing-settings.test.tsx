import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BillingSettings } from "@/components/settings/billing-settings";
const initial = {
  status: "none",
  canManage: true,
  hasCustomer: false,
  periodEnd: null,
  monthlyUnits: 0,
  monitorLimit: 0,
  cancelAtPeriodEnd: false,
  riskHold: false,
  reconciledAt: null,
  plan: { monthlyUnits: 100, monitorLimit: 5 },
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows plan allowances and keeps owner actions off a member's screen", () => {
  render(<BillingSettings initial={{ ...initial, canManage: false }} />);
  expect(screen.getByText(/100 research units/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /pricing/i })).toBeNull();
  expect(screen.getByText(/workspace owner/)).toBeTruthy();
});
it("reports checkout errors and allows retry without claiming payment succeeded", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Checkout unavailable" }),
    });
  vi.stubGlobal("fetch", fetch);
  render(<BillingSettings initial={initial} />);
  fireEvent.click(screen.getByRole("button", { name: /pricing/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Checkout unavailable",
  );
  expect(screen.getByRole("button", { name: /pricing/i })).not.toBeDisabled();
  expect(fetch).toHaveBeenCalledWith("/api/billing/checkout", {
    method: "POST",
  });
});
it("refreshes confirmed billing status and retains portal access after cancellation", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ refreshed: true }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...initial, status: "canceled", hasCustomer: true }),
    });
  vi.stubGlobal("fetch", fetch);
  render(
    <BillingSettings
      initial={{ ...initial, hasCustomer: true, status: "active" }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
  await waitFor(() => expect(screen.getByText("Canceled")).toBeTruthy());
  expect(screen.getByRole("button", { name: /manage billing/i })).toBeTruthy();
});
it("shows a hold instead of offering another subscription", () => {
  render(
    <BillingSettings
      initial={{ ...initial, riskHold: true, hasCustomer: true }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/review/i);
  expect(screen.queryByRole("button", { name: /pricing/i })).toBeNull();
});
