import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  paid: vi.fn(),
  existing: vi.fn(),
  work: vi.fn(),
  recent: vi.fn(),
  hosted: true,
  owner: "owner",
  name: "Ada",
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid, hasPaidAction: h.existing }));
vi.mock("@/lib/services/person-enrichment", () => ({
  enrichPerson: h.work,
  PERSON_ENRICH_COLUMNS: "name",
}));
vi.mock("@/lib/services/knowledge-base", () => ({
  isRecentlyEnriched: h.recent,
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAndUser: async () => ({
    user: { id: "owner" },
    supabase: {
      from: (table: string) => {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data: { person_id: "person", campaign: { user_id: h.owner } },
          }),
          single: async () => ({
            data:
              table === "people" ? { name: h.name, enrichment_data: {} } : null,
          }),
        };
        return q;
      },
    },
  }),
}));
import { POST } from "@/app/api/enrich/route";
import { CreditExecutionError } from "@/lib/billing/credit-execution";
const key = "22222222-2222-4222-8222-222222222222";
const call = (body: unknown = { contactId: "link" }) =>
  POST(
    new Request("https://signal.test/api/enrich", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.hosted = true;
  h.existing.mockResolvedValue(false);
  h.owner = "owner";
  h.name = "Ada";
  h.recent.mockResolvedValue(false);
  h.work.mockResolvedValue({ status: "enriched", enrichmentData: {} });
  h.paid.mockResolvedValue({
    status: "enriched",
    enrichmentData: { cached: true },
  });
});
it("uses verified identity, canonical person ID and the stable website key", async () => {
  const res = await call();
  expect(res.status).toBe(200);
  expect(h.paid).toHaveBeenCalledWith(
    expect.objectContaining({
      identity: { userId: "owner", source: "web" },
      key,
      kind: "contact.enrich.web",
      request: { personId: "person" },
    }),
    expect.any(Function),
  );
  expect(h.work).not.toHaveBeenCalled();
});
it("returns fresh cached data without reserving", async () => {
  h.recent.mockResolvedValue(true);
  expect((await call()).status).toBe(200);
  expect(h.paid).not.toHaveBeenCalled();
  expect(h.work).not.toHaveBeenCalled();
});
it.each([402, 409, 503])(
  "returns billing status %i without provider work",
  async (status) => {
    h.paid.mockRejectedValue(new CreditExecutionError("Blocked", status));
    expect((await call()).status).toBe(status);
    expect(h.work).not.toHaveBeenCalled();
  },
);
it("does not reserve for a foreign campaign link", async () => {
  h.owner = "other";
  expect((await call()).status).toBe(403);
  expect(h.paid).not.toHaveBeenCalled();
});
it("throws inside the reservation if all enrichment sources fail", async () => {
  h.work.mockResolvedValue({ status: "failed", enrichmentData: {} });
  h.paid.mockImplementation(async (_request, work) => {
    await expect(work()).rejects.toThrow("All enrichment sources failed");
    throw new CreditExecutionError("Outcome uncertain", 409);
  });
  expect((await call()).status).toBe(409);
});
it("preserves self-hosted direct execution", async () => {
  h.hosted = false;
  expect((await call()).status).toBe(200);
  expect(h.paid).not.toHaveBeenCalled();
  expect(h.work).toHaveBeenCalled();
});
it.each([null, { contactId: 5 }])("rejects malformed input", async (body) => {
  expect((await call(body)).status).toBe(400);
  expect(h.work).not.toHaveBeenCalled();
});

it("returns the saved paid contact response after enrichment becomes recent", async () => {
  h.recent.mockResolvedValue(true);
  h.existing.mockResolvedValue(true);
  expect(await (await call()).json()).toMatchObject({ enrichmentData: { cached: true } });
  expect(h.paid).toHaveBeenCalledTimes(1);
  expect(h.work).not.toHaveBeenCalled();
});
it("returns unresolved billing status even if contact data is recent", async () => {
  h.recent.mockResolvedValue(true);
  h.existing.mockResolvedValue(true);
  h.paid.mockRejectedValue(new CreditExecutionError("Unresolved", 409));
  expect((await call()).status).toBe(409);
});

it("replays original results even when mutable source fields were removed", async () => {
  h.name = "Unknown";
  h.existing.mockResolvedValue(true);
  expect((await call()).status).toBe(200);
  expect(h.paid).toHaveBeenCalledTimes(1);
});
it("still rejects new work without sources before reserving", async () => {
  h.name = "Unknown";
  expect((await call()).status).toBe(400);
  expect(h.paid).not.toHaveBeenCalled();
});
