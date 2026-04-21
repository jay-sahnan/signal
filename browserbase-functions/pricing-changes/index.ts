import { defineFn } from "@browserbasehq/sdk-functions";
import { chromium } from "playwright-core";
import { z } from "zod";

const ParamsSchema = z.object({
  company: z.object({
    name: z.string(),
    domain: z.string().nullable(),
    website: z.string().nullable().optional(),
  }),
});

defineFn(
  "pricing-changes",
  async (context, params) => {
    const domain = params.company.domain;
    if (!domain) {
      return {
        found: false,
        summary: "No domain provided",
        evidence: [],
        data: {},
        confidence: "low",
      };
    }

    const browser = await chromium.connectOverCDP(context.session.connectUrl);
    const page = browser.contexts()[0]!.pages()[0]!;
    const url = `https://${domain}/pricing`;

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2000);

      const finalUrl = page.url();
      const title = await page.title();
      const bodyText = await page.evaluate(
        () => document.body?.innerText ?? "",
      );

      const truncatedText = bodyText.slice(0, 15_000);
      const found = truncatedText.length > 0;

      return {
        found,
        summary: found
          ? `Fetched pricing page (${truncatedText.length} chars) from ${finalUrl}`
          : `Empty page at ${finalUrl}`,
        evidence: found
          ? [{ url: finalUrl, snippet: truncatedText.slice(0, 280) }]
          : [],
        data: { url: finalUrl, title, text: truncatedText },
        confidence: "medium",
      };
    } finally {
      await browser.close().catch(() => {});
    }
  },
  { parametersSchema: ParamsSchema },
);
