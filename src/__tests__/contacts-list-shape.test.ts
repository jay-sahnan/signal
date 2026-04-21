import { describe, expect, it, vi } from "vitest";

const fakeRows = [
  {
    id: "cp1",
    person_id: "p1",
    campaign_id: "c1",
    status: "pending",
    outreach_status: null,
    priority_score: 8,
    score_reason: "good fit",
    created_at: "2026-04-18T00:00:00Z",
    updated_at: "2026-04-18T00:00:00Z",
    person: {
      name: "Alice",
      title: "CTO",
      work_email: "alice@acme.com",
      personal_email: null,
      linkedin_url: "https://linkedin.com/in/alice",
      twitter_url: null,
      enrichment_status: "enriched",
      enrichment_data: { bio: "SHOULD_NOT_APPEAR_IN_LIST" },
      source: "exa",
      organization_id: "o1",
      organization: { name: "Acme", domain: "acme.com", industry: "SaaS" },
    },
  },
];

const mockOrder2 = vi.fn().mockResolvedValue({ data: fakeRows, error: null });
const mockOrder1 = vi.fn(() => ({ order: mockOrder2 }));
const mockEq = vi.fn(() => ({ order: mockOrder1 }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn((_table?: string) => ({ select: mockSelect }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi
    .fn()
    .mockResolvedValue({ from: (table: string) => mockFrom(table) }),
}));

import { getContacts } from "@/lib/tools/enrichment-tools";

describe("getContacts return shape", () => {
  it("omits enrichment_data from each row", async () => {
    const result = (await getContacts.execute!(
      { campaignId: "c1" },
      {} as never,
    )) as { contacts: Array<Record<string, unknown>> };

    expect(result.contacts).toHaveLength(1);
    const row = result.contacts[0];
    expect(row).not.toHaveProperty("enrichment_data");
    expect(JSON.stringify(row)).not.toContain("SHOULD_NOT_APPEAR_IN_LIST");
    // Still carries the fields the agent needs to pick someone to draft for:
    expect(row).toMatchObject({
      person_id: "p1",
      name: "Alice",
      title: "CTO",
      work_email: "alice@acme.com",
      priority_score: 8,
    });
  });
});
