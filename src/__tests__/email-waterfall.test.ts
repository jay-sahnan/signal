import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Covers the verified email waterfall in findEmailForPerson.
 *
 * The behaviour under test is specifically the inversion: strategies only
 * nominate candidates, and a verifier decides which one gets written. So the
 * assertions care far more about *what ends up in the row* than about which
 * strategy produced the string.
 */

// ─── Fakes ────────────────────────────────────────────────────────────────

interface PersonRow extends Record<string, unknown> {
  id: string;
  name: string;
  work_email: string | null;
  work_email_source: string | null;
  work_email_confidence: number | null;
  work_email_verification: string | null;
  work_email_verified_by: string | null;
  work_email_verified_at: string | null;
  organization_id: string | null;
  enrichment_data: Record<string, unknown>;
}

interface OrgRow extends Record<string, unknown> {
  id: string;
  name: string;
  domain: string | null;
  is_catch_all: boolean | null;
  email_pattern: string | null;
  email_pattern_confidence: number | null;
  email_pattern_evidence_count: number;
}

const state: { people: PersonRow[]; organizations: OrgRow[] } = {
  people: [],
  organizations: [],
};

/** What a SELECT against the named table fails with, if anything. */
let tableErrors: Record<string, { message: string } | null> = {};

function chain(table: "people" | "organizations") {
  let mode: "select" | "update" = "select";
  let single = false;
  let updates: Record<string, unknown> = {};
  const preds: Array<(r: Record<string, unknown>) => boolean> = [];

  const c: Record<string, unknown> & PromiseLike<unknown> = {
    select() {
      mode = "select";
      return c;
    },
    update(values: Record<string, unknown>) {
      mode = "update";
      updates = values;
      return c;
    },
    eq(col: string, val: unknown) {
      preds.push((r) => r[col] === val);
      return c;
    },
    not(col: string, _op: string, val: unknown) {
      preds.push((r) => r[col] !== val);
      return c;
    },
    single() {
      single = true;
      return c;
    },
    maybeSingle() {
      single = true;
      return c;
    },
    then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
      const rows = state[table] as unknown as Record<string, unknown>[];
      if (mode === "update") {
        for (const r of rows) {
          if (preds.every((p) => p(r))) Object.assign(r, updates);
        }
        return Promise.resolve({ data: null, error: null }).then(onF, onR);
      }
      const error = tableErrors[table] ?? null;
      if (error) {
        return Promise.resolve({ data: null, error }).then(onF, onR);
      }
      // Shallow copies, the way a real query returns detached rows. Handing
      // back live references made every "snapshot" in production code
      // secretly current, which hid exactly the class of stale-read bug the
      // freshness test below exists to catch.
      const matches = rows
        .filter((r) => preds.every((p) => p(r)))
        .map((r) => ({ ...r }));
      const data = single ? (matches[0] ?? null) : matches;
      return Promise.resolve({ data, error: null }).then(onF, onR);
    },
  } as unknown as Record<string, unknown> & PromiseLike<unknown>;
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (table: string) => chain(table as "people" | "organizations"),
  }),
}));

// Every domain accepts mail; MX is not what these tests are about.
vi.mock("@/lib/services/email-pattern", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/services/email-pattern")
  >("@/lib/services/email-pattern");
  return { ...actual, mxCheck: vi.fn().mockResolvedValue(true) };
});

// Exa contributes nothing unless a test says otherwise.
const exaResults = { results: [] as Array<{ text?: string }> };
const exaSearch = vi.fn<
  (
    query: string,
    options?: Record<string, unknown>,
  ) => Promise<typeof exaResults>
>(async () => exaResults);
vi.mock("@/lib/services/exa-service", () => ({
  ExaService: class {
    search = exaSearch;
  },
}));

vi.mock("@/lib/services/affiliation", () => ({
  // Matches the real signature: a mock resolving to undefined would let a
  // caller that reads `.written` pass on a value it can never get.
  recordAffiliation: vi.fn().mockResolvedValue({ written: true }),
}));

vi.mock("@/lib/services/cost-tracker", () => ({
  trackUsage: vi.fn(),
  PRICING: { email_provider_find: 0, email_provider_verify: 0 },
  withAction: (_l: string, fn: () => Promise<unknown>) => fn(),
}));

const provider = {
  id: "fake",
  canFind: true,
  canVerify: true,
  findEmail: vi.fn(),
  verifyEmail: vi.fn(),
};
let providerEnabled = true;

vi.mock("@/lib/services/email-provider", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/services/email-provider")
  >("@/lib/services/email-provider");
  return {
    ...actual,
    getEmailProvider: () => (providerEnabled ? provider : null),
  };
});

import { findEmailForPerson } from "@/lib/tools/email-tools";
import { MAX_VERIFICATIONS_PER_PERSON } from "@/lib/services/email-provider";
import { recordAffiliation } from "@/lib/services/affiliation";

const recordAffiliationMock = vi.mocked(recordAffiliation);

const ORG_ID = "org-1";

function seed(person: Partial<PersonRow> = {}, org: Partial<OrgRow> = {}) {
  state.people = [
    {
      id: "p1",
      name: "Jane Doe",
      work_email: null,
      work_email_source: null,
      work_email_confidence: null,
      work_email_verification: null,
      work_email_verified_by: null,
      work_email_verified_at: null,
      organization_id: ORG_ID,
      enrichment_data: {},
      ...person,
    },
  ];
  state.organizations = [
    {
      id: ORG_ID,
      name: "Acme",
      domain: "acme.com",
      is_catch_all: null,
      email_pattern: null,
      email_pattern_confidence: null,
      email_pattern_evidence_count: 0,
      ...org,
    },
  ];
}

const row = () => state.people[0];

beforeEach(() => {
  providerEnabled = true;
  exaResults.results = [];
  exaSearch.mockClear();
  tableErrors = {};
  recordAffiliationMock.mockClear();
  provider.findEmail.mockReset().mockResolvedValue(null);
  provider.verifyEmail
    .mockReset()
    .mockResolvedValue({ status: "unknown", catchAll: false });
  seed();
});

// ─── Verification decides what gets written ───────────────────────────────

describe("findEmailForPerson discovery is free by default", () => {
  it("stores a suggestion without spending a single provider credit", async () => {
    // The lazy-verification contract: discovery suggests, the send gate
    // proves. A default call must never bill.
    const result = await findEmailForPerson("p1");

    expect(result.email).toBe("jane.doe@acme.com");
    expect(result.verification).toBe("unchecked");
    expect(provider.verifyEmail).not.toHaveBeenCalled();
    expect(provider.findEmail).not.toHaveBeenCalled();
  });
});

describe("findEmailForPerson verification", () => {
  it("promotes a blind pattern guess to verified confidence when it deliverers", async () => {
    provider.verifyEmail.mockResolvedValue({
      status: "deliverable",
      catchAll: false,
    });

    const result = await findEmailForPerson("p1", { verify: true });

    expect(result.email).toBe("jane.doe@acme.com");
    expect(result.verification).toBe("deliverable");
    expect(result.confidence).toBe(0.95);
    expect(row().work_email_verification).toBe("deliverable");
    expect(row().work_email_verified_at).not.toBeNull();
  });

  it("never writes an address the verifier rejects", async () => {
    provider.verifyEmail.mockResolvedValue({
      status: "undeliverable",
      catchAll: false,
    });

    const result = await findEmailForPerson("p1", { verify: true });

    expect(result.email).toBeNull();
    expect(row().work_email).toBeNull();
    // and remembers it, so a re-run doesn't pay to be told the same thing
    expect(row().enrichment_data.rejectedEmails).toContain("jane.doe@acme.com");
  });

  it("falls through a rejected candidate to a deliverable one", async () => {
    provider.findEmail.mockResolvedValue({
      email: "jdoe@acme.com",
      confidence: 0.9,
    });
    provider.verifyEmail.mockImplementation(async (email: string) =>
      email === "jdoe@acme.com"
        ? { status: "undeliverable", catchAll: false }
        : { status: "deliverable", catchAll: false },
    );

    const result = await findEmailForPerson("p1", { verify: true });

    expect(result.email).toBe("jane.doe@acme.com");
    expect(result.confidence).toBe(0.95);
    expect(row().enrichment_data.rejectedEmails).toContain("jdoe@acme.com");
  });

  it("caps a catch-all 'deliverable' well below verified, it proves nothing", async () => {
    provider.verifyEmail.mockResolvedValue({
      status: "deliverable",
      catchAll: true,
    });

    const result = await findEmailForPerson("p1", { verify: true });

    expect(result.verification).toBe("risky");
    expect(result.confidence).toBeLessThanOrEqual(0.5);
    // not counted as verified, so it can't feed the org's pattern evidence
    expect(row().work_email_verified_at).toBeNull();
  });

  it("treats a verified mailbox at the org domain as proof of employment", async () => {
    // The point where the two problems solve each other: someone who answers
    // mail at acme.com works at Acme.
    provider.verifyEmail.mockResolvedValue({
      status: "deliverable",
      catchAll: false,
    });

    await findEmailForPerson("p1", { verify: true });

    expect(recordAffiliationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        personId: "p1",
        organizationId: ORG_ID,
        source: "email_domain",
      }),
    );
  });

  it("grants no affiliation credit on a catch-all domain", async () => {
    // A catch-all accepts every address, so delivery says nothing about whether
    // this person exists, let alone where they work.
    provider.verifyEmail.mockResolvedValue({
      status: "deliverable",
      catchAll: true,
    });

    await findEmailForPerson("p1", { verify: true });

    expect(recordAffiliationMock).not.toHaveBeenCalled();
  });

  it("grants no affiliation credit for an address off the org's domain", async () => {
    provider.findEmail.mockResolvedValue({
      email: "jane.doe@gmail.com",
      confidence: 0.9,
    });
    provider.verifyEmail.mockImplementation(async (email: string) => ({
      status: email.endsWith("@gmail.com") ? "deliverable" : "undeliverable",
      catchAll: false,
    }));

    await findEmailForPerson("p1", { verify: true });

    expect(recordAffiliationMock).not.toHaveBeenCalled();
  });

  it("caches catch-all on the organization rather than re-probing per contact", async () => {
    provider.verifyEmail.mockResolvedValue({
      status: "deliverable",
      catchAll: true,
    });

    await findEmailForPerson("p1", { verify: true });

    expect(state.organizations[0].is_catch_all).toBe(true);
    expect(state.organizations[0].catch_all_checked_at).toBeTruthy();
  });

  it("treats a provider outage as unknown, never as undeliverable", async () => {
    // What the Hunter adapter returns on HTTP 429 / timeout.
    provider.verifyEmail.mockResolvedValue({
      status: "unknown",
      catchAll: false,
      raw: "http_429",
    });

    const result = await findEmailForPerson("p1", { verify: true });

    expect(result.email).toBe("jane.doe@acme.com");
    expect(result.verification).toBe("unknown");
    expect(result.confidence).toBeLessThanOrEqual(0.6);
  });

  it("stops after the verification cap even with more candidates available", async () => {
    provider.findEmail.mockResolvedValue({
      email: "j.doe@acme.com",
      confidence: 0.8,
    });
    exaResults.results = [
      { text: "reach jane@acme.com or janedoe@acme.com or doe@acme.com" },
    ];
    provider.verifyEmail.mockResolvedValue({
      status: "undeliverable",
      catchAll: false,
    });

    await findEmailForPerson("p1", { verify: true });

    // Five candidates are available here (provider + three from Exa + the blind
    // guess), so an exact match on the cap proves it actually bit.
    expect(provider.verifyEmail).toHaveBeenCalledTimes(
      MAX_VERIFICATIONS_PER_PERSON,
    );
  });
});

// ─── No provider: old behaviour, honestly labelled ────────────────────────

describe("findEmailForPerson without a provider", () => {
  it("still writes a candidate but marks it unchecked", async () => {
    providerEnabled = false;

    const result = await findEmailForPerson("p1");

    expect(result.email).toBe("jane.doe@acme.com");
    expect(result.verification).toBe("unchecked");
    expect(provider.verifyEmail).not.toHaveBeenCalled();
  });

  it("a pure guess never counts as pattern evidence", async () => {
    providerEnabled = false;

    await findEmailForPerson("p1");

    // pattern_derived with no verifier behind it must not set verified_at, or
    // the guess would become evidence for the pattern that produced it.
    expect(row().work_email_source).toBe("pattern_derived");
    expect(row().work_email_verified_at).toBeNull();
  });

  it("an observed address still counts as pattern evidence without a verifier", async () => {
    providerEnabled = false;
    exaResults.results = [{ text: "email jane.doe@acme.com to reach her" }];

    await findEmailForPerson("p1");

    // This is what bootstraps the org pattern on a free-only instance —
    // recomputeOrgPattern reads verified_at, so dropping it here would mean no
    // instance without a paid key could ever learn a pattern.
    expect(row().work_email_source).toBe("exa_search");
    expect(row().work_email_verified_at).not.toBeNull();
  });
});

// ─── Candidate hygiene ────────────────────────────────────────────────────

describe("candidate selection", () => {
  it("prefers a provider hit over a blind guess", async () => {
    provider.findEmail.mockResolvedValue({
      email: "jdoe@acme.com",
      confidence: 0.9,
    });
    provider.verifyEmail.mockResolvedValue({
      status: "deliverable",
      catchAll: false,
    });

    const result = await findEmailForPerson("p1", { verify: true });

    expect(result.email).toBe("jdoe@acme.com");
    expect(result.source).toBe("provider_found");
  });

  it("rejects role addresses before spending a verification on them", async () => {
    exaResults.results = [{ text: "contact info@acme.com for details" }];
    provider.verifyEmail.mockResolvedValue({
      status: "deliverable",
      catchAll: false,
    });

    const result = await findEmailForPerson("p1", { verify: true });

    expect(result.email).not.toBe("info@acme.com");
    expect(provider.verifyEmail).not.toHaveBeenCalledWith("info@acme.com");
  });

  it("returns the existing address untouched when one is already stored", async () => {
    seed({ work_email: "known@acme.com", work_email_source: "user_entered" });

    const result = await findEmailForPerson("p1", { verify: true });

    expect(result.email).toBe("known@acme.com");
    expect(provider.verifyEmail).not.toHaveBeenCalled();
  });
});

describe("when the company lookup fails", () => {
  it("fails closed instead of silently running a degraded waterfall", async () => {
    // A discarded error here nulls the domain, which gates the org pattern,
    // the paid finder, the inferred pattern and the blind guess: the whole
    // waterfall silently degrades to a domainless Exa query, and "Could not
    // find an email address." is presented as a clean answer for a contact
    // whose org has a perfectly good domain.
    seed();
    tableErrors.organizations = { message: "connection reset by peer" };

    const result = await findEmailForPerson("p1");

    expect(result.email).toBeNull();
    expect(result.reason).toContain("connection reset");
    expect(result.reason).toMatch(/retry/i);
    // and nothing was written to the row off the degraded run
    expect(row().work_email).toBeNull();
  });
});

describe("recordNegatives freshness", () => {
  it("merges rejections against the row's current data, not the opening snapshot", async () => {
    // The negatives write used to spread a snapshot taken at the top of
    // findEmailForPerson -- before the Exa search and up to three provider
    // verifications, a multi-second window. Any enrichment merged in that
    // window was silently clobbered by the stale spread.
    seed();
    provider.findEmail.mockResolvedValue({
      email: "j.doe@acme.com",
      confidence: 0.9,
    });
    provider.verifyEmail.mockImplementation(async (email: string) => {
      if (email === "j.doe@acme.com") {
        // A concurrent enrichment run lands while we are verifying.
        row().enrichment_data = { linkedin: { posts: [] } };
        return { status: "undeliverable", catchAll: false };
      }
      return { status: "deliverable", catchAll: false };
    });

    await findEmailForPerson("p1", { verify: true });

    expect(row().work_email).toBe("jane.doe@acme.com");
    const data = row().enrichment_data as Record<string, unknown>;
    expect(data.rejectedEmails).toEqual(["j.doe@acme.com"]);
    // The concurrent write survived the negatives merge.
    expect(data.linkedin).toEqual({ posts: [] });
  });
});

// ─── Exa is the last free tier, not the first ─────────────────────────────

describe("findEmailForPerson Exa gating", () => {
  it("skips the paid Exa search when the org has a confident pattern", async () => {
    seed(
      {},
      { email_pattern: "{first}.{last}", email_pattern_confidence: 0.9 },
    );
    const res = await findEmailForPerson("p1", {});
    expect(res.email).toBe("jane.doe@acme.com");
    expect(exaSearch).not.toHaveBeenCalled();
  });

  it("still searches Exa when the pattern cannot render for a single-token name", async () => {
    seed(
      { name: "Madonna" },
      { email_pattern: "{first}.{last}", email_pattern_confidence: 0.9 },
    );
    await findEmailForPerson("p1", {});
    expect(exaSearch).toHaveBeenCalledTimes(1);
  });

  it("still searches Exa when no pattern is known", async () => {
    await findEmailForPerson("p1", {});
    expect(exaSearch).toHaveBeenCalledTimes(1);
    expect(exaSearch.mock.calls[0][1]).toMatchObject({ bypassCache: false });
  });

  it("searches Exa (cache bypassed) on revalidate even with a pattern", async () => {
    seed(
      {},
      { email_pattern: "{first}.{last}", email_pattern_confidence: 0.9 },
    );
    await findEmailForPerson("p1", { revalidate: true });
    expect(exaSearch).toHaveBeenCalledTimes(1);
    expect(exaSearch.mock.calls[0][1]).toMatchObject({ bypassCache: true });
  });
});
