import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ hosted: true, owns: true, owner: "owner", paid: vi.fn(), provider: vi.fn(), merge: vi.fn(), insert: vi.fn(), signal: true }));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid }));
vi.mock("@/lib/tools/ownership", () => ({ callerHoldsOrganization: async () => h.owns, toolSession: async () => ({ userId: "owner", supabase: db }), notFound: () => ({ error: "Company not found." }) }));
vi.mock("@/lib/services/google-places-service", () => ({ GooglePlacesService: class { getPlaceReviews = h.provider; } }));
vi.mock("@/lib/services/knowledge-base", () => ({ mergeEnrichmentData: h.merge }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
const db = { from: (table: string) => {
  const q = { select: () => q, eq: () => q,
    maybeSingle: async () => ({ data: table === "campaigns" ? { user_id: h.owner } : h.signal ? { id: "signal" } : null, error: null }),
    insert: h.insert };
  return q;
} };
import { getGoogleReviews } from "@/lib/tools/enrichment-tools";
import { runWithIdentity } from "@/lib/auth/identity";
const key = "11111111-1111-4111-8111-111111111111";
const call = (extra = {}) => runWithIdentity({ userId: "owner", source: "mcp" }, () => getGoogleReviews.execute!({ organizationId: "company", companyName: "Acme", operationId: key, ...extra } as never, { toolCallId: "call", messages: [] }));
beforeEach(() => {
  vi.clearAllMocks(); h.hosted = true; h.owns = true; h.owner = "owner"; h.signal = true;
  h.paid.mockImplementation(async (_input, work) => work());
  h.provider.mockResolvedValue({ found: true, reviews: [], rating: 4 });
  h.merge.mockResolvedValue(undefined); h.insert.mockResolvedValue({ error: null });
});
it("denies an empty wallet before provider work or persistence", async () => {
  h.paid.mockRejectedValue(new Error("Insufficient credits")); await expect(call()).rejects.toThrow("Insufficient credits");
  expect(h.provider).not.toHaveBeenCalled(); expect(h.merge).not.toHaveBeenCalled();
});
it("replays without provider work or writes", async () => {
  h.paid.mockResolvedValue({ found: true, replay: true }); await expect(call()).resolves.toMatchObject({ replay: true });
  expect(h.provider).not.toHaveBeenCalled(); expect(h.merge).not.toHaveBeenCalled();
});
it("authorizes the company before reserving", async () => {
  h.owns = false; await expect(call()).resolves.toHaveProperty("error"); expect(h.paid).not.toHaveBeenCalled(); expect(h.provider).not.toHaveBeenCalled();
});
it("authorizes the optional campaign before reserving", async () => {
  h.owner = "other"; await expect(call({ campaignId: "campaign" })).resolves.toHaveProperty("error"); expect(h.paid).not.toHaveBeenCalled();
});
it("binds all provider inputs and the persistence scope", async () => {
  await call({ location: "London", domain: "acme.test", campaignId: "campaign" });
  expect(h.paid).toHaveBeenCalledWith(expect.objectContaining({ key, kind: "company.reviews", request: { organizationId: "company", companyName: "Acme", location: "London", domain: "acme.test", campaignId: "campaign" } }), expect.any(Function));
  expect(h.provider).toHaveBeenCalledOnce(); expect(h.merge).toHaveBeenCalledOnce();
});
it("does not settle an error-shaped provider failure as success", async () => {
  h.provider.mockResolvedValue({ found: false, error: "Timed out", reviews: [] });
  await expect(call()).rejects.toThrow("Timed out"); expect(h.merge).not.toHaveBeenCalled();
});
it("propagates failed persistence instead of settling success", async () => {
  h.merge.mockRejectedValue(new Error("Write failed")); await expect(call()).rejects.toThrow("Write failed");
});
it("does not settle missing requested signal history as success", async () => {
  h.insert.mockResolvedValue({ error: { message: "Write failed" } });
  await expect(call({ campaignId: "campaign" })).rejects.toThrow(/history/i);
});
it("retains self-hosted unbilled behavior", async () => {
  h.hosted = false; await expect(call()).resolves.toMatchObject({ found: true }); expect(h.paid).not.toHaveBeenCalled();
});
