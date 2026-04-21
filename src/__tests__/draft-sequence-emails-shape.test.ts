import { describe, expect, it, vi } from "vitest";

const mockFrom = vi.fn((table: string) => {
  if (table === "sequences") {
    return {
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: "seq1", name: "RE Outreach", campaign_id: "c1" },
            error: null,
          }),
        }),
      }),
    };
  }
  if (table === "sequence_steps") {
    return {
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [
              { id: "st1", step_number: 1, delay_days: 0, condition: null },
              { id: "st2", step_number: 2, delay_days: 3, condition: null },
            ],
            error: null,
          }),
        }),
      }),
    };
  }
  if (table === "sequence_enrollments") {
    return {
      select: () => ({
        eq: async () => ({
          data: [{ id: "en1", person_id: "p1", campaign_people_id: "cp1" }],
          error: null,
        }),
      }),
    };
  }
  if (table === "people") {
    return {
      select: () => ({
        in: async () => ({
          data: [
            {
              id: "p1",
              name: "Alice",
              title: "CTO",
              work_email: "alice@acme.com",
              personal_email: null,
              organization_id: "o1",
              enrichment_data: { bio: "BIG_BIO_SHOULD_NOT_APPEAR" },
            },
          ],
          error: null,
        }),
      }),
    };
  }
  if (table === "organizations") {
    return {
      select: () => ({
        in: async () => ({
          data: [
            {
              id: "o1",
              name: "Acme",
              domain: "acme.com",
              enrichment_data: { summary: "BIG_SUMMARY_SHOULD_NOT_APPEAR" },
            },
          ],
          error: null,
        }),
      }),
    };
  }
  throw new Error(`unexpected table ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi
    .fn()
    .mockResolvedValue({ from: (table: string) => mockFrom(table) }),
}));

import { draftSequenceEmails } from "@/lib/tools/sequence-tools";

describe("draftSequenceEmails return shape", () => {
  it("returns thin contact rows without enrichment_data", async () => {
    const result = (await draftSequenceEmails.execute!(
      { sequenceId: "seq1" },
      {} as never,
    )) as {
      contacts: Array<Record<string, unknown>>;
      instructions: string;
    };

    expect(result.contacts).toHaveLength(1);
    const c = result.contacts[0];
    expect(c).not.toHaveProperty("enrichmentData");
    expect(c).not.toHaveProperty("companyEnrichmentData");
    expect(JSON.stringify(c)).not.toContain("BIG_BIO_SHOULD_NOT_APPEAR");
    expect(JSON.stringify(c)).not.toContain("BIG_SUMMARY_SHOULD_NOT_APPEAR");
    expect(c).toMatchObject({
      enrollmentId: "en1",
      personId: "p1",
      campaignPeopleId: "cp1",
      name: "Alice",
      title: "CTO",
      email: "alice@acme.com",
      company: "Acme",
      domain: "acme.com",
      organizationId: "o1",
    });
    expect(result.instructions).toMatch(/getContactDetail/);
  });
});
