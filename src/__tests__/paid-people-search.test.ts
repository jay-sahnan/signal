import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  paid: vi.fn(),
  search: vi.fn(),
  session: vi.fn(),
  owner: "owner",
  linkCampaign: "campaign",
  db: { from: vi.fn() },
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => true }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid }));
vi.mock("@/lib/tools/ownership", async (original) => ({
  ...(await original<object>()),
  toolSession: h.session,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));
vi.mock("@/lib/services/exa-service", () => ({
  ExaService: class {
    search = h.search;
  },
}));
import { searchPeople } from "@/lib/tools/enrichment-tools";
import { runWithIdentity } from "@/lib/auth/identity";
const key = "22222222-2222-4222-8222-222222222222";
const execute = (extra = {}) =>
  runWithIdentity({ userId: "owner", source: "mcp" }, () =>
    searchPeople.execute!(
      {
        query: "engineers",
        numResults: 5,
        operationId: key,
        ...extra,
      } as never,
      { toolCallId: "call", messages: [] },
    ),
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner";
  h.linkCampaign = "campaign";
  h.session.mockResolvedValue({ supabase: h.db, userId: "owner" });
  h.paid.mockResolvedValue({ people: [], replay: true });
  h.search.mockResolvedValue({ results: [], resultCount: 0 });
  h.db.from.mockImplementation((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data:
            table === "campaigns"
              ? { user_id: h.owner }
              : { campaign_id: h.linkCampaign, campaign: { user_id: h.owner } },
        }),
      }),
    }),
  }));
});
it("requires credits before searching for people", async () => {
  h.paid.mockRejectedValue(new Error("Insufficient credits"));
  await expect(execute()).rejects.toThrow("Insufficient credits");
  expect(h.search).not.toHaveBeenCalled();
});
it.each([{ campaignId: "campaign" }, { companyId: "link" }])(
  "rejects foreign search context before billing: %j",
  async (context) => {
    h.owner = "foreign";
    await expect(execute(context)).resolves.toHaveProperty("error");
    expect(h.paid).not.toHaveBeenCalled();
    expect(h.search).not.toHaveBeenCalled();
  },
);
it("rejects a company link from a different campaign", async () => {
  await expect(
    execute({ campaignId: "different", companyId: "link" }),
  ).resolves.toHaveProperty("error");
  expect(h.paid).not.toHaveBeenCalled();
});
it("replays with the requested quantity and canonical input without provider work", async () => {
  await expect(execute()).resolves.toMatchObject({ replay: true });
  expect(h.paid).toHaveBeenCalledWith(
    expect.objectContaining({
      key,
      kind: "people.search",
      units: 5,
      request: {
        query: "engineers",
        numResults: 5,
        campaignId: null,
        companyId: null,
        companyName: null,
        companyDomain: null,
      },
    }),
    expect.any(Function),
  );
  expect(h.search).not.toHaveBeenCalled();
});
it("rejects anonymous tool execution", async () => {
  h.session.mockResolvedValue(null);
  await expect(execute()).resolves.toHaveProperty("error");
  expect(h.paid).not.toHaveBeenCalled();
});
