// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: new Map<string, { response: unknown; created_at: string }>(),
  fail: false,
  exaCalls: 0,
  track: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_c: string, key: string) => ({
          maybeSingle: async () => {
            if (h.fail) return { data: null, error: { message: "no table" } };
            const row = h.rows.get(key);
            return { data: row ? { ...row } : null, error: null };
          },
        }),
      }),
      upsert: async (row: {
        key: string;
        response: unknown;
        created_at: string;
      }) => {
        if (h.fail) throw new Error("no table");
        h.rows.set(row.key, {
          response: row.response,
          created_at: row.created_at,
        });
        return { error: null };
      },
    }),
  }),
}));
vi.mock("@/lib/services/cost-tracker", () => ({
  PRICING: { exa_search: 0.007 },
  trackUsage: h.track,
}));
vi.mock("exa-js", () => ({
  default: class {
    async search() {
      h.exaCalls++;
      return {
        results: [{ title: "T", url: "https://x" }],
        searchType: "auto",
      };
    }
    async searchAndContents() {
      return this.search();
    }
  },
}));

import { EXA_CACHE_TTL_MS, exaCacheKey } from "@/lib/services/exa-cache";
import { ExaService } from "@/lib/services/exa-service";

describe("Exa response cache", () => {
  beforeEach(() => {
    h.rows.clear();
    h.fail = false;
    h.exaCalls = 0;
    h.track.mockClear();
    vi.stubEnv("EXA_API_KEY", "test");
  });

  it("keys on normalised query and options", () => {
    const a = exaCacheKey('  "Acme"   CTO ', { numResults: 5 });
    const b = exaCacheKey('"acme" cto', { numResults: 5 });
    const c = exaCacheKey('"acme" cto', { numResults: 6 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("serves a repeat query from the cache with a $0 usage row", async () => {
    const exa = new ExaService();
    await exa.search("acme cto", { numResults: 3 });
    await exa.search("Acme  CTO", { numResults: 3 });
    expect(h.exaCalls).toBe(1);
    const ops = h.track.mock.calls.map((c) => c[0].operation);
    expect(ops).toEqual(["search", "search-cache-hit"]);
    expect(h.track.mock.calls[1][0].estimated_cost_usd).toBe(0);
  });

  it("ignores rows older than the TTL", async () => {
    const exa = new ExaService();
    await exa.search("stale", {});
    const key = exaCacheKey("stale", {});
    const row = h.rows.get(key)!;
    row.created_at = new Date(
      Date.now() - EXA_CACHE_TTL_MS - 1000,
    ).toISOString();
    await exa.search("stale", {});
    expect(h.exaCalls).toBe(2);
  });

  it("bypassCache always searches", async () => {
    const exa = new ExaService();
    await exa.search("fresh", {});
    await exa.search("fresh", { bypassCache: true });
    expect(h.exaCalls).toBe(2);
  });

  it("fails open when the cache table is unavailable", async () => {
    h.fail = true;
    const exa = new ExaService();
    const res = await exa.search("no table", {});
    expect(res.results).toHaveLength(1);
    expect(h.exaCalls).toBe(1);
  });
});
