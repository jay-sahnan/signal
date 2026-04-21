import type { SignalRecipe } from "../types";

export const pricingChangesRecipe: SignalRecipe = {
  version: 1,
  slug: "pricing-changes",
  steps: [
    {
      id: "scrape",
      kind: "stagehand",
      url: "https://{{ context.company.domain }}/pricing",
      actions: [
        { op: "waitMs", ms: 1500 },
        {
          op: "act",
          instruction:
            "If this page shows a billing period toggle (monthly vs annual), select monthly. If it shows a currency selector, leave it at the default. If a 'Show all plans' or 'See more' button is visible, click it. Otherwise do nothing.",
        },
        { op: "waitMs", ms: 800 },
      ],
      extract: {
        instruction:
          "Extract every pricing tier visible on this page. For each tier, capture: the tier name exactly as shown; the headline price as a string (e.g. '$29', '$29/mo', 'Free', 'Custom'); the billing period ('month', 'year', 'seat', or null if unclear); and the top 3-5 distinguishing features. If a tier says 'Contact us' or 'Custom', set price to null. Ignore add-ons, trials, and FAQ sections. Preserve the order tiers appear.",
        schema: {
          type: "object",
          properties: {
            tiers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  price: { type: ["string", "null"] },
                  period: { type: ["string", "null"] },
                  features: { type: "array", items: { type: "string" } },
                },
                required: ["name"],
              },
            },
          },
          required: ["tiers"],
        },
      },
    },
    {
      id: "previous",
      kind: "history",
      maxAgeDays: 90,
      path: "data.tiers",
    },
    {
      id: "diff",
      kind: "diff",
      baseline: "previous.value",
      current: "scrape.extracted.tiers",
      keyBy: "name",
    },
  ],
  output: {
    foundPath: "diff.changed",
    summaryTemplate:
      "{{ context.company.name }} pricing changed: {{ diff.description }}",
    evidence: [
      {
        urlPath: "scrape.url",
        snippetPath: "diff.description",
      },
    ],
    dataPath: "scrape.extracted",
    diffPath: "diff",
    confidence: "medium",
  },
};
