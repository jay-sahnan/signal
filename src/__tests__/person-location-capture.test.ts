import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseFake, type FakeRow } from "./helpers/supabase-fake";

/**
 * people.location is free text a user can correct by hand, so every write path
 * follows the same rule: a discovered or enriched location fills a blank and
 * never overwrites what is already stored. These tests pin that rule at the two
 * ends of the pipeline this branch wired up: findOrCreatePerson (discovery) and
 * enrichContact's summary write-back (enrichment).
 */

const findEmailForPerson = vi.fn<
  (personId: string) => Promise<{ email: string | null }>
>(async () => ({
  email: null,
}));
vi.mock("@/lib/tools/email-tools", () => ({ findEmailForPerson }));

// Every Exa search returns one dated result so enrichment collects something
// and the bio-summary step actually runs.
vi.mock("@/lib/services/exa-service", () => ({
  ExaService: class {
    async search() {
      return {
        results: [
          {
            title: "Profile",
            url: "https://example.com/ann",
            publishedDate: "2026-07-01",
            text: "Ann A is an engineer at Acme based in Berlin, Germany.",
          },
        ],
        resultCount: 1,
      };
    }
  },
}));

// enrichment-tools imports summarizePerson at the top level, so the spy has to
// exist before the module graph is built. vi.hoisted is what gets it there.
const { summarizePerson } = vi.hoisted(() => ({
  summarizePerson: vi.fn<
    () => Promise<{
      summary: string | null;
      currentTitle: string | null;
      sourcesConflict: boolean;
      location: string | null;
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
const ORG_ID = "22222222-2222-2222-2222-222222222222";

/** The people table, reassigned per test. */
let people: FakeRow[] = [];

const personRow = (over: FakeRow = {}): FakeRow => ({
  id: PERSON_ID,
  name: "Ann A",
  title: "Engineer",
  location: null,
  linkedin_url: null,
  twitter_url: null,
  work_email: null,
  personal_email: null,
  organization_id: ORG_ID,
  enrichment_data: null,
  affiliation_confidence: 0.9,
  ...over,
});

/** Every payload handed to `.update()` / `.insert()`, in call order. */
const updates: Array<Record<string, unknown>> = [];
const inserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () =>
    createSupabaseFake({
      tables: {
        people: () => people,
        // The person under test needs an employer: web search results are
        // identity-gated on name + company, and company-less people skip
        // web search entirely.
        organizations: () => [{ id: ORG_ID, name: "Acme" }],
      },
      relations: {
        people: { organization: { localKey: "organization_id" } },
      },
      onQuery: (q) => {
        if (q.kind === "update" && q.payload) updates.push(q.payload);
        if (q.kind === "insert" && q.payload) inserts.push(q.payload);
      },
    }),
  ),
}));

// enrichContact now carries the same ownership gate as its siblings; this
// suite is about location write-back, so the caller always holds the person.
vi.mock("@/lib/tools/ownership", () => ({
  toolSession: vi.fn(async () => ({ supabase: {}, userId: "u1" })),
  callerHoldsPerson: vi.fn(async () => true),
  notFound: (what: string) => ({ error: `${what} not found.` }),
}));

import { findOrCreatePerson } from "@/lib/services/knowledge-base";
import { enrichContact } from "@/lib/tools/enrichment-tools";

beforeEach(() => {
  people = [];
  updates.length = 0;
  inserts.length = 0;
});

describe("findOrCreatePerson location handling", () => {
  it("writes location on insert", async () => {
    await findOrCreatePerson({
      name: "Ann A",
      location: "Berlin, Germany",
      source: "exa",
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].location).toBe("Berlin, Germany");
  });

  it("writes null, not undefined, when no location is known", async () => {
    // The insert names every column it owns, so a caller with nothing to say
    // still produces an explicit null rather than an absent key.
    await findOrCreatePerson({ name: "Ann A", source: "exa" });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toHaveProperty("location", null);
  });

  it("fills a blank location on an existing person matched by LinkedIn URL", async () => {
    people = [
      personRow({
        linkedin_url: "https://www.linkedin.com/in/ann-a",
        location: null,
      }),
    ];

    await findOrCreatePerson({
      name: "Ann A",
      linkedin_url: "https://www.linkedin.com/in/ann-a",
      location: "Berlin, Germany",
    });

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].location).toBe("Berlin, Germany");
    expect(people[0].location).toBe("Berlin, Germany");
  });

  it("does not clobber a stored location on the LinkedIn match path", async () => {
    // The stored value may be the user's own correction. A passing search
    // result must not trade it away.
    people = [
      personRow({
        linkedin_url: "https://www.linkedin.com/in/ann-a",
        location: "Austin, TX",
      }),
    ];

    await findOrCreatePerson({
      name: "Ann A",
      linkedin_url: "https://www.linkedin.com/in/ann-a",
      location: "Berlin, Germany",
    });

    expect(updates.filter((u) => "location" in u)).toHaveLength(0);
    expect(people[0].location).toBe("Austin, TX");
  });

  it("fills a blank location on the name+organization fallback path", async () => {
    people = [personRow({ organization_id: ORG_ID, location: null })];

    await findOrCreatePerson({
      name: "Ann A",
      organization_id: ORG_ID,
      location: "Lisbon, Portugal",
    });

    expect(inserts).toHaveLength(0);
    expect(people[0].location).toBe("Lisbon, Portugal");
  });

  it("does not clobber a stored location on the name+organization path", async () => {
    people = [personRow({ organization_id: ORG_ID, location: "Austin, TX" })];

    await findOrCreatePerson({
      name: "Ann A",
      organization_id: ORG_ID,
      location: "Lisbon, Portugal",
    });

    expect(updates.filter((u) => "location" in u)).toHaveLength(0);
    expect(people[0].location).toBe("Austin, TX");
  });
});

describe("enrichContact location write-back", () => {
  beforeEach(() => {
    summarizePerson.mockClear();
    summarizePerson.mockResolvedValue(null);
  });

  /** The bio write is the only update carrying any of these keys. */
  const bioUpdate = () =>
    updates.find((u) => "bio_summary" in u || "title" in u || "location" in u);

  it("fills a blank location from the summarizer", async () => {
    // Address already on file so email discovery stays out of the way.
    people = [personRow({ work_email: "ann@acme.com", location: null })];
    summarizePerson.mockResolvedValue({
      summary: "A summary.",
      currentTitle: null,
      sourcesConflict: false,
      location: "Berlin, Germany",
    });

    await enrichContact.execute!({ contactId: PERSON_ID }, {} as never);

    expect(bioUpdate()?.location).toBe("Berlin, Germany");
  });

  it("never overwrites a stored location", async () => {
    // Enrichment corrects titles, but not locations: the stored value may be
    // the user's correction, and a re-run must leave it standing.
    people = [
      personRow({ work_email: "ann@acme.com", location: "Austin, TX" }),
    ];
    summarizePerson.mockResolvedValue({
      summary: "A summary.",
      currentTitle: null,
      sourcesConflict: false,
      location: "Berlin, Germany",
    });

    await enrichContact.execute!({ contactId: PERSON_ID }, {} as never);

    const written = bioUpdate();
    expect(written).toBeDefined();
    expect(written).not.toHaveProperty("location");
    expect(people[0].location).toBe("Austin, TX");
  });

  it("writes no location when the summarizer states none", async () => {
    people = [personRow({ work_email: "ann@acme.com", location: null })];
    summarizePerson.mockResolvedValue({
      summary: "A summary.",
      currentTitle: null,
      sourcesConflict: false,
      location: null,
    });

    await enrichContact.execute!({ contactId: PERSON_ID }, {} as never);

    const written = bioUpdate();
    expect(written).toBeDefined();
    expect(written).not.toHaveProperty("location");
  });
});
