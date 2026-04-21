import { describe, expect, it, vi } from "vitest";

const BIG_CONTENT = "x".repeat(50_000);
const BIG_LINKS = Array.from({ length: 200 }, (_, i) => `https://e.com/${i}`);

vi.mock("@/lib/services/web-extraction-service", () => ({
  WebExtractionService: class {
    async extract() {
      return {
        success: true,
        url: "https://example.com",
        source: "fetch",
        data: {
          title: "Example",
          description: "short desc",
          content: BIG_CONTENT,
          links: BIG_LINKS,
          contactInfo: { emails: ["a@e.com"], phones: [] },
        },
        extractionTime: 42,
      };
    }
  },
}));

import { extractWebContent } from "@/lib/tools/enrichment-tools";

describe("extractWebContent return shape", () => {
  it("caps content to 3000 chars and links to 20", async () => {
    const result = (await extractWebContent.execute!(
      { url: "https://example.com", includeLinks: true },
      { toolCallId: "t1", experimental_context: {} } as never,
    )) as {
      success: boolean;
      data: { content: string; links?: string[] };
      truncated?: { content: boolean; links: boolean };
    };

    expect(result.success).toBe(true);
    expect(result.data.content.length).toBeLessThanOrEqual(3001);
    expect(result.data.links!.length).toBe(20);
    expect(result.truncated).toEqual({ content: true, links: true });
  });
});
