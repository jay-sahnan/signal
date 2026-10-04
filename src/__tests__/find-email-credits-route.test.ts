import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  hosted: true,
  lookup: vi.fn(),
  auth: vi.fn(),
  owner: vi.fn(),
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAndUser: h.auth }));
vi.mock("@/lib/tools/email-tools", () => ({ findEmailForPerson: h.lookup }));
import { POST } from "@/app/api/find-email/route";
import { getCurrentIdentity } from "@/lib/auth/identity";
import { CreditExecutionError } from "@/lib/billing/credit-execution";
const key = "22222222-2222-4222-8222-222222222222";
const request = (body: unknown = { personId: "person" }) =>
  new Request("https://signal.test/api/find-email", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.hosted = true;
  h.owner.mockResolvedValue({ data: { campaign: { user_id: "owner" } } });
  h.auth.mockResolvedValue({
    user: { id: "owner" },
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({ limit: () => ({ maybeSingle: h.owner }) }),
        }),
      }),
    },
  });
  h.lookup.mockResolvedValue({ email: null, personId: "person" });
});
it("forwards the retry key under the verified web identity", async () => {
  h.lookup.mockImplementation(async () => {
    expect(getCurrentIdentity()).toMatchObject({
      userId: "owner",
      source: "web",
    });
    return { email: "ada@example.com", personId: "person" };
  });
  expect((await POST(request())).status).toBe(200);
  expect(h.lookup).toHaveBeenCalledWith("person", {
    operationKey: key,
    revalidate: false,
  });
});
it.each([400, 402, 409, 503])(
  "preserves credit failure HTTP status %i",
  async (status) => {
    h.lookup.mockRejectedValue(
      new CreditExecutionError("Lookup blocked", status),
    );
    const res = await POST(request());
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: "Lookup blocked" });
  },
);
it("rejects foreign contacts before entering research", async () => {
  h.owner.mockResolvedValue({ data: { campaign: { user_id: "other" } } });
  expect((await POST(request())).status).toBe(403);
  expect(h.lookup).not.toHaveBeenCalled();
});
it.each([null, [], { personId: 5 }])(
  "rejects malformed bodies before ownership reads",
  async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(h.owner).not.toHaveBeenCalled();
  },
);

it("preserves the Clerk client path for self-hosted web requests", async () => {
  h.hosted = false;
  h.lookup.mockImplementation(async () => {
    expect(getCurrentIdentity()).toBeUndefined();
    return { email: null, personId: "person" };
  });
  expect((await POST(request())).status).toBe(200);
});
