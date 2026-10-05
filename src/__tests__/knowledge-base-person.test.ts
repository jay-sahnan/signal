import { describe, it, expect, vi, beforeEach } from "vitest";

import { createSupabaseFake } from "./helpers/supabase-fake";

/**
 * findOrCreatePerson's name+org fallback and mergeEnrichmentData's read-merge-
 * write cycle. Both sit under every discovery and enrichment path, and both
 * had a silent-corruption mode: the fallback merged same-named strangers into
 * one row, and a failed read turned the "additive" merge destructive.
 */

let people: Array<Record<string, unknown>> = [];
let readError: { message: string } | null = null;
let updateError: { message: string } | null = null;

const fake = () =>
  createSupabaseFake({
    tables: { people: () => people, organizations: () => [] },
    selectError: () => readError,
    updateError: () => updateError,
  });

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake(),
}));

import {
  isRecentlyEnriched,
  findOrCreatePerson,
  mergeEnrichmentData,
} from "@/lib/services/knowledge-base";

beforeEach(() => {
  readError = null;
  updateError = null;
  people = [
    {
      id: "p1",
      name: "Jane Doe",
      title: "VP Sales",
      work_email: null,
      personal_email: null,
      twitter_url: null,
      location: null,
      linkedin_url: "https://www.linkedin.com/in/jane-original",
      organization_id: "org-1",
      source: "exa",
      enrichment_data: { news: ["existing"] },
    },
  ];
});

describe("findOrCreatePerson name+org fallback", () => {
  it("does not merge a namesake whose profile URL is someone else's", async () => {
    // Two different people named Jane Doe at the same company. The fallback
    // matched by normalized name alone, so the second Jane's discovery run
    // returned the first Jane's row and every later update (title, email,
    // enrichment) landed on the wrong human.
    const result = await findOrCreatePerson({
      name: "Jane Doe",
      organization_id: "org-1",
      linkedin_url: "https://www.linkedin.com/in/jane-someone-else",
      source: "exa",
    });

    expect(people).toHaveLength(2);
    expect(result.linkedin_url).toBe(
      "https://www.linkedin.com/in/jane-someone-else",
    );
    // The original row was not touched.
    expect(people[0].linkedin_url).toBe(
      "https://www.linkedin.com/in/jane-original",
    );
  });

  it("still matches the namesake when no URL conflicts", async () => {
    people[0].linkedin_url = null;

    const result = await findOrCreatePerson({
      name: "Jane Doe",
      organization_id: "org-1",
      linkedin_url: "https://www.linkedin.com/in/jane-new",
      source: "exa",
    });

    expect(result.id).toBe("p1");
    expect(people).toHaveLength(1);
    // and the URL is merged onto the matched row
    expect(people[0].linkedin_url).toBe("https://www.linkedin.com/in/jane-new");
  });

  it("still matches when the incoming record has no URL", async () => {
    const result = await findOrCreatePerson({
      name: "Jane Doe",
      organization_id: "org-1",
      source: "website",
    });

    expect(result.id).toBe("p1");
    expect(people).toHaveLength(1);
  });
});

describe("mergeEnrichmentData", () => {
  it("throws instead of destroying data when the read fails", async () => {
    // On a failed read `existing` is null, so the "additive" merge starts from
    // {} and the write replaces every accumulated key with just this run's.
    readError = { message: "connection reset by peer" };

    await expect(
      mergeEnrichmentData("people", "p1", { twitter: { user: "x" } }),
    ).rejects.toThrow(/connection reset/);

    expect(people[0].enrichment_data).toEqual({ news: ["existing"] });
  });

  it("throws when the write fails rather than reporting success", async () => {
    updateError = { message: "permission denied" };

    await expect(
      mergeEnrichmentData("people", "p1", { twitter: { user: "x" } }),
    ).rejects.toThrow(/permission denied/);
  });

  it("merges additively when both legs succeed", async () => {
    await mergeEnrichmentData("people", "p1", { twitter: { user: "x" } });

    expect(people[0].enrichment_data).toEqual({
      news: ["existing"],
      twitter: { user: "x" },
    });
    expect(people[0].enrichment_status).toBe("enriched");
  });
});

it("fails closed on freshness read errors when billing requires a reliable answer", async () => {
  readError = { message: "Database unavailable" };
  await expect(isRecentlyEnriched("people", "person", 7, true)).rejects.toThrow(
    "Could not check enrichment freshness",
  );
  await expect(isRecentlyEnriched("people", "person")).resolves.toBe(false);
});

it.each(["failed", "in_progress"])("does not treat %s contact data as a successful fresh cache", async (status) => {
  people = [{ id: "person", enrichment_status: status, enrichment_data: {}, last_enriched_at: new Date().toISOString() }];
  expect(await isRecentlyEnriched("people", "person", 7, true)).toBe(false);
});
it("still reuses recently completed contact data", async () => {
  people = [{ id: "person", enrichment_status: "enriched", enrichment_data: {}, last_enriched_at: new Date().toISOString() }];
  expect(await isRecentlyEnriched("people", "person", 7, true)).toBe(true);
});
