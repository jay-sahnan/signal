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

const mockOrder = vi.fn().mockResolvedValue({ data: fakeRows, error: null });
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
});
