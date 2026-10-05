import { beforeEach, expect, it, vi } from "vitest";
import { createSupabaseFake } from "./helpers/supabase-fake";
const h = vi.hoisted(() => ({
  paid: vi.fn(),
  existing: vi.fn(),
  holds: vi.fn(),
  recent: vi.fn(),
  search: vi.fn(),
  save: vi.fn(),
  hosted: true,
  campaignOwner: "owner",
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid, hasPaidAction: h.existing }));
vi.mock("@/lib/tools/ownership", async (original) => ({
  ...(await original<object>()),
  toolSession: async () => ({ userId: "owner", supabase: {} }),
  callerHoldsOrganization: h.holds,
}));
vi.mock("@/lib/services/knowledge-base", async (original) => ({
  ...(await original<object>()),
  isRecentlyEnriched: h.recent,
  mergeEnrichmentData: h.save,
}));
vi.mock("@/lib/services/exa-service", () => ({
  ExaService: class {
    search = h.search;
  },
}));
vi.mock("@/lib/services/hiring-scraper", () => ({
  tryScrapeHiringData: async () => null,
  HIRING_SCRAPE_TIMEOUT_MS: 100,
}));
vi.mock("@/lib/services/claim-extractor", () => ({
  extractClaims: async () => [],
}));
vi.mock("@/lib/services/relevance-filter", () => ({
  filterRelevantResults: async (
    _name: unknown,
    _domain: unknown,
    rows: unknown,
  ) => rows,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    createSupabaseFake({
      tables: {
        organizations: () => [
          { id: "org", name: "Acme", domain: null, enrichment_data: {} },
        ],
        campaign_organizations: () => [
          { id: "link-a", organization_id: "org" },
          { id: "link-b", organization_id: "org" },
        ],
        campaigns: () => [
          { id: "campaign", user_id: h.campaignOwner, icp: {} },
        ],
      },
    }),
}));
import { enrichCompany, enrichCompanies } from "@/lib/tools/enrichment-tools";
import { runWithIdentity } from "@/lib/auth/identity";
const key = "22222222-2222-4222-8222-222222222222";
const call = (campaignId?: string) =>
  runWithIdentity({ userId: "owner", source: "mcp" }, () =>
    enrichCompany.execute!(
      { companyId: "org", campaignId, operationId: key } as never,
      {} as never,
    ),
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.hosted = true;
  h.existing.mockResolvedValue(false);
  h.campaignOwner = "owner";
  h.holds.mockResolvedValue(true);
  h.recent.mockResolvedValue(false);
  h.search.mockResolvedValue({ results: [] });
  h.paid.mockResolvedValue({ companyId: "org", summary: {} });
});
it("reserves company research before provider work or saves", async () => {
  await call();
  expect(h.paid).toHaveBeenCalledWith(
    expect.objectContaining({
      key,
      kind: "company.enrich",
      request: { organizationId: "org", campaignId: null },
    }),
    expect.any(Function),
  );
  expect(h.search).not.toHaveBeenCalled();
  expect(h.save).not.toHaveBeenCalled();
});
it("checks ownership even for cached company data", async () => {
  h.recent.mockResolvedValue(true);
  h.holds.mockResolvedValue(false);
  await expect(call()).rejects.toThrow("Company not found");
  expect(h.paid).not.toHaveBeenCalled();
});
it("rejects foreign campaign context before returning cached data", async () => {
  h.campaignOwner = "other";
  h.recent.mockResolvedValue(true);
  await expect(call("campaign")).rejects.toThrow("Campaign not found");
});
it("returns owned cached enrichment for free", async () => {
  h.recent.mockResolvedValue(true);
  expect(await call()).toMatchObject({ skipped: true });
  expect(h.paid).not.toHaveBeenCalled();
});
it("does not research when credit reservation fails", async () => {
  h.paid.mockRejectedValue(new Error("Insufficient credits"));
  await expect(call()).rejects.toThrow("Insufficient credits");
  expect(h.search).not.toHaveBeenCalled();
});
it("throws total provider failure inside the paid operation", async () => {
  h.paid.mockImplementation(async (_request, work) =>
    runWithIdentity(
      { userId: "owner", source: "mcp", operationId: "reserved" },
      work,
    ),
  );
  h.search.mockRejectedValue(new Error("Offline"));
  await expect(call()).rejects.toThrow("All company enrichment sources failed");
  expect(h.save).not.toHaveBeenCalled();
});
it("preserves direct self-hosted research", async () => {
  h.hosted = false;
  await call();
  expect(h.paid).not.toHaveBeenCalled();
  expect(h.search).toHaveBeenCalledTimes(3);
});
it("uses stable per-company keys for batch retries", async () => {
  const batch = () =>
    runWithIdentity({ userId: "owner", source: "mcp" }, () =>
      enrichCompanies.execute!(
        { companyIds: ["org"], operationId: key } as never,
        {} as never,
      ),
    );
  await batch();
  await batch();
  expect(h.paid).toHaveBeenCalledTimes(2);
  expect(h.paid.mock.calls[0][0].key).toMatch(/^[0-9a-f-]{36}$/);
  expect(h.paid.mock.calls[0][0].key).toBe(h.paid.mock.calls[1][0].key);
});

it("deduplicates company aliases before deriving the paid batch key", async () => {
  const batch = (companyIds: string[]) =>
    runWithIdentity({ userId: "owner", source: "mcp" }, () =>
      enrichCompanies.execute!(
        { companyIds, operationId: key } as never,
        {} as never,
      ),
    );
  expect(await batch(["link-a", "org", "link-b", "link-a"])).toMatchObject({
    total: 1, succeeded: 1, failed: 0,
  });
  expect(h.paid).toHaveBeenCalledTimes(1);
  await batch(["link-b"]);
  expect(h.paid.mock.calls[0][0].key).toBe(h.paid.mock.calls[1][0].key);
});
it("reports missing IDs without dropping valid companies from a batch", async () => {
  const result = await runWithIdentity({ userId: "owner", source: "mcp" }, () =>
    enrichCompanies.execute!(
      { companyIds: ["missing", "missing", "link-a"], operationId: key } as never,
      {} as never,
    ),
  );
  expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
  expect(h.paid).toHaveBeenCalledTimes(1);
});

it("replays the paid company result before accepting a recent profile", async () => {
  h.recent.mockResolvedValue(true);
  h.existing.mockResolvedValue(true);
  h.paid.mockResolvedValue({ companyId: "org", errors: ["Original partial result"] });
  expect(await call()).toEqual({ companyId: "org", errors: ["Original partial result"] });
  expect(h.paid).toHaveBeenCalledTimes(1);
  expect(h.search).not.toHaveBeenCalled();
});
it("does not hide unresolved company operations behind fresh data", async () => {
  h.recent.mockResolvedValue(true);
  h.existing.mockResolvedValue(true);
  h.paid.mockRejectedValue(new Error("Operation unresolved"));
  await expect(call()).rejects.toThrow("Operation unresolved");
});
