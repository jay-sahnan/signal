import { describe, expect, it } from "vitest";

import { resultIsAboutPerson } from "@/lib/services/person-enrichment";

/**
 * The identity gate on per-person web search results. Exa queries carry the
 * name and company, but Exa is semantic: top results routinely include
 * namesake strangers whose pages never mention the employer. Stored
 * unchecked, a stranger's career lands in the contact's enrichment_data and
 * outreach personalises against someone else's life -- the long-standing
 * namesake bug.
 */

const jane = { name: "Jane Doe", companyName: "Browserbase" };

describe("resultIsAboutPerson", () => {
  it("keeps a result naming both the person and their company", () => {
    expect(
      resultIsAboutPerson(
        {
          title: "Jane Doe on scaling Browserbase",
          text: "An interview with Jane Doe, engineer at Browserbase.",
        },
        jane,
      ),
    ).toBe(true);
  });

  it("drops a namesake whose page never mentions the company", () => {
    expect(
      resultIsAboutPerson(
        {
          title: "Jane Doe promoted to VP at Oracle",
          text: "Jane Doe has spent 15 years at Oracle leading databases.",
        },
        jane,
      ),
    ).toBe(false);
  });

  it("drops company news that never names the person", () => {
    expect(
      resultIsAboutPerson(
        {
          title: "Browserbase raises Series B",
          text: "The company announced new funding today.",
        },
        jane,
      ),
    ).toBe(false);
  });

  it("survives punctuation, casing and legal suffixes", () => {
    expect(
      resultIsAboutPerson(
        {
          title: "JANE-DOE joins BROWSERBASE, Inc!",
          text: null,
        },
        { name: "Jane Doe", companyName: "Browserbase Inc." },
      ),
    ).toBe(true);
  });

  it("requires only the name when no company is known", () => {
    // Callers skip web search entirely for company-less people; this branch
    // exists so the function stays safe if called anyway.
    expect(
      resultIsAboutPerson(
        { title: "Jane Doe's blog", text: "By Jane Doe." },
        { name: "Jane Doe", companyName: null },
      ),
    ).toBe(true);
  });

  it("rejects empty results outright", () => {
    expect(resultIsAboutPerson({ title: null, text: null }, jane)).toBe(false);
  });
});
