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

import { getContactDetail } from "@/lib/tools/enrichment-tools";

describe("getContactDetail", () => {
  beforeEach(() => {
    mockSingle.mockReset();
    mockFrom.mockClear();
  });

  it("returns one contact with full enrichment_data and company enrichment", async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: "p1",
        name: "Alice",
        title: "CTO",
        work_email: "alice@acme.com",
        personal_email: null,
        linkedin_url: "https://linkedin.com/in/alice",
        twitter_url: null,
        enrichment_status: "enriched",
        enrichment_data: { bio: "Long LinkedIn bio..." },
        organization: {
          id: "o1",
          name: "Acme",
          domain: "acme.com",
          industry: "SaaS",
          enrichment_data: { website_summary: "..." },
        },
      },
      error: null,
    });

    const result = await getContactDetail.execute!(
      { personId: "p1" },
      {} as never,
    );

    expect(mockFrom).toHaveBeenCalledWith("people");
    expect(result).toMatchObject({
      id: "p1",
      name: "Alice",
      enrichment_data: { bio: "Long LinkedIn bio..." },
      company: { name: "Acme", enrichment_data: { website_summary: "..." } },
    });
  });

  it("returns error when contact not found", async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "not found" },
    });

    const result = await getContactDetail.execute!(
      { personId: "missing" },
      {} as never,
    );

    expect(result).toEqual({ error: expect.stringContaining("not found") });
  });
});
