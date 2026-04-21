import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSingle = vi.fn();
const mockEq = vi.fn(() => ({ single: mockSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn((_table?: string) => ({ select: mockSelect }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi
    .fn()
    .mockResolvedValue({ from: (table: string) => mockFrom(table) }),
}));

import { getCompanyDetail } from "@/lib/tools/search-tools";

describe("getCompanyDetail", () => {
  beforeEach(() => {
    mockSingle.mockReset();
  });

  it("returns one company with full enrichment_data", async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: "o1",
        name: "Acme",
        domain: "acme.com",
        industry: "SaaS",
        enrichment_data: { website_summary: "long...", exa_results: [1, 2, 3] },
        enrichment_status: "enriched",
      },
      error: null,
    });

    const result = await getCompanyDetail.execute!(
      { organizationId: "o1" },
      {} as never,
    );

    expect(mockFrom).toHaveBeenCalledWith("organizations");
    expect(result).toMatchObject({
      id: "o1",
      name: "Acme",
      enrichment_data: { website_summary: "long...", exa_results: [1, 2, 3] },
    });
  });

  it("returns error when company not found", async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "nope" },
    });
    const result = await getCompanyDetail.execute!(
      { organizationId: "x" },
      {} as never,
    );
    expect(result).toEqual({ error: expect.stringContaining("nope") });
  });
});
