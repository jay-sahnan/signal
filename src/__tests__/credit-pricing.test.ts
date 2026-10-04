import { afterEach, expect, it, vi } from "vitest";
import { quoteCredits } from "@/lib/billing/credit-pricing";
afterEach(() => vi.unstubAllEnvs());
function configure() {
  vi.stubEnv("SIGNAL_CREDIT_RATE_VERSION", "v1");
  vi.stubEnv("SIGNAL_CREDIT_RATES", JSON.stringify({ "research.company": 3 }));
}
it("prices bounded usage from server configuration", () => {
  configure();
  expect(quoteCredits("research.company", 4)).toEqual({
    credits: 12,
    rateVersion: "v1",
  });
});
it("rejects actions without an explicitly configured price", () => {
  configure();
  expect(() => quoteCredits("unknown")).toThrow("rate");
  expect(() => quoteCredits("toString")).toThrow("rate");
});
it.each([0, -1, 0.5, Infinity, 10001])(
  "rejects invalid usage quantity %s",
  (units) => {
    configure();
    expect(() => quoteCredits("research.company", units)).toThrow();
  },
);
it("rejects free or malformed rates instead of allowing unmetered paid work", () => {
  configure();
  vi.stubEnv("SIGNAL_CREDIT_RATES", '{"research.company":0}');
  expect(() => quoteCredits("research.company")).toThrow();
});
it("requires an explicit version and caps total reservation size", () => {
  configure();
  vi.stubEnv("SIGNAL_CREDIT_RATE_VERSION", "");
  expect(() => quoteCredits("research.company")).toThrow();
  configure();
  vi.stubEnv("SIGNAL_CREDIT_RATES", '{"research.company":1000000}');
  expect(() => quoteCredits("research.company", 2)).toThrow();
});
