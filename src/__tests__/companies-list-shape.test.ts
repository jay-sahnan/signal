import { describe, expect, it, vi } from "vitest";

const fakeRows = [
  {
    id: "co1",
    organization_id: "o1",
    campaign_id: "c1",
    relevance_score: 9,
    score_reason: "perfect ICP",
    status: "qualified",
    created_at: "2026-04-18T00:00:00Z",
    updated_at: "2026-04-18T00:00:00Z",
    organization: {
      name: "Acme",
      domain: "acme.com",
      url: "https://acme.com",
      industry: "SaaS",
      location: "SF",
      description: "short desc",
      enrichment_data: { website_summary: "SHOULD_NOT_APPEAR_IN_LIST" },
      enrichment_status: "enriched",
      source: "exa",
    },
  },
];

const mockRange = vi
  .fn()
  .mockResolvedValue({ data: fakeRows, error: null, count: fakeRows.length });
const mockOrder = vi.fn(() => ({ range: mockRange }));
const mockEq = vi.fn(() => ({ order: mockOrder }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn((_table?: string) => ({ select: mockSelect }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi
    .fn()
    .mockResolvedValue({ from: (table: string) => mockFrom(table) }),
}));

import { getCompanies } from "@/lib/tools/search-tools";

describe("getCompanies return shape", () => {
  it("omits enrichment_data from each row", async () => {
    const result = (await getCompanies.execute!(
      { campaignId: "c1" },
      {} as never,
    )) as { companies: Array<Record<string, unknown>> };

    expect(result.companies).toHaveLength(1);
    const row = result.companies[0];
    expect(row).not.toHaveProperty("enrichment_data");
    expect(JSON.stringify(row)).not.toContain("SHOULD_NOT_APPEAR_IN_LIST");
    expect(row).toMatchObject({
      organization_id: "o1",
      name: "Acme",
      domain: "acme.com",
      relevance_score: 9,
    });
  });

  it("selects named columns only, never organizations(*)", async () => {
    await getCompanies.execute!({ campaignId: "c1" }, {} as never);
    const selectArg = String((mockSelect.mock.calls.at(-1) as unknown[])[0]);
    expect(selectArg).not.toContain("*");
    expect(selectArg).not.toContain("enrichment_data");
  });

  it("pages with limit/offset and reports total + hasMore", async () => {
    mockRange.mockResolvedValueOnce({ data: fakeRows, error: null, count: 7 });
    const result = (await getCompanies.execute!(
      { campaignId: "c1", limit: 1, offset: 2 },
      {} as never,
    )) as { total: number; limit: number; offset: number; hasMore: boolean };
    expect(mockRange).toHaveBeenLastCalledWith(2, 2);
    expect(result).toMatchObject({
      total: 7,
      limit: 1,
      offset: 2,
      hasMore: true,
    });
  });

  it("clips long descriptions in list rows", async () => {
    const long = "x".repeat(1000);
    mockRange.mockResolvedValueOnce({
      data: [
        {
          ...fakeRows[0],
          organization: { ...fakeRows[0].organization, description: long },
        },
      ],
      error: null,
      count: 1,
    });
    const result = (await getCompanies.execute!(
      { campaignId: "c1" },
      {} as never,
    )) as { companies: Array<{ description: string }> };
    expect(result.companies[0].description.length).toBeLessThan(300);
  });
});
