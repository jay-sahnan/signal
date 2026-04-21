import { describe, expect, it } from "vitest";
import { summarizeCompanyEnrichment } from "@/lib/tools/enrichment-tools";

describe("summarizeCompanyEnrichment", () => {
  it("collapses website + searches to counts/flags", () => {
    const full = {
      enrichedAt: "2026-04-18",
      website: {
        title: "Acme",
        content: "BIG_WEBSITE_CONTENT_3KB",
        emails: ["a@acme.com", "b@acme.com"],
      },
      searches: [
        { category: "product", results: [{ text: "BIG" }, { text: "BIG" }] },
        { category: "funding", results: [{ text: "BIG" }] },
        { category: "team", results: [] },
      ],
    };
    const s = summarizeCompanyEnrichment(full);
    expect(s).toMatchObject({
      hasWebsite: true,
      websiteEmails: 2,
      productResults: 2,
      fundingResults: 1,
      teamResults: 0,
    });
    expect(JSON.stringify(s)).not.toMatch(/BIG/);
  });
});
