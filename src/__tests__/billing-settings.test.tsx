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
  canManage: true,
  hasCustomer: false,
  available: 100,
  reserved: 10,
  spent: 20,
  riskHold: false,
  pendingPurchase: false,
  pendingCredits: null,
  packCredits: 200,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows wallet totals and keeps owner actions off a member's screen", () => {
  render(<BillingSettings initial={{ ...initial, canManage: false }} />);
  expect(screen.getByText(/Available credits/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /buy credits/i })).toBeNull();
  expect(screen.getByText(/workspace owner/)).toBeTruthy();
});
it("reports checkout errors and allows retry without claiming payment succeeded", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Checkout unavailable" }),
  });
  vi.stubGlobal("fetch", fetch);
  render(<BillingSettings initial={initial} />);
  fireEvent.click(screen.getByRole("button", { name: /buy credits/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Checkout unavailable",
  );
  expect(
    screen.getByRole("button", { name: /buy credits/i }),
  ).not.toBeDisabled();
  expect(fetch).toHaveBeenCalledWith("/api/billing/checkout", {
    method: "POST",
  });
});
it("refreshes the confirmed credit balance and retains payment history", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ refreshed: true }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...initial, available: 300, hasCustomer: true }),
    });
  vi.stubGlobal("fetch", fetch);
  render(
    <BillingSettings
      initial={{ ...initial, hasCustomer: true, available: 100 }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
  await waitFor(() => expect(screen.getByText("300")).toBeTruthy());
  expect(screen.getByRole("button", { name: /manage billing/i })).toBeTruthy();
});
it("shows a hold instead of offering another purchase", () => {
  render(
    <BillingSettings
      initial={{ ...initial, riskHold: true, hasCustomer: true }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/review/i);
  expect(screen.queryByRole("button", { name: /buy credits/i })).toBeNull();
});

it("explains manual top-ups and pending confirmation", () => {
  render(
    <BillingSettings
      initial={{ ...initial, pendingPurchase: true, pendingCredits: 75 }}
    />,
  );
  expect(screen.getByText(/do not expire/)).toBeTruthy();
  expect(screen.getByText(/75 credits is pending/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: /resume checkout/i })).toBeTruthy();
});

it("shows balances but no purchase action when top-ups are unavailable", () => {
  render(<BillingSettings initial={{ ...initial, packCredits: null }} />);
  expect(screen.getByText("Available credits")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Buy credits" })).toBeNull();
  expect(screen.getByText(/Top-ups are temporarily unavailable/)).toBeTruthy();
});
