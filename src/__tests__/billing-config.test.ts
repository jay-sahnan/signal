import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { billingConfig } from "@/lib/billing/config";

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_example");
  vi.stubEnv("STRIPE_PRICE_ID", "price_example");
  vi.stubEnv("SIGNAL_PUBLIC_URL", "https://signal.example");
  vi.stubEnv("SIGNAL_PLAN_VERSION", "starter-v1");
  vi.stubEnv("SIGNAL_MONTHLY_UNITS", "100");
  vi.stubEnv("SIGNAL_MONITOR_LIMIT", "10");
});
afterEach(() => vi.unstubAllEnvs());

it("uses operator-configured prices and limits without invented defaults", () => {
  expect(billingConfig()).toMatchObject({
    priceId: "price_example",
    monthlyUnits: 100,
    monitorLimit: 10,
  });
});
it.each(["0", "-1", "1.5", "", "100abc", "9007199254740992"])(
  "rejects invalid allowance %s",
  (value) => {
    vi.stubEnv("SIGNAL_MONTHLY_UNITS", value);
    expect(() => billingConfig()).toThrow("SIGNAL_MONTHLY_UNITS");
  },
);
it.each([
  "http://signal.example",
  "https://signal.example/path",
  "https://user:pass@signal.example",
  "https://signal.example?next=evil",
])("rejects unsafe return origin %s", (value) => {
  vi.stubEnv("SIGNAL_PUBLIC_URL", value);
  expect(() => billingConfig()).toThrow("SIGNAL_PUBLIC_URL");
});

it("rejects monitor limits outside database integer range", () => {
  vi.stubEnv("SIGNAL_MONITOR_LIMIT", "2147483648");
  expect(() => billingConfig()).toThrow("SIGNAL_MONITOR_LIMIT");
});
