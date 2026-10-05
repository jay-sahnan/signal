import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  prepaidConfig,
  stripeConnectionConfig,
} from "@/lib/billing/prepaid-config";
beforeEach(() => {
  vi.stubEnv("SIGNAL_PUBLIC_URL", "https://signal.test");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_example");
  vi.stubEnv("STRIPE_CREDIT_PRICE_ID", "price_pack");
  vi.stubEnv("SIGNAL_CREDIT_PACK_SIZE", "100");
  vi.stubEnv("SIGNAL_CREDIT_RATE_VERSION", "credits-v1");
  vi.stubEnv("SIGNAL_MONTHLY_UNITS", "");
  vi.stubEnv("STRIPE_PRICE_ID", "");
});
afterEach(() => vi.unstubAllEnvs());
it("configures one-time credit packs without a monthly subscription plan", () => {
  expect(prepaidConfig()).toEqual({
    priceId: "price_pack",
    credits: 100,
    rateVersion: "credits-v1",
  });
  expect(stripeConnectionConfig().origin).toBe("https://signal.test");
});
it.each(["", "0", "-1", "1.5", "1000000001", "100abc"])(
  "rejects invalid pack credits %s",
  (credits) => {
    vi.stubEnv("SIGNAL_CREDIT_PACK_SIZE", credits);
    expect(() => prepaidConfig()).toThrow("SIGNAL_CREDIT_PACK_SIZE");
  },
);
it.each([
  "http://signal.test",
  "https://evil@signal.test",
  "https://signal.test/path",
])("rejects unsafe checkout origins %s", (origin) => {
  vi.stubEnv("SIGNAL_PUBLIC_URL", origin);
  expect(() => stripeConnectionConfig()).toThrow("SIGNAL_PUBLIC_URL");
});
