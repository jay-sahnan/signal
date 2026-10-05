import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * filterContactsByCompany is what decides whether a search result becomes an
 * employee, a flagged maybe, or someone filed elsewhere — and it had no tests.
 *
 * The three behaviours the "a verdict for every candidate" guarantee rests on
 * are all failure-path behaviours, which is exactly why they went unnoticed:
 * hallucinated indices from the model, candidates the model simply omits, and
 * the model being unavailable at all.
 */

const generateObjectMock = vi.fn();
vi.mock("ai", async (importOriginal) => ({
  // apiSafeSchema needs the real asSchema/jsonSchema helpers.
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "model" }));
// llmTimeout() returns AbortSignal.timeout(...), whose pending timer outlives a
// test that throws before the SDK consumes the signal — vitest then attributes
// the abort to the test and fails it. The timeout is not what is under test.
vi.mock("@/lib/utils/timeout", () => ({ llmTimeout: () => undefined }));
vi.mock("@/lib/services/cost-tracker", () => ({
  trackUsage: vi.fn(),
  estimateClaudeCostFromUsage: () => 0,
}));
const extractMock = vi.fn();
vi.mock("@/lib/services/web-extraction-service", () => ({
  WebExtractionService: class {
    extract(...args: unknown[]) {
      return extractMock(...args);
    }
  },
}));

const fetchMock = vi.fn();
vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => fetchMock(...args),
  readBodyCapped: async (r: { body: string }) => r.body,
}));

import {
  filterContactsByCompany,
  findPeopleOnDomain,
  type CandidateContact,
  type CompanyContext,
} from "@/lib/services/contact-filter";

const company: CompanyContext = {
  name: "Browserbase",
  domain: "browserbase.com",
  industry: "developer tools",
  location: "SF",
  description: null,
};

const candidates: CandidateContact[] = [
  {
    name: "Ann A",
    title: "Engineer",
    linkedinUrl: "https://www.linkedin.com/in/a",
    rawHeadline: "Ann A - Browserbase",
  },
  {
    name: "Bob B",
    title: "Engineer",
    linkedinUrl: "https://www.linkedin.com/in/b",
    rawHeadline: "Bob B - Wafer",
  },
  {
    name: "Cal C",
    title: "Engineer",
    linkedinUrl: "https://www.linkedin.com/in/c",
    rawHeadline: "Cal C",
  },
];

function reply(judged: unknown[]) {
  generateObjectMock.mockResolvedValue({
    object: { judged },
    usage: { inputTokens: 1, outputTokens: 1 },
  });
}

beforeEach(() => { generateObjectMock.mockReset(); });

describe("filterContactsByCompany", () => {
  it("returns a verdict for every candidate", async () => {
    reply([
      {
        index: 0,
        name: "Ann A",
        title: "Eng",
        verdict: "verified",
        evidence: "names it",
      },
      {
        index: 1,
        name: "Bob B",
        title: "Eng",
        verdict: "rejected",
        evidence: "Wafer",
      },
      {
        index: 2,
        name: "Cal C",
        title: "Eng",
        verdict: "uncertain",
        evidence: "no employer",
      },
    ]);

    const out = await filterContactsByCompany(company, candidates);

    expect(out).toHaveLength(3);
    expect(out.map((v) => v.verdict).sort()).toEqual([
      "rejected",
      "uncertain",
      "verified",
    ]);
  });

  it("judges candidates whose headline never names the employer", async () => {
    // The old hard pre-filter dropped these before the model saw them, which
    // discarded 22 of 41 real contacts at one company on the dev database.
    reply([
      {
        index: 2,
        name: "Cal C",
        title: "Eng",
        verdict: "verified",
        evidence: "confirmed",
      },
    ]);

    await filterContactsByCompany(company, candidates);

    const prompt = generateObjectMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Cal C");
    // and the headline match is passed as a hint, not used as a gate
    expect(prompt).toMatch(/headline names the target company/i);
  });

  it("backfills a verdict for candidates the model omitted", async () => {
    reply([
      {
        index: 0,
        name: "Ann A",
        title: "Eng",
        verdict: "verified",
        evidence: "x",
      },
    ]);

    const out = await filterContactsByCompany(company, candidates);

    expect(out).toHaveLength(3);
    const missing = out.filter((v) => v.index !== 0);
    expect(missing.every((v) => v.verdict === "uncertain")).toBe(true);
  });

  it("drops hallucinated indices instead of throwing", async () => {
    reply([
      {
        index: 99,
        name: "Ghost",
        title: null,
        verdict: "verified",
        evidence: "x",
      },
      {
        index: 0,
        name: "Ann A",
        title: "Eng",
        verdict: "verified",
        evidence: "y",
      },
    ]);

    const out = await filterContactsByCompany(company, candidates);

    expect(out.some((v) => v.name === "Ghost")).toBe(false);
    expect(out).toHaveLength(3); // the other two backfilled as uncertain
  });

  it("ignores a repeated index rather than double-counting", async () => {
    reply([
      {
        index: 0,
        name: "Ann A",
        title: "Eng",
        verdict: "verified",
        evidence: "x",
      },
      {
        index: 0,
        name: "Ann Again",
        title: "Eng",
        verdict: "rejected",
        evidence: "y",
      },
    ]);

    const out = await filterContactsByCompany(company, candidates);

    expect(out.filter((v) => v.index === 0)).toHaveLength(1);
    expect(out.find((v) => v.index === 0)?.verdict).toBe("verified");
  });

  it("returns everything as uncertain when the model is unavailable", async () => {
    // The previous fallback discarded every candidate, turning a transient
    // outage into silent data loss.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    // A malformed response rather than a thrown mock: it exercises the same
    // catch, and vitest attributes an error thrown *by a mock* to the test
    // itself, failing the run even when the code under test handles it.
    generateObjectMock.mockResolvedValue({ object: null, usage: {} });

    const out = await filterContactsByCompany(company, candidates);

    expect(out).toHaveLength(3);
    expect(out.every((v) => v.verdict === "uncertain")).toBe(true);
    expect(out.map((v) => v.index).sort()).toEqual([0, 1, 2]);
    quiet.mockRestore();
  });

  it("short-circuits on an empty candidate list without calling the model", async () => {
    const out = await filterContactsByCompany(company, []);

    expect(out).toEqual([]);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});

const withEvidence: CandidateContact[] = [
  {
    name: "Dana D",
    title: null,
    linkedinUrl: "https://www.linkedin.com/in/d",
    rawHeadline: "Dana D - Head of DevRel | Founder devreluni.com",
    pageText:
      "Experience: Head of Developer Relations, Chronicle Labs, May 2024 - Present. Founder, DevRel Uni, Feb 2023 - Present.",
    pageDate: "2026-07-23",
  },
];

describe("evidence in the prompt", () => {
  it("puts the page text and its date in front of the model", async () => {
    reply([
      {
        index: 0,
        name: "Dana D",
        title: null,
        verdict: "rejected",
        evidence: "x",
      },
    ]);

    await filterContactsByCompany(company, withEvidence);

    const prompt = generateObjectMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Chronicle Labs");
    expect(prompt).toContain("2026-07-23");
  });

  it("says the page text is missing rather than omitting the line", async () => {
    // A silently absent field reads to the model as "not applicable". An
    // explicit "(none)" is what makes `uncertain` the honest answer.
    reply([
      {
        index: 0,
        name: "Ann A",
        title: null,
        verdict: "uncertain",
        evidence: "x",
      },
    ]);

    await filterContactsByCompany(company, candidates);

    const prompt = generateObjectMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("(none)");
  });
});

describe("former_employee", () => {
  it("passes the verdict through", async () => {
    reply([
      {
        index: 0,
        name: "Dana D",
        title: "Engineer",
        verdict: "former_employee",
        employerSeen: "Browserbase",
        datesSeen: "Oct 2024 - Mar 2026",
        evidence: "profile shows the role ended in Mar 2026",
      },
    ]);

    const out = await filterContactsByCompany(company, withEvidence);

    expect(out[0].verdict).toBe("former_employee");
    expect(out[0].employerSeen).toBe("Browserbase");
    expect(out[0].datesSeen).toBe("Oct 2024 - Mar 2026");
  });
});

describe("stale snapshots", () => {
  it("downgrades a verified call made on an old page", async () => {
    // The Victor Lue case. His archived page was dated 2026-03-29 and said
    // "Browserbase, Present" while his live headline said Anthropic. A
    // four-month-old snapshot saying "Present" only proves where they worked
    // four months ago, so it cannot clear the send gate on its own.
    reply([
      {
        index: 0,
        name: "Dana D",
        title: null,
        verdict: "verified",
        evidence: "says Present",
      },
    ]);

    const out = await filterContactsByCompany(company, [
      { ...withEvidence[0], pageDate: "2026-01-01" },
    ]);

    expect(out[0].verdict).toBe("uncertain");
    expect(out[0].evidence).toMatch(/months old/i);
  });

  it("leaves a verified call on a fresh page alone", async () => {
    reply([
      {
        index: 0,
        name: "Dana D",
        title: null,
        verdict: "verified",
        evidence: "says Present",
      },
    ]);

    const out = await filterContactsByCompany(company, [
      { ...withEvidence[0], pageDate: new Date().toISOString().slice(0, 10) },
    ]);

    expect(out[0].verdict).toBe("verified");
  });

  it("does not downgrade a rejection just because the page is old", async () => {
    // Staleness cuts one way. "They worked somewhere else in January" is still
    // evidence they were not here in January, and re-running the search will
    // not produce a fresher page.
    reply([
      {
        index: 0,
        name: "Dana D",
        title: null,
        verdict: "rejected",
        evidence: "Chronicle Labs",
      },
    ]);

    const out = await filterContactsByCompany(company, [
      { ...withEvidence[0], pageDate: "2026-01-01" },
    ]);

    expect(out[0].verdict).toBe("rejected");
  });
});

describe("findPeopleOnDomain page discovery", () => {
  const quietLogs = () => vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    extractMock.mockReset().mockResolvedValue({ success: false });
    fetchMock.mockReset();
  });

  const COMMON_PATHS = [
    "https://acme.com/team",
    "https://acme.com/about",
    "https://acme.com/about-us",
    "https://acme.com/people",
  ];

  it("tries the common paths when no sitemap exists", async () => {
    const quiet = quietLogs();
    fetchMock.mockResolvedValue({ ok: false });

    await findPeopleOnDomain("acme.com", "Acme");

    expect(extractMock.mock.calls.map((c) => c[0])).toEqual(COMMON_PATHS);
    quiet.mockRestore();
  });

  it("falls back to the common paths when the sitemap matches nothing", async () => {
    // The sitemap-index case guarantees this: its <loc> entries are sub-sitemap
    // files like wp-sitemap-posts-page-1.xml, which match no team keyword, so
    // urlsToTry was empty and findPeopleOnDomain returned [] for sites that DO
    // have team pages -- silently, on every run.
    const quiet = quietLogs();
    fetchMock.mockResolvedValue({
      ok: true,
      body: `<sitemapindex><sitemap><loc>https://acme.com/wp-sitemap-posts-page-1.xml</loc></sitemap></sitemapindex>`,
    });

    await findPeopleOnDomain("acme.com", "Acme");

    expect(extractMock.mock.calls.map((c) => c[0])).toEqual(COMMON_PATHS);
    quiet.mockRestore();
  });

  it("prefers keyword-matching sitemap URLs when they exist", async () => {
    const quiet = quietLogs();
    fetchMock.mockResolvedValue({
      ok: true,
      body: `<urlset><url><loc>https://acme.com/our-team</loc></url><url><loc>https://acme.com/pricing</loc></url></urlset>`,
    });

    await findPeopleOnDomain("acme.com", "Acme");

    expect(extractMock.mock.calls.map((c) => c[0])).toEqual([
      "https://acme.com/our-team",
    ]);
    quiet.mockRestore();
  });
});

it("surfaces failed page extraction in strict accounting mode", async () => {
  fetchMock.mockResolvedValue({ ok: false });
  extractMock.mockResolvedValue({ success: false });
  await expect(findPeopleOnDomain("acme.com", "Acme", { strict: true })).rejects.toThrow("Domain pages unavailable");
});
it("surfaces failed people extraction in strict accounting mode", async () => {
  fetchMock.mockResolvedValue({ ok: false });
  extractMock.mockResolvedValue({ success: true, url: "https://acme.com/team", data: { content: "team ".repeat(100) } });
  generateObjectMock.mockRejectedValue(new Error("Extraction unavailable"));
  await expect(findPeopleOnDomain("acme.com", "Acme", { strict: true })).rejects.toThrow("Extraction unavailable");
});
