import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ fetch: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: h.fetch, readBodyCapped: async () => "" }));
vi.mock("ai", async importOriginal => ({ ...(await importOriginal<typeof import("ai")>()), generateObject: h.generate }));
vi.mock("@/lib/services/cost-tracker", () => ({ trackUsage: vi.fn(), estimateClaudeCostFromUsage: () => 0, PRICING: { browserbase_session_per_hr: 0.1 } }));
import { WebExtractionService } from "@/lib/services/web-extraction-service";
import { findPeopleOnDomain } from "@/lib/services/contact-filter";
import { KnownDiscoveryFailure } from "@/lib/services/discovery-failure";

type Internals = Record<"extractViaBrowserbaseFetch" | "extractViaBrowserbaseSession", () => Promise<unknown>>;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

for (const status of [404, 410, 451]) {
  it(`does not hold credits for direct HTTP ${status} without provider work`, async () => {
    h.fetch.mockResolvedValue({ ok: false, status, statusText: "Unavailable" });
    const provider = vi.spyOn(WebExtractionService.prototype as unknown as Internals, "extractViaBrowserbaseFetch");
    await expect(findPeopleOnDomain("acme.com", "Acme", { strict: true })).rejects.toBeInstanceOf(KnownDiscoveryFailure);
    expect(provider).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
  });
}

it("retains uncertainty when Fetch loses its response before an empty browser fallback", async () => {
  vi.stubEnv("BROWSERBASE_API_KEY", "test-key");
  vi.stubEnv("BROWSERBASE_PROJECT_ID", "test-project");
  h.fetch.mockRejectedValue(new Error("Direct fetch unavailable"));
  vi.spyOn(WebExtractionService.prototype as unknown as Internals, "extractViaBrowserbaseFetch").mockRejectedValue(new Error("Response lost"));
  vi.spyOn(WebExtractionService.prototype as unknown as Internals, "extractViaBrowserbaseSession").mockResolvedValue({
    parsed: { title: "", description: "", content: "" }, durationSec: 1, sessionId: "session",
  });
  await expect(findPeopleOnDomain("acme.com", "Acme", { strict: true })).rejects.not.toBeInstanceOf(KnownDiscoveryFailure);
  expect(h.generate).not.toHaveBeenCalled();
});
