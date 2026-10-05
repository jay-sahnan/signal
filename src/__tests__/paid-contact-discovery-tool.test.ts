import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSupabaseFake } from "./helpers/supabase-fake";
const h = vi.hoisted(() => ({ paid: vi.fn(), discovery: vi.fn(), holds: vi.fn(), hosted: true, owner: "owner", linked: true, titles: ["engineer"] }));
const org = "11111111-1111-4111-8111-111111111111";
const campaign = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
function db() { return createSupabaseFake({ tables: {
  campaigns: () => [{ id: campaign, user_id: h.owner, icp: { targetTitles: h.titles } }],
  organizations: () => [{ id: org }],
  campaign_organizations: () => h.linked ? [{ id: "44444444-4444-4444-8444-444444444444", organization_id: org, campaign_id: campaign }] : [],
} }); }
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid }));
vi.mock("@/lib/services/contact-discovery", () => ({ findContactsForOrganization: h.discovery, affiliationNotes: () => "" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db() }));
vi.mock("@/lib/tools/ownership", async original => ({ ...(await original<object>()), toolSession: async () => ({ userId: "owner", supabase: db() }), callerHoldsOrganization: h.holds }));
import { findContacts } from "@/lib/tools/enrichment-tools";
import { runWithIdentity } from "@/lib/auth/identity";
const run = (extra = {}) => runWithIdentity({ userId: "owner", source: "mcp" }, () => findContacts.execute!(
  (findContacts.inputSchema as z.ZodType).parse({ organizationId: org, campaignId: campaign, operationId: key, ...extra }) as never, {} as never,
));
beforeEach(() => {
  vi.clearAllMocks(); h.hosted = true; h.owner = "owner"; h.linked = true; h.titles = ["engineer"];
  h.holds.mockResolvedValue(true);
  const result = { companyName: "Acme", contacts: [], searchesRun: [], totalFound: 0, teamPageUnlinked: 0, targetTitles: ["engineer"] };
  h.paid.mockResolvedValue(result); h.discovery.mockResolvedValue(result);
});
it("reserves discovery using the supplied MCP key after ownership validation", async () => {
  await run();
  expect(h.paid).toHaveBeenCalledWith(expect.objectContaining({ key, kind: "contact.discover", request: expect.objectContaining({ organizationId: org, campaignId: campaign, titles: null }) }), expect.any(Function));
  expect(h.discovery).not.toHaveBeenCalled();
});
it("does no provider work when the wallet refuses discovery", async () => {
  h.paid.mockRejectedValue(new Error("Insufficient credits"));
  await expect(run()).rejects.toThrow("Insufficient credits");
  expect(h.discovery).not.toHaveBeenCalled();
});
it("rejects foreign campaigns even when explicit titles bypass ICP loading", async () => {
  h.owner = "foreign";
  await expect(run({ titles: ["founder"] })).rejects.toThrow("Campaign not found");
  expect(h.paid).not.toHaveBeenCalled();
});
it("rejects mismatched organization/campaign pairs before billing", async () => {
  h.linked = false;
  await expect(run()).rejects.toThrow("Company not found");
  expect(h.paid).not.toHaveBeenCalled();
});
it("authorizes standalone organization discovery before billing", async () => {
  h.holds.mockResolvedValue(false);
  await expect(run({ campaignId: undefined, titles: ["founder"] })).rejects.toThrow("Company not found");
  expect(h.paid).not.toHaveBeenCalled();
});
it("keeps retry binding stable when campaign-derived titles change", async () => {
  await run(); h.titles = ["designer"]; await run();
  expect(h.paid.mock.calls[0][0].request).toEqual(h.paid.mock.calls[1][0].request);
});
it("preserves self-hosted discovery without credit reservation", async () => {
  h.hosted = false; await run();
  expect(h.paid).not.toHaveBeenCalled(); expect(h.discovery).toHaveBeenCalledTimes(1);
});

it("replays the original titles after ICP edits or removal", async () => {
  h.titles = [];
  expect(await run()).toMatchObject({ targetTitles: ["engineer"] });
  expect(h.paid).toHaveBeenCalledTimes(1);
  expect(h.discovery).not.toHaveBeenCalled();
});
