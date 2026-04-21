import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fetchWithTimeout so we can control the behaviour of each underlying
// provider call (Anthropic admin + Apify monthly usage).
vi.mock("@/lib/fetch-with-timeout", () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { fetchRealSpend } from "@/lib/services/real-spend";

const mockFetch = fetchWithTimeout as unknown as ReturnType<typeof vi.fn>;

const START = "2026-04-01T00:00:00.000Z";
const END = "2026-04-19T00:00:00.000Z";

describe("fetchRealSpend", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    process.env.APIFY_API_TOKEN = "apify-test-token";
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("still returns the anthropic value when the apify fetcher rejects unexpectedly", async () => {
    // Simulate an unexpected rejection from the apify fetcher by returning a
    // malformed usageCycle.startAt that makes a downstream Date invalid. The
    // next loop iteration calls cursor.toISOString() OUTSIDE the inner
    // try/catch, which throws RangeError and causes fetchApifySpend to
    // reject. Meanwhile anthropic succeeds and must still surface through
    // fetchRealSpend.
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("anthropic.com")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ results: [{ amount: "500" }, { amount: "250" }] }],
            has_more: false,
          }),
          text: async () => "",
        });
      }
      // Apify: hand back a usageCycle whose startAt is invalid. The service
      // code does `new Date(cycleStartIso)` then `cycleStart.getTime() - 1`
      // which yields NaN, and on the next iteration cursor.toISOString()
      // (outside the try/catch) throws RangeError.
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            usageCycle: {
              startAt: "not-a-real-date",
              endAt: "2026-04-30T00:00:00.000Z",
            },
            dailyServiceUsages: [],
          },
        }),
        text: async () => "",
      });
    });

    const result = await fetchRealSpend(START, END);

    // 500 + 250 cents = $7.50. Anthropic must still surface even though
    // apify rejected.
    expect(result.claude).toBeCloseTo(7.5, 5);
    expect(result.apify).toBeNull();
  });

  it("returns the apify value even if the anthropic fetcher rejects unexpectedly", async () => {
    // The anthropic fetcher's try/catch covers fetchWithTimeout rejections,
    // so this path exercises the normal "null on error" contract rather
    // than a raw rejection. It's still a valuable regression check: when
    // one provider errors cleanly and the other succeeds, the dashboard
    // should see the surviving value.
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("anthropic.com")) {
        return Promise.reject(new Error("boom: anthropic network down"));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            usageCycle: {
              startAt: "2026-04-01T00:00:00.000Z",
              endAt: "2026-04-30T00:00:00.000Z",
            },
            dailyServiceUsages: [
              { date: "2026-04-05", totalUsageCreditsUsd: 12.34 },
              { date: "2026-04-10", totalUsageCreditsUsd: 7.66 },
            ],
          },
        }),
        text: async () => "",
      });
    });

    const result = await fetchRealSpend(START, END);

    expect(result.claude).toBeNull();
    expect(result.apify).toBeCloseTo(20, 5);
  });

  it("returns null for exa and browserbase when their env vars are unset", async () => {
    delete process.env.EXA_SERVICE_API_KEY;
    delete process.env.EXA_API_KEY_ID;
    delete process.env.BROWSERBASE_API_KEY;
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => "",
    });

    const result = await fetchRealSpend(START, END);
    expect(result.exa).toBeNull();
    expect(result.browserbase).toBeNull();
  });

  it("parses exa total_cost_usd and returns the billed total", async () => {
    process.env.EXA_SERVICE_API_KEY = "exa-service-test";
    process.env.EXA_API_KEY_ID = "11111111-2222-3333-4444-555555555555";

    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("admin-api.exa.ai")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ total_cost_usd: 4.87 }),
          text: async () => "",
        });
      }
      // Other providers -- shape them so they don't explode the test.
      if (url.includes("anthropic.com")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [], has_more: false }),
          text: async () => "",
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: { dailyServiceUsages: [] } }),
        text: async () => "",
      });
    });

    const result = await fetchRealSpend(START, END);
    expect(result.exa).toBeCloseTo(4.87, 5);
  });

  it("returns null from exa when the response is missing total_cost_usd", async () => {
    // Guards against silently displaying $0 when the API shape changes --
    // a missing field should fall back to the local estimate, not overwrite
    // it with zero.
    process.env.EXA_SERVICE_API_KEY = "exa-service-test";
    process.env.EXA_API_KEY_ID = "11111111-2222-3333-4444-555555555555";

    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("admin-api.exa.ai")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ some_other_field: 42 }),
          text: async () => "",
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [], has_more: false }),
        text: async () => "",
      });
    });

    const result = await fetchRealSpend(START, END);
    expect(result.exa).toBeNull();
  });

  it("sums browserbase session durations inside the window and ignores older sessions", async () => {
    process.env.BROWSERBASE_API_KEY = "bb-test";

    // Window is START..END (2026-04-01 .. 2026-04-19). Sessions below span
    // one inside (1h), one outside (older), and one malformed entry to
    // confirm the filter logic + early-exit ordering.
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("browserbase.com")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            // Inside window: 2026-04-10 10:00 -> 11:00 = 1h exactly
            {
              startedAt: "2026-04-10T10:00:00.000Z",
              endedAt: "2026-04-10T11:00:00.000Z",
            },
            // Inside window: 2026-04-05 12:00 -> 12:30 = 0.5h
            {
              startedAt: "2026-04-05T12:00:00.000Z",
              endedAt: "2026-04-05T12:30:00.000Z",
            },
            // Outside window (before start): must be skipped, and because
            // we saw in-window sessions above, this triggers the early-exit.
            {
              startedAt: "2026-03-15T09:00:00.000Z",
              endedAt: "2026-03-15T09:30:00.000Z",
            },
            // Would be inside window but unreachable due to early-exit; we
            // assert this is NOT counted to verify the ordering contract.
            {
              startedAt: "2026-04-02T09:00:00.000Z",
              endedAt: "2026-04-02T09:15:00.000Z",
            },
          ],
          text: async () => "",
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [], has_more: false }),
        text: async () => "",
      });
    });

    const result = await fetchRealSpend(START, END);
    // (1h + 0.5h) * $0.10/hr = $0.15. The post-exit 15-min session must
    // NOT be summed because the newest-first bail-out kicked in.
    expect(result.browserbase).toBeCloseTo(0.15, 5);
  });
});
