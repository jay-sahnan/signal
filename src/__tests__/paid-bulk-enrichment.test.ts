import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  paid: vi.fn(),
  existing: vi.fn(),
  work: vi.fn(),
  recent: vi.fn(),
  filter: vi.fn(),
  hosted: true,
  rows: [] as unknown[],
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
      from: (table: string) => ({
        select: () => ({
          eq: () =>
            table === "campaigns"
              ? { maybeSingle: async () => ({ data: { user_id: "owner" } }) }
              : Object.assign(Promise.resolve({ data: h.rows }), {
                  in: h.filter,
                }),
        }),
      }),
    },
  }),
}));
import { POST } from "@/app/api/enrich/bulk/route";
import { CreditExecutionError } from "@/lib/billing/credit-execution";
const one = "11111111-1111-4111-8111-111111111111";
const two = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
const request = (personIds: unknown = [one], retryKey = key) =>
  new Request("https://signal.test/api/enrich/bulk", {
    method: "POST",
    headers: { "Idempotency-Key": retryKey },
    body: JSON.stringify({
      campaignId: "campaign",
      organizationId: "org",
      personIds,
    }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.hosted = true;
  h.existing.mockResolvedValue(false);
  h.rows = [one, two].map((id) => ({
    person: { id, name: "Ada", organization_id: "org" },
  }));
  h.filter.mockImplementation(() => ({ eq: async () => ({ data: h.rows }) }));
  h.recent.mockResolvedValue(false);
  h.paid.mockResolvedValue({ status: "enriched" });
  h.work.mockResolvedValue({ status: "enriched", enrichmentData: {} });
});
it("filters selected IDs before retrieval and keeps per-contact keys stable", async () => {
  await POST(request());
  await POST(request());
  expect(h.filter).toHaveBeenCalledWith("person_id", [one]);
  expect(h.paid).toHaveBeenCalledTimes(2);
  expect(h.paid.mock.calls[0][0]).toMatchObject({
    identity: { userId: "owner", source: "web" },
    kind: "contact.enrich.web",
    request: { personId: one },
  });
  expect(h.paid.mock.calls[0][0].key).toMatch(/^[0-9a-f-]{36}$/);
  expect(h.paid.mock.calls[0][0].key).toBe(h.paid.mock.calls[1][0].key);
  expect(h.work).not.toHaveBeenCalled();
});
it("does not reserve for fresh cached enrichment", async () => {
  h.recent.mockResolvedValue(true);
  expect((await POST(request())).status).toBe(200);
  expect(h.paid).not.toHaveBeenCalled();
});
it("surfaces payment failure and stops scheduling the rest of the batch", async () => {
  h.paid.mockRejectedValue(
    new CreditExecutionError("Insufficient credits", 402),
  );
  const ids = Array.from(
    { length: 8 },
    (_, i) => `11111111-1111-4111-8111-11111111111${i}`,
  );
  h.rows = ids.map((id) => ({
    person: { id, name: "Ada", organization_id: "org" },
  }));
  const res = await POST(request(ids));
  expect(res.status).toBe(402);
  expect((await res.json()).error).toBe("Insufficient credits");
  expect(h.paid.mock.calls.length).toBeLessThanOrEqual(4);
  expect(h.work).not.toHaveBeenCalled();
});
it("throws total research failure inside the ledger callback", async () => {
  h.work.mockResolvedValue({ status: "failed", enrichmentData: {} });
  h.paid.mockImplementation(async (_req, work) => {
    await expect(work()).rejects.toThrow("All enrichment sources failed");
    throw new CreditExecutionError("Uncertain operation", 409);
  });
  expect((await POST(request())).status).toBe(409);
});
it.each([null, [], [one, one], Array(11).fill(one)])(
  "rejects invalid frozen selections",
  async (ids) => {
    expect((await POST(request(ids))).status).toBe(400);
    expect(h.paid).not.toHaveBeenCalled();
  },
);
it("rejects invalid retry keys before work", async () => {
  expect((await POST(request([one], "bad"))).status).toBe(400);
  expect(h.work).not.toHaveBeenCalled();
});
it("preserves direct self-hosted execution", async () => {
  h.hosted = false;
  expect((await POST(request())).status).toBe(200);
  expect(h.paid).not.toHaveBeenCalled();
  expect(h.work).toHaveBeenCalled();
});

it("replays paid batch members even if their contact data is now recent", async () => {
  h.recent.mockResolvedValue(true);
  h.existing.mockResolvedValue(true);
  const result = await POST(request());
  expect(result.status).toBe(200);
  expect((await result.json()).enriched).toBe(1);
  expect(h.paid).toHaveBeenCalledTimes(1);
  expect(h.existing.mock.calls[0][0]).toEqual(h.paid.mock.calls[0][0]);
  expect(h.work).not.toHaveBeenCalled();
});
it("does not hide unresolved batch members as cached successes", async () => {
  h.recent.mockResolvedValue(true);
  h.existing.mockResolvedValue(true);
  h.paid.mockRejectedValue(new CreditExecutionError("Unresolved", 409));
  expect((await POST(request())).status).toBe(409);
});

it("checks existing batch outcomes even if a contact's sources were removed", async () => {
  h.rows = [{ person: { id: one, name: "Unknown", organization_id: "org" } }];
  h.existing.mockResolvedValue(true);
  expect((await POST(request())).status).toBe(200);
  expect(h.paid).toHaveBeenCalledTimes(1);
});
