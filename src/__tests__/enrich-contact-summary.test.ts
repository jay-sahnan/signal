import { describe, expect, it } from "vitest";
import { summarizeContactEnrichment } from "@/lib/tools/enrichment-tools";

describe("summarizeContactEnrichment", () => {
  it("collapses a full enrichment blob to counts/flags", () => {
    const full = {
      linkedin: {
        bio: "BIG_LINKEDIN_BIO_SHOULD_NEVER_APPEAR",
        headline: "CTO",
      },
      twitter: { tweets: [{ text: "BIG_TWEET" }] },
      news: [
        { title: "a", text: "BIG_NEWS_TEXT_1" },
        { title: "b", text: "BIG_NEWS_TEXT_2" },
      ],
      articles: [{ title: "c", text: "BIG_ARTICLE_TEXT" }],
      background: [],
      discoveredEmail: "alice@acme.com",
    };
    const s = summarizeContactEnrichment(full);
    expect(s).toEqual({
      hasLinkedin: true,
      hasTwitter: true,
      news: 2,
      articles: 1,
      background: 0,
      discoveredEmail: true,
    });
    expect(JSON.stringify(s)).not.toMatch(/BIG_/);
  });

  it("handles empty blob", () => {
    expect(summarizeContactEnrichment({})).toEqual({});
  });
});
