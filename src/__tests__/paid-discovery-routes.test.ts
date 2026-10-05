import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ paid: vi.fn(), discovery: vi.fn(), owner: "owner", linked: "campaign", titles: ["engineer"] }));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => true }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid }));
vi.mock("@/lib/services/contact-discovery", () => ({ findContactsForOrganization: h.discovery }));
vi.mock("@/lib/services/cost-tracker", () => ({ withAction: (_label: string, work: () => unknown) => work() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAndUser: async () => ({ user: { id: "owner" }, supabase: { from: (table: string) => {
  const q = { select: () => q, eq: () => q, limit: () => q, single: async () => ({ data: table === "campaigns"
    ? { user_id: h.owner, icp: { targetTitles: h.titles } }
    : { id: "org", name: "Acme", organization_id: "org", campaign_id: h.linked, campaign: { user_id: h.owner }, organization: { name: "Acme" } } }), maybeSingle: async () => q.single() }; return q;
} } }) }));
import { POST as contacts } from "@/app/api/find-contacts/route";
import { POST as more } from "@/app/api/companies/[id]/find-more-people/route";
import { CreditExecutionError } from "@/lib/billing/credit-execution";
const key = "33333333-3333-4333-8333-333333333333";
const call = (route: "contacts" | "more") => {
  const request = new Request("https://signal.test", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ companyId: "link", campaignId: "campaign" }) });
  return route === "contacts" ? contacts(request) : more(request, { params: Promise.resolve({ id: "org" }) });
};
beforeEach(() => {
  vi.clearAllMocks(); h.owner = "owner"; h.linked = "campaign"; h.titles = ["engineer"];
  h.paid.mockResolvedValue({ contacts: [], totalFound: 0, rejectedAsWrongCompany: 0, targetTitles: ["original"] });
});
for (const route of ["contacts", "more"] as const) {
  it(`${route}: reserves with the stable HTTP key and replays without discovery`, async () => {
    expect((await call(route)).status).toBe(200);
    expect(h.paid).toHaveBeenCalledWith(expect.objectContaining({ key, kind: "contact.discover", identity: { userId: "owner", source: "web" } }), expect.any(Function));
    expect(h.discovery).not.toHaveBeenCalled();
  });
  it(`${route}: returns wallet errors without provider work`, async () => {
    h.paid.mockRejectedValue(new CreditExecutionError("Insufficient credits", 402));
    expect((await call(route)).status).toBe(402);
    expect(h.discovery).not.toHaveBeenCalled();
  });
  it(`${route}: rejects a foreign workspace before billing`, async () => {
    h.owner = "foreign";
    expect((await call(route)).status).toBe(403);
    expect(h.paid).not.toHaveBeenCalled();
  });
}
it("replays saved target titles after mutable ICP changes", async () => {
  h.titles = [];
  expect(await (await call("contacts")).json()).toMatchObject({ targetTitles: ["original"] });
});
