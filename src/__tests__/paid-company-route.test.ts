import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  paid: vi.fn(),
  rpc: vi.fn(),
  existing: vi.fn(),
  provider: vi.fn(),
  reviews: vi.fn(),
  discovery: vi.fn(),
  action: vi.fn(),
  recent: vi.fn(),
  hosted: true,
  domain: "acme.test" as string | null,
}));
vi.mock("@/lib/services/exa-service", () => ({
  ExaService: class {
    search = h.provider;
  },
}));
vi.mock("@/lib/services/web-extraction-service", () => ({
  WebExtractionService: class {
    extract = h.provider;
  },
}));
vi.mock("@/lib/services/google-places-service", () => ({
  GooglePlacesService: class {
    getPlaceReviews = h.reviews;
  },
}));
vi.mock("@/lib/services/hiring-scraper", () => ({
  tryScrapeHiringData: async () => null,
  HIRING_SCRAPE_TIMEOUT_MS: 100,
}));
vi.mock("@/lib/services/contact-discovery", () => ({
  findContactsForOrganization: h.discovery,
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid, hasPaidAction: h.existing }));
vi.mock("@/lib/services/cost-tracker", () => ({ withAction: h.action }));
vi.mock("@/lib/services/knowledge-base", () => ({
  isRecentlyEnriched: h.recent,
  mergeEnrichmentData: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => {
  const db = {
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        limit: () => q,
        single: async () => ({
          data:
            table === "campaign_organizations"
              ? {
                  organization_id: "org",
                  campaign_id: "campaign",
                  campaign: { user_id: "owner" },
                  organization: { name: "Acme", domain: h.domain },
                }
              : { user_id: "owner" },
        }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [] }).then(resolve),
      };
      return q;
    },
  };
  return {
    createClient: async () => db,
    getSupabaseAndUser: async () => ({ user: { id: "owner" }, supabase: db }),
  };
});
import { POST } from "@/app/api/enrich-company/route";
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({ rpc: h.rpc }) }));
vi.mock("@/lib/services/claim-extractor", () => ({ extractClaims: async () => [] }));
import { CreditExecutionError, executeWithCredits } from "@/lib/billing/credit-execution";
const key = "22222222-2222-4222-8222-222222222222";
const call = (body: unknown = { companyId: "link" }) =>
  POST(
    new Request("https://signal.test/api/enrich-company", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.hosted = true;
  h.domain = "acme.test";
  h.existing.mockResolvedValue(false);
  h.reviews.mockRejectedValue(new Error("Reviews offline"));
  h.recent.mockResolvedValue(false);
  h.paid.mockResolvedValue({ companyId: "org", contactsFound: 2 });
  h.action.mockImplementation(async () =>
    Response.json({ companyId: "org", enrichmentData: {}, contactsFound: 2 }),
  );
});
it("binds the company and campaign to a verified paid request", async () => {
  expect((await call()).status).toBe(200);
  expect(h.paid).toHaveBeenCalledWith(
    expect.objectContaining({
      identity: { userId: "owner", source: "web" },
      key,
      kind: "company.enrich.web",
      request: { organizationId: "org", campaignId: "campaign" },
    }),
    expect.any(Function),
  );
  expect(h.action).not.toHaveBeenCalled();
});
it("reserves cached-company requests because they still perform new contact discovery", async () => {
  h.recent.mockResolvedValue(true);
  await call();
  expect(h.paid).toHaveBeenCalledTimes(1);
});
it("serializes the research response inside the replayable operation", async () => {
  h.paid.mockImplementation(async (_request, work) => {
    const result = await work();
    expect(result).not.toBeInstanceOf(Response);
    return result;
  });
  expect(await (await call()).json()).toMatchObject({ contactsFound: 2 });
});
it.each([402, 409, 503])(
  "preserves billing failure status %i",
  async (status) => {
    h.paid.mockRejectedValue(new CreditExecutionError("Blocked", status));
    expect((await call()).status).toBe(status);
    expect(h.action).not.toHaveBeenCalled();
  },
);
it("rejects campaign/link mismatch before research", async () => {
  expect(
    (await call({ companyId: "link", campaignId: "different" })).status,
  ).toBe(400);
  expect(h.action).not.toHaveBeenCalled();
  expect(h.paid).not.toHaveBeenCalled();
});
it("preserves self-hosted direct execution", async () => {
  h.hosted = false;
  expect((await call()).status).toBe(200);
  expect(h.paid).not.toHaveBeenCalled();
  expect(h.action).toHaveBeenCalled();
});
it.each([null, { companyId: 5 }])(
  "rejects malformed request bodies",
  async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(h.action).not.toHaveBeenCalled();
  },
);

it("does not settle complete provider failure as successful enrichment", async () => {
  h.provider.mockRejectedValue(new Error("Provider offline"));
  h.action.mockImplementation(async (_label, work) => work());
  h.paid.mockImplementation(async (_request, work) => {
    await expect(work()).rejects.toThrow("All company research sources failed");
    throw new CreditExecutionError("Uncertain operation", 409);
  });
  expect((await call()).status).toBe(409);
});
it("propagates failed contact discovery when the company profile is cached", async () => {
  h.recent.mockResolvedValue(true);
  h.discovery.mockResolvedValue({ error: "Discovery failed", totalFound: 0 });
  h.action.mockImplementation(async (_label, work) => work());
  h.paid.mockImplementation(async (_request, work) => {
    await expect(work()).rejects.toThrow("Discovery failed");
    throw new CreditExecutionError("Uncertain operation", 409);
  });
  expect((await call()).status).toBe(409);
});
it("rejects blank campaign context before reserving a cached discovery run", async () => {
  h.recent.mockResolvedValue(true);
  expect((await call({ companyId: "link", campaignId: "" })).status).toBe(400);
  expect(h.paid).not.toHaveBeenCalled();
});

it("does not count a reviews miss as successful research when every other source fails", async () => {
  h.provider.mockRejectedValue(new Error("Provider offline"));
  h.reviews.mockResolvedValue({ found: false });
  h.action.mockImplementation(async (_label, work) => work());
  h.paid.mockImplementation(async (_request, work) => {
    await expect(work()).rejects.toThrow("All company research sources failed");
    throw new CreditExecutionError("Uncertain operation", 409);
  });
  expect((await call()).status).toBe(409);
  expect(h.discovery).not.toHaveBeenCalled();
});

it("replays a domainless company request instead of returning a synthetic cached result", async () => {
  h.domain = null;
  h.recent.mockResolvedValue(true);
  h.existing.mockResolvedValue(true);
  h.paid.mockResolvedValue({ companyId: "org", contactsFound: 0, errors: ["Original error"] });
  expect(await (await call()).json()).toEqual({ companyId: "org", contactsFound: 0, errors: ["Original error"] });
  expect(h.action).not.toHaveBeenCalled();
});
it("preserves unresolved billing status for recent domainless companies", async () => {
  h.domain = null;
  h.recent.mockResolvedValue(true);
  h.existing.mockResolvedValue(true);
  h.paid.mockRejectedValue(new CreditExecutionError("Unresolved", 409));
  expect((await call()).status).toBe(409);
});
it("keeps new domainless cached reads free", async () => {
  h.domain = null;
  h.recent.mockResolvedValue(true);
  expect(await (await call()).json()).toMatchObject({ skipped: true });
  expect(h.paid).not.toHaveBeenCalled();
});

function useRealCreditExecution() {
  h.action.mockImplementation(async (_label, work) => work());
  h.rpc.mockImplementation(async (name) => ({ data:
    name === "reserve_credit_quote" ? { id: "operation", state: "reserved", credits: 5 } : true,
  }));
  h.paid.mockImplementation((input, work) => executeWithCredits({
    ...input, identity: { ...input.identity, workspaceId: "workspace" }, credits: 5, rateVersion: "v1",
  }, work));
}
it("does not settle an empty business match when all research sources failed", async () => {
  useRealCreditExecution();
  h.provider.mockRejectedValue(new Error("Provider offline"));
  h.reviews.mockResolvedValue({ found: true, reviews: [], userRatingCount: 0 });
  h.discovery.mockResolvedValue({ totalFound: 0 });
  expect((await call()).status).toBe(500);
  expect(h.rpc).toHaveBeenLastCalledWith("finish_credit_operation",
    expect.objectContaining({ p_state: "uncertain", p_charged: null }));
  expect(h.rpc.mock.calls.some(([name]) => name === "finish_serialized_credit_result")).toBe(false);
});
it("executes research for a reserved domainless operation instead of charging a cache-only callback", async () => {
  useRealCreditExecution();
  h.domain = null;
  h.recent.mockResolvedValue(true);
  h.existing.mockResolvedValue(true);
  h.provider.mockRejectedValue(new Error("Provider offline"));
  expect((await call()).status).toBe(500);
  expect(h.provider).toHaveBeenCalled();
  expect(h.rpc).toHaveBeenLastCalledWith("finish_credit_operation",
    expect.objectContaining({ p_state: "uncertain" }));
});
it("accepts actual review evidence as a partial research result", async () => {
  useRealCreditExecution();
  h.provider.mockRejectedValue(new Error("Provider offline"));
  h.reviews.mockResolvedValue({ found: true, rating: 4.5, reviews: [], userRatingCount: 3 });
  h.discovery.mockResolvedValue({ totalFound: 0 });
  const response = await call();
  expect(response.status).toBe(200);
  expect((await response.json()).enrichmentData.googleReviews.rating).toBe(4.5);
  expect(h.rpc).toHaveBeenLastCalledWith("finish_serialized_credit_result",
    expect.objectContaining({ p_charged: 5 }));
});
