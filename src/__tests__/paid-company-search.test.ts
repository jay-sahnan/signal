import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  paid: vi.fn(),
  search: vi.fn(),
  owner: "owner" as string | null,
}));
vi.mock("@/lib/auth/acting-user", () => ({
  actingUserId: async () => "owner",
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => true }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: h.owner ? { user_id: h.owner } : null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/services/exa-service", () => ({
  ExaService: class {
    search = h.search;
  },
}));
import { searchCompanies } from "@/lib/tools/search-tools";
import { runWithIdentity } from "@/lib/auth/identity";
const key = "22222222-2222-4222-8222-222222222222";
const execute = (extra = {}) =>
  runWithIdentity({ userId: "owner", source: "mcp" }, () =>
    searchCompanies.execute!(
      {
        query: "robotics",
        numResults: 10,
        includeText: false,
        operationId: key,
        ...extra,
      } as never,
      { toolCallId: "call", messages: [] },
    ),
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner";
  h.paid.mockResolvedValue({ companies: [], replay: true });
  h.search.mockResolvedValue({ results: [], resultCount: 0 });
});
it("blocks paid search when credits are unavailable", async () => {
  h.paid.mockRejectedValue(new Error("Insufficient credits"));
  await expect(execute()).rejects.toThrow("Insufficient credits");
  expect(h.search).not.toHaveBeenCalled();
});
it.each(["foreign", null])(
  "rejects an inaccessible campaign before reserving credits: %s",
  async (owner) => {
    h.owner = owner;
    await expect(
      execute({ campaignId: "11111111-1111-4111-8111-111111111111" }),
    ).resolves.toHaveProperty("error");
    expect(h.paid).not.toHaveBeenCalled();
    expect(h.search).not.toHaveBeenCalled();
  },
);
it("quotes result quantity and a stable canonical request", async () => {
  await execute();
  expect(h.paid).toHaveBeenCalledWith(
    expect.objectContaining({
      key,
      kind: "company.search",
      units: 10,
      request: {
        query: "robotics",
        numResults: 10,
        includeText: false,
        category: null,
        campaignId: null,
      },
    }),
    expect.any(Function),
  );
});
it("replays a completed search without spending provider credits again", async () => {
  await expect(execute()).resolves.toMatchObject({ replay: true });
  expect(h.search).not.toHaveBeenCalled();
});
it("only calls the provider inside the ledger callback", async () => {
  h.paid.mockImplementation(async (_input, work) => {
    expect(h.search).not.toHaveBeenCalled();
    return work();
  });
  await expect(execute()).resolves.toMatchObject({ totalFound: 0 });
  expect(h.search).toHaveBeenCalledTimes(1);
});
