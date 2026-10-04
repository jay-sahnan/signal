import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  lookup: vi.fn(),
  filter: vi.fn(),
  rows: [] as unknown[],
  hosted: true,
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/tools/email-tools", () => ({ findEmailForPerson: h.lookup }));
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
import { POST } from "@/app/api/find-email/bulk/route";
import { getCurrentIdentity } from "@/lib/auth/identity";
import { CreditExecutionError } from "@/lib/billing/credit-execution";
const one = "11111111-1111-4111-8111-111111111111";
const two = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
const person = (id: string, work_email: string | null = null) => ({
  person: {
    id,
    work_email,
    organization_id: "org",
    affiliation_confidence: 0.9,
  },
});
const request = (personIds: unknown = [one], operationKey = key) =>
  new Request("https://signal.test/api/find-email/bulk", {
    method: "POST",
    headers: { "Idempotency-Key": operationKey },
    body: JSON.stringify({
      campaignId: "campaign",
      organizationId: "org",
      personIds,
    }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.hosted = true;
  h.filter.mockImplementation(() => ({ eq: async () => ({ data: h.rows }) }));
  h.rows = [person(one), person(two)];
  h.lookup.mockImplementation(async (personId) => ({
    personId,
    email: "a@example.com",
  }));
});
it("keeps the selected contacts and per-contact keys fixed across retries", async () => {
  h.lookup.mockImplementation(async (personId) => {
    expect(getCurrentIdentity()).toMatchObject({
      userId: "owner",
      source: "web",
    });
    return { personId, email: "a@example.com" };
  });
  expect((await POST(request())).status).toBe(200);
  const firstKey = h.lookup.mock.calls[0][1]?.operationKey;
  expect(firstKey).toMatch(/^[0-9a-f-]{36}$/);
  h.rows = [person(one, "a@example.com"), person(two)];
  await POST(request());
  expect(h.lookup.mock.calls.map(([id]) => id)).toEqual([one, one]);
  expect(h.lookup.mock.calls[1][1]?.operationKey).toBe(firstKey);
});
it("stops on payment failure instead of reporting not-found", async () => {
  h.lookup.mockRejectedValueOnce(
    new CreditExecutionError("Insufficient credits", 402),
  );
  const res = await POST(request([one, two]));
  expect(res.status).toBe(402);
  expect((await res.json()).error).toBe("Insufficient credits");
  expect(h.lookup).toHaveBeenCalledTimes(1);
});
it.each([undefined, [], [one, one], Array(51).fill(one), [5]])(
  "rejects missing or invalid frozen targets",
  async (ids) => {
    const req = ids === undefined ? request(null) : request(ids);
    expect((await POST(req)).status).toBe(400);
    expect(h.lookup).not.toHaveBeenCalled();
  },
);
it("requires a valid batch key before research", async () => {
  expect((await POST(request([one], "bad"))).status).toBe(400);
  expect(h.lookup).not.toHaveBeenCalled();
});
it("still enforces current organization and affiliation eligibility", async () => {
  h.rows = [
    {
      person: { id: one, organization_id: "other", affiliation_confidence: 1 },
    },
  ];
  await POST(request());
  expect(h.lookup).not.toHaveBeenCalled();
});

it("filters selected IDs before the database row limit is applied", async () => {
  await POST(request([two]));
  expect(h.filter).toHaveBeenCalledWith("person_id", [two]);
});
