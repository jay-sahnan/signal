import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseFake, type FakeRow } from "./helpers/supabase-fake";

const findEmailForPerson = vi.fn<
  (personId: string) => Promise<{ email: string | null }>
>(async () => ({
  email: null,
}));
vi.mock("@/lib/tools/email-tools", () => ({ findEmailForPerson }));

/**
 * Every Exa search in this path returns the same dated archive snapshot, so a
 * test can check the date survives the trip to the summarizer.
 */
const exaSearch = vi.fn(async () => ({
  results: [
    {
      title: "Archived profile",
      url: "https://web.archive.org/victor",
      publishedDate: "2026-03-29",
      text: "Ann A, Customer Engineer at Browserbase, May 2025 - Present",
    },
  ],
  resultCount: 1,
}));
vi.mock("@/lib/services/exa-service", () => ({
  ExaService: class {
    search = (...args: unknown[]) =>
      (exaSearch as unknown as (...a: unknown[]) => unknown)(...args);
  },
}));

// enrichment-tools imports summarizePerson at the top level, so the spy has to
// exist before the module graph is built. vi.hoisted is what gets it there.
const { summarizePerson } = vi.hoisted(() => ({
  summarizePerson: vi.fn<
    (input: {
      news?: Array<{ publishedDate?: string | null }> | null;
    }) => Promise<{
      summary: string | null;
      currentTitle: string | null;
      sourcesConflict: boolean;
    } | null>
  >(async () => null),
}));
vi.mock("@/lib/services/enrichment-summarizer", () => ({ summarizePerson }));

vi.mock("@/lib/services/knowledge-base", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/knowledge-base")>();
  return {
    ...actual,
    isRecentlyEnriched: vi.fn(async () => false),
    mergeEnrichmentData: vi.fn(async () => undefined),
  };
});

const PERSON_ID = "11111111-1111-1111-1111-111111111111";
/**
 * Someone else in the table.
 *
 * Every read in this path is scoped by `.eq("id", personId)`, and with one row
 * in the fixtures the predicate could be deleted with the suite still green.
 * This row is a confirmed contact with an address already on file, so an
 * unscoped read gets a different answer at every step.
 */
const OTHER_PERSON = "99999999-9999-9999-9999-999999999999";

/** The people table. The contact under test is always row zero. */
let people: FakeRow[] = [];

const seed = (over: FakeRow = {}) => {
  people = [
    {
      id: PERSON_ID,
      name: "Ann A",
      title: "Engineer",
      linkedin_url: null,
      twitter_url: null,
      organization_id: "org-1",
      enrichment_data: null,
      work_email: null,
      personal_email: null,
      affiliation_confidence: 0.9,
      ...over,
    },
    {
      id: OTHER_PERSON,
      name: "Bystander B",
      title: "Engineer",
      linkedin_url: null,
      twitter_url: null,
      organization_id: null,
      enrichment_data: null,
      work_email: "bystander@acme.com",
      personal_email: null,
      affiliation_confidence: 0.9,
    },
  ];
};

/** Every payload handed to `.update()`, in call order. */
const updates: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () =>
    createSupabaseFake({
      tables: {
        people: () => people,
        organizations: () => [{ id: "org-1", name: "Browserbase" }],
      },
      relations: {
        people: { organization: { localKey: "organization_id" } },
      },
      onQuery: (q) => {
        if (q.kind === "update" && q.payload) updates.push(q.payload);
      },
    }),
  ),
}));

/**
 * The ownership gate. `people` is a shared pool and enrichContactById writes
 * to it, so it carries the same session + callerHoldsPerson test as every
 * sibling path.
 */
let sessionPresent = true;
let callerHolds = true;
vi.mock("@/lib/tools/ownership", () => ({
  toolSession: vi.fn(async () =>
    sessionPresent ? { supabase: {}, userId: "u1" } : null,
  ),
  callerHoldsPerson: vi.fn(async () => callerHolds),
  notFound: (what: string) => ({ error: `${what} not found.` }),
}));

import {
  enrichContact,
  summarizeContactEnrichment,
} from "@/lib/tools/enrichment-tools";

beforeEach(() => {
  seed();
  sessionPresent = true;
  callerHolds = true;
});

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

describe("email discovery is gated on affiliation", () => {
  beforeEach(() => {
    findEmailForPerson.mockClear();
  });

  it("does not look for an email for an unconfirmed contact", async () => {
    // A pattern-guessed address at the company domain is the single most
    // convincing thing on the row. Minting one for a person we cannot place at
    // the company manufactures the confirmation the user is looking for.
    seed({ affiliation_confidence: 0.2 });

    await enrichContact.execute!({ contactId: PERSON_ID }, {} as never);

    expect(findEmailForPerson).not.toHaveBeenCalled();
  });

  it("still looks for an email for a confirmed contact", async () => {
    // The gate has to be satisfied by the confidence check, not by email
    // discovery quietly never running at all.
    seed({ affiliation_confidence: 0.9 });

    await enrichContact.execute!({ contactId: PERSON_ID }, {} as never);

    expect(findEmailForPerson).toHaveBeenCalledWith(PERSON_ID);
  });
});

describe("title write-back", () => {
  beforeEach(() => {
    updates.length = 0;
    summarizePerson.mockClear();
    summarizePerson.mockResolvedValue(null);
    // Already has an address, so email discovery stays out of the way.
    seed({ work_email: "victor@anthropic.com" });
  });

  /** The bio write is the only update carrying either of these keys. */
  const bioUpdate = () =>
    updates.find((u) => "bio_summary" in u || "title" in u);

  it("hands the summarizer the date on every source", async () => {
    // Dropped here, the date can never reach the prompt no matter what the
    // summarizer does with it.
    await enrichContact.execute!({ contactId: PERSON_ID }, {} as never);

    const input = summarizePerson.mock.calls[0][0];
    expect(input.news?.[0]?.publishedDate).toBe("2026-03-29");
  });

  it("does not overwrite the stored title when the sources conflict", async () => {
    // The live headline says one employer, the archived text says another.
    // Picking one silently is how enrichment overwrote a correct title with a
    // four-month-old one.
    summarizePerson.mockResolvedValue({
      summary: "Sources disagree about where they work.",
      currentTitle: "Customer Engineer",
      sourcesConflict: true,
    });

    await enrichContact.execute!({ contactId: PERSON_ID }, {} as never);

    const written = bioUpdate();
    expect(written).toBeDefined();
    expect(written).not.toHaveProperty("title");
    expect(written?.bio_summary).toBe(
      "Sources disagree about where they work.",
    );
  });

  it("still writes the title when the sources agree", async () => {
    // The write-back exists because a person discovered with a wrong title
    // kept it forever. The conflict guard must not be satisfied by never
    // writing a title at all.
    summarizePerson.mockResolvedValue({
      summary: "A summary.",
      currentTitle: "Product Support",
      sourcesConflict: false,
    });

    await enrichContact.execute!({ contactId: PERSON_ID }, {} as never);

    expect(bioUpdate()?.title).toBe("Product Support");
  });
});

describe("ownership", () => {
  it("refuses without an authenticated session", async () => {
    // enrichContactById writes to the shared people pool and can mint a
    // company-domain email via findEmailForPerson, so it carries the same
    // gate as /api/find-email and the sibling tools.
    sessionPresent = false;

    await expect(
      enrichContact.execute!({ contactId: PERSON_ID }, {} as never),
    ).rejects.toThrow(/sign in/i);
  });

  it("refuses a person the caller does not hold, worded as absence", async () => {
    callerHolds = false;
    updates.length = 0;

    await expect(
      enrichContact.execute!({ contactId: PERSON_ID }, {} as never),
    ).rejects.toThrow(/No person found/);
    // and nothing was written to the row
    expect(updates).toHaveLength(0);
  });
});

describe("stuck in_progress recovery", () => {
  it("re-enriches a row stuck at in_progress instead of skipping it", async () => {
    // The status is set before the scrape chain; a serverless run killed
    // mid-scrape leaves it there forever, and the recency skip then returned
    // status "enriched" for 7 days while the row still said in_progress:
    // permanent "In Progress" in the UI with no recovery path at all.
    const { isRecentlyEnriched } =
      await import("@/lib/services/knowledge-base");
    vi.mocked(isRecentlyEnriched).mockResolvedValueOnce(true);
    seed({
      enrichment_status: "in_progress",
      work_email: "ann@acme.com",
    });

    const result = (await enrichContact.execute!(
      { contactId: PERSON_ID },
      {} as never,
    )) as { skipped?: boolean };

    expect(result.skipped).toBeUndefined();
  });

  it("still skips a recently enriched row in a settled state", async () => {
    const { isRecentlyEnriched } =
      await import("@/lib/services/knowledge-base");
    vi.mocked(isRecentlyEnriched).mockResolvedValueOnce(true);
    seed({ enrichment_status: "enriched", enrichment_data: {} });

    const result = (await enrichContact.execute!(
      { contactId: PERSON_ID },
      {} as never,
    )) as { skipped?: boolean };

    expect(result.skipped).toBe(true);
  });
});

describe("namesake anchoring", () => {
  beforeEach(async () => {
    updates.length = 0;
    summarizePerson.mockClear();
    exaSearch.mockClear();
    // The in_progress recovery tests queue a mockResolvedValueOnce(true)
    // that short-circuiting never consumes; drain it so recency stays false.
    const { isRecentlyEnriched } =
      await import("@/lib/services/knowledge-base");
    vi.mocked(isRecentlyEnriched).mockReset();
    vi.mocked(isRecentlyEnriched).mockResolvedValue(false);
    // An address on file keeps email discovery out of the way.
    seed({ work_email: "ann@browserbase.com" });
  });

  it("drops results about a namesake at a different company", async () => {
    // The long-standing namesake bug: Exa is semantic, so a search for
    // "Ann A" "Browserbase" happily returns an Ann A at Oracle, and her
    // career used to be stored as this contact's enrichment and woven into
    // outreach.
    exaSearch.mockResolvedValue({
      results: [
        {
          title: "Ann A promoted to VP at Oracle",
          url: "https://news.example.com/oracle-ann",
          publishedDate: "2026-07-01",
          text: "Ann A has spent 15 years at Oracle leading databases.",
        },
        {
          title: "Ann A of Browserbase on browser infra",
          url: "https://news.example.com/bb-ann",
          publishedDate: "2026-07-02",
          text: "An interview with Ann A, engineer at Browserbase.",
        },
      ],
      resultCount: 2,
    });

    await enrichContact.execute!({ contactId: PERSON_ID }, {} as never);

    const input = summarizePerson.mock.calls[0][0] as {
      news?: Array<{ url: string }> | null;
    };
    const urls = (input.news ?? []).map((r) => r.url);
    expect(urls).toContain("https://news.example.com/bb-ann");
    expect(urls).not.toContain("https://news.example.com/oracle-ann");
  });

  it("skips web search entirely for a contact with no company", async () => {
    // With only a name there is nothing to tie a result to this human, so
    // searching at all is how strangers' articles got stored. LinkedIn/X
    // (URL-anchored) still run; the result says why the searches did not.
    seed({
      organization_id: null,
      work_email: "ann@example.com",
      linkedin_url: null,
    });

    const result = (await enrichContact.execute!(
      { contactId: PERSON_ID },
      {} as never,
    )) as { errors?: string[] };

    expect(exaSearch).not.toHaveBeenCalled();
    expect(result.errors?.some((e) => /no company on file/i.test(e))).toBe(
      true,
    );
  });
});
