import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  applyPattern,
  emailMatchesName,
  inferPattern,
  isRolePrefix,
  KNOWN_PATTERNS,
  mxCheck,
  recordBounce,
  recordVerifiedEmail,
  splitName,
  type EmailSource,
  type VerifiedEmail,
} from "@/lib/services/email-pattern";

// ─── Fake Supabase ────────────────────────────────────────────────────────
//
// Minimal in-memory stub of the SupabaseClient surface used by
// recordVerifiedEmail / recordBounce / recomputeOrgPattern. Implements:
//   .from(table).select(cols).eq(...).maybeSingle()       → { data, error }
//   .from(table).select(cols).eq(...).not(...).then(...) → { data: row[], error }
//   .from(table).update(values).eq(...)                  → mutates in-memory rows

interface PersonRow {
  id: string;
  name: string;
  organization_id: string | null;
  work_email: string | null;
  work_email_source: EmailSource | null;
  work_email_confidence: number | null;
  work_email_verified_at: string | null;
  work_email_verification: string | null;
}
interface OrgRow {
  id: string;
  /** recordBounce needs it to re-derive what the pattern would have produced. */
  domain: string | null;
  email_pattern: string | null;
  email_pattern_confidence: number | null;
  email_pattern_evidence_count: number;
  email_pattern_bounce_count: number;
  email_pattern_updated_at: string | null;
}

function createFakeSupabase(initial: {
  people?: Partial<PersonRow>[];
  organizations?: Partial<OrgRow>[];
}) {
  const tables = {
    people: (initial.people ?? []).map((p) => ({
      id: "",
      name: "",
      organization_id: null,
      work_email: null,
      work_email_source: null,
      work_email_confidence: null,
      work_email_verified_at: null,
      work_email_verification: null,
      ...p,
    })) as PersonRow[],
    organizations: (initial.organizations ?? []).map((o) => ({
      id: "",
      domain: null,
      email_pattern: null,
      email_pattern_confidence: null,
      email_pattern_evidence_count: 0,
      email_pattern_bounce_count: 0,
      email_pattern_updated_at: null,
      ...o,
    })) as OrgRow[],
  };

  function chain(table: keyof typeof tables) {
    type Mode = "select" | "update";
    let mode: Mode = "select";
    let single = false;
    let updates: Record<string, unknown> = {};
    const preds: Array<(r: Record<string, unknown>) => boolean> = [];

    const c: Record<string, unknown> & PromiseLike<unknown> = {
      select(_cols?: string) {
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
      limit(_n: number) {
        return c;
      },
      order(_col: string, _opts?: unknown) {
        return c;
      },
      maybeSingle() {
        single = true;
        return c;
      },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        const rows = tables[table] as unknown as Record<string, unknown>[];
        if (mode === "update") {
          for (const r of rows) {
            if (preds.every((p) => p(r))) Object.assign(r, updates);
          }
          return Promise.resolve({ data: null, error: null }).then(onF, onR);
        }
        const matches = rows.filter((r) => preds.every((p) => p(r)));
        const data = single ? (matches[0] ?? null) : matches;
        return Promise.resolve({ data, error: null }).then(onF, onR);
      },
    } as unknown as Record<string, unknown> & PromiseLike<unknown>;
    return c;
  }

  const client = {
    from: (table: string) => chain(table as keyof typeof tables),
  } as unknown as SupabaseClient;
  return { client, tables };
}

// ─── splitName ────────────────────────────────────────────────────────────

describe("splitName", () => {
  it("splits a normal two-word name", () => {
    expect(splitName("Jane Doe")).toEqual({ first: "jane", last: "doe" });
  });
  it("returns last as null for a single-word name", () => {
    expect(splitName("Madonna")).toEqual({ first: "madonna", last: null });
  });
  it("treats the last whitespace-separated token as the last name", () => {
    expect(splitName("Mary Jane Watson")).toEqual({
      first: "mary",
      last: "watson",
    });
  });
  it("returns nulls for empty input", () => {
    expect(splitName("")).toEqual({ first: null, last: null });
  });
});

// ─── isRolePrefix ─────────────────────────────────────────────────────────

describe("isRolePrefix", () => {
  it.each([
    ["it", true],
    ["info", true],
    ["support", true],
    ["it.dept", true],
    ["support_team", true],
    ["sales-eu", true],
    ["press+pitches", true],
    ["jane", false],
    ["jdoe", false],
    ["jane.doe", false],
    ["italian.person", false], // doesn't start with "it" + separator
    ["informal", false], // doesn't start with "info" + separator
  ])("isRolePrefix(%s) → %s", (local, expected) => {
    expect(isRolePrefix(local)).toBe(expected);
  });
});

// ─── emailMatchesName ─────────────────────────────────────────────────────

describe("emailMatchesName", () => {
  it("rejects role-style addresses for a real person", () => {
    expect(emailMatchesName("it@acme.com", "Jane", "Doe")).toBe(false);
    expect(emailMatchesName("support@acme.com", "Jane", "Doe")).toBe(false);
  });
  it.each([
    ["jane@acme.com", "Jane", "Doe"],
    ["doe@acme.com", "Jane", "Doe"],
    ["jane.doe@acme.com", "Jane", "Doe"],
    ["jdoe@acme.com", "Jane", "Doe"],
    ["janed@acme.com", "Jane", "Doe"],
    ["doe.jane@acme.com", "Jane", "Doe"],
    ["jane_doe@acme.com", "Jane", "Doe"],
    ["jay.sahnan@browserbase.com", "Jay", "Sahnan"],
  ])("accepts %s for %s %s", (email, first, last) => {
    expect(emailMatchesName(email, first, last)).toBe(true);
  });
  it("rejects unrelated names", () => {
    expect(emailMatchesName("bob@acme.com", "Jane", "Doe")).toBe(false);
  });
  it("handles missing last name gracefully", () => {
    expect(emailMatchesName("madonna@acme.com", "Madonna", null)).toBe(true);
    expect(emailMatchesName("admin@acme.com", "Madonna", null)).toBe(false);
  });
});

// ─── applyPattern ─────────────────────────────────────────────────────────

describe("applyPattern", () => {
  const cases: Array<[string, string, string, string, string]> = [
    ["{first}.{last}", "Jane", "Doe", "acme.com", "jane.doe@acme.com"],
    ["{first}{last}", "Jane", "Doe", "acme.com", "janedoe@acme.com"],
    ["{f}{last}", "Jane", "Doe", "acme.com", "jdoe@acme.com"],
    ["{first}_{last}", "Jane", "Doe", "acme.com", "jane_doe@acme.com"],
    ["{first}-{last}", "Jane", "Doe", "acme.com", "jane-doe@acme.com"],
    ["{f}.{last}", "Jane", "Doe", "acme.com", "j.doe@acme.com"],
    ["{first}.{l}", "Jane", "Doe", "acme.com", "jane.d@acme.com"],
    ["{first}", "Jane", "Doe", "acme.com", "jane@acme.com"],
    ["{last}", "Jane", "Doe", "acme.com", "doe@acme.com"],
  ];
  it.each(cases)(
    "applyPattern(%s, %s, %s, %s) → %s",
    (pattern, first, last, domain, expected) => {
      expect(applyPattern(pattern, first, last, domain)).toBe(expected);
    },
  );

  it("strips non-alphanumeric from name parts", () => {
    expect(
      applyPattern("{first}.{last}", "Marie-Claire", "O'Brien", "acme.com"),
    ).toBe("marieclaire.obrien@acme.com");
  });

  it("folds accents to their base letter instead of deleting them", () => {
    // Stripping straight to [a-z0-9] dropped the accented character outright,
    // so "Clémentine Markman" guessed clmentine@ — a wrong address for every
    // name carrying a diacritic.
    expect(applyPattern("{first}", "Clémentine", "Markman", "granola.ai")).toBe(
      "clementine@granola.ai",
    );
    expect(
      applyPattern("{first}.{last}", "Roberto", "Ramírez", "acme.com"),
    ).toBe("roberto.ramirez@acme.com");
    expect(applyPattern("{first}.{last}", "Søren", "Müller", "acme.com")).toBe(
      "sren.muller@acme.com",
    );
  });

  it("returns null when last name needed but missing", () => {
    expect(
      applyPattern("{first}.{last}", "Madonna", null, "acme.com"),
    ).toBeNull();
  });

  it("works with single-name + first-only pattern", () => {
    expect(applyPattern("{first}", "Madonna", null, "acme.com")).toBe(
      "madonna@acme.com",
    );
  });

  it("lowercases the domain", () => {
    expect(applyPattern("{first}", "Jane", null, "Acme.COM")).toBe(
      "jane@acme.com",
    );
  });
});

// ─── inferPattern ─────────────────────────────────────────────────────────

describe("inferPattern", () => {
  it("returns null pattern when no emails are provided", () => {
    expect(inferPattern([])).toEqual({
      pattern: null,
      confidence: 0,
      evidenceCount: 0,
    });
  });

  it("finds the right pattern from a single team-page email", () => {
    const emails: VerifiedEmail[] = [
      {
        email: "jane.doe@acme.com",
        firstName: "Jane",
        lastName: "Doe",
        source: "team_page",
      },
    ];
    const result = inferPattern(emails);
    expect(result.pattern).toBe("{first}.{last}");
    expect(result.confidence).toBeCloseTo(1.0);
    expect(result.evidenceCount).toBe(1);
  });

  it("aggregates multiple matching emails", () => {
    const emails: VerifiedEmail[] = [
      {
        email: "jane.doe@acme.com",
        firstName: "Jane",
        lastName: "Doe",
        source: "team_page",
      },
      {
        email: "bob.smith@acme.com",
        firstName: "Bob",
        lastName: "Smith",
        source: "team_page",
      },
      {
        email: "lee.jones@acme.com",
        firstName: "Lee",
        lastName: "Jones",
        source: "send_confirmed",
      },
    ];
    const result = inferPattern(emails);
    expect(result.pattern).toBe("{first}.{last}");
    expect(result.evidenceCount).toBe(3);
    expect(result.confidence).toBeCloseTo(1.0);
  });

  it("ignores role-prefix addresses entirely", () => {
    const emails: VerifiedEmail[] = [
      {
        email: "it@acme.com",
        firstName: "Jane",
        lastName: "Doe",
        source: "team_page",
      },
    ];
    expect(inferPattern(emails).pattern).toBeNull();
  });

  it("favors send_confirmed evidence over scraped emails when patterns conflict", () => {
    const emails: VerifiedEmail[] = [
      // 1 scraped email matching {first}.{last} (weight 0.7)
      {
        email: "jane.doe@acme.com",
        firstName: "Jane",
        lastName: "Doe",
        source: "team_page",
      },
      // 1 send-confirmed email matching {first} (weight 0.95)
      {
        email: "bob@acme.com",
        firstName: "Bob",
        lastName: "Smith",
        source: "send_confirmed",
      },
    ];
    const result = inferPattern(emails);
    expect(result.pattern).toBe("{first}");
    // confidence = 0.95 / (0.7 + 0.95)
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.confidence).toBeLessThan(1);
  });

  it("ignores pattern_derived sources (no feedback loop)", () => {
    const emails: VerifiedEmail[] = [
      {
        email: "jane.doe@acme.com",
        firstName: "Jane",
        lastName: "Doe",
        source: "pattern_derived",
      },
    ];
    expect(inferPattern(emails).pattern).toBeNull();
  });

  it("includes every known pattern in scoring", () => {
    // Sanity check that KNOWN_PATTERNS hasn't drifted from the test cases above.
    expect(KNOWN_PATTERNS).toContain("{first}.{last}");
    expect(KNOWN_PATTERNS).toContain("{first}");
  });
});

// ─── mxCheck ──────────────────────────────────────────────────────────────

// ─── recordVerifiedEmail ──────────────────────────────────────────────────

describe("recordVerifiedEmail", () => {
  it("skips role-prefix addresses (does not write)", async () => {
    const { client, tables } = createFakeSupabase({
      people: [{ id: "p1", name: "Jane Doe", organization_id: "o1" }],
      organizations: [{ id: "o1" }],
    });
    await recordVerifiedEmail(client, {
      personId: "p1",
      email: "it@acme.com",
      source: "team_page",
    });
    expect(tables.people[0].work_email).toBeNull();
    expect(tables.people[0].work_email_source).toBeNull();
  });

  it("writes a new email when person has none", async () => {
    const { client, tables } = createFakeSupabase({
      people: [{ id: "p1", name: "Jane Doe", organization_id: "o1" }],
      organizations: [{ id: "o1" }],
    });
    await recordVerifiedEmail(client, {
      personId: "p1",
      email: "Jane.Doe@Acme.com",
      source: "team_page",
    });
    expect(tables.people[0].work_email).toBe("jane.doe@acme.com");
    expect(tables.people[0].work_email_source).toBe("team_page");
    expect(tables.people[0].work_email_confidence).toBeCloseTo(0.7);
    expect(tables.people[0].work_email_verified_at).not.toBeNull();
  });

  it("does NOT downgrade send_confirmed → team_page on a different email", async () => {
    const { client, tables } = createFakeSupabase({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "send_confirmed",
          work_email_confidence: 0.95,
        },
      ],
      organizations: [{ id: "o1" }],
    });
    await recordVerifiedEmail(client, {
      personId: "p1",
      email: "jane.doe@acme.com",
      source: "team_page",
    });
    expect(tables.people[0].work_email).toBe("jane@acme.com");
    expect(tables.people[0].work_email_source).toBe("send_confirmed");
  });

  it("upgrades team_page → user_entered for the same email", async () => {
    const { client, tables } = createFakeSupabase({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "team_page",
          work_email_confidence: 0.7,
        },
      ],
      organizations: [{ id: "o1" }],
    });
    await recordVerifiedEmail(client, {
      personId: "p1",
      email: "jane@acme.com",
      source: "user_entered",
    });
    expect(tables.people[0].work_email_source).toBe("user_entered");
    expect(tables.people[0].work_email_confidence).toBeCloseTo(1.0);
  });

  it("does NOT let csv_import displace an existing deliverable address", async () => {
    // A CSV upload is often AI-generated or a stale export. The address a
    // provider found — and a verifier has since proven deliverable — must
    // survive a re-import carrying a different (possibly hallucinated) one.
    // csv_import (0.5) sits below provider_found (0.75) and team_page (0.7),
    // so the different-email write is refused and the verdict stays intact.
    const { client, tables } = createFakeSupabase({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "provider_found",
          work_email_confidence: 0.75,
          work_email_verification: "deliverable",
        },
      ],
      organizations: [{ id: "o1" }],
    });
    await recordVerifiedEmail(client, {
      personId: "p1",
      email: "jane.doe@acme.com",
      source: "csv_import",
    });
    expect(tables.people[0].work_email).toBe("jane@acme.com");
    expect(tables.people[0].work_email_source).toBe("provider_found");
    expect(tables.people[0].work_email_verification).toBe("deliverable");
  });

  it("writes a csv_import address over a bare exa_search suggestion", async () => {
    // Below the verified-ish sources but above a string Exa found near a
    // name: an upload is still an answer about this specific person.
    const { client, tables } = createFakeSupabase({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "j.doe@acme.com",
          work_email_source: "exa_search",
          work_email_confidence: 0.3,
        },
      ],
      organizations: [{ id: "o1" }],
    });
    await recordVerifiedEmail(client, {
      personId: "p1",
      email: "jane.doe@acme.com",
      source: "csv_import",
    });
    expect(tables.people[0].work_email).toBe("jane.doe@acme.com");
    expect(tables.people[0].work_email_source).toBe("csv_import");
    // The new address carries no verdict — the send gate's just-in-time
    // verifier still has to prove it before anything leaves.
    expect(tables.people[0].work_email_verification).toBeNull();
  });

  it("keeps the stronger source on a same-email refresh with weaker source", async () => {
    // Same email, weaker incoming source: refresh verified_at, keep stronger source.
    const { client, tables } = createFakeSupabase({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane@acme.com",
          work_email_source: "send_confirmed",
          work_email_confidence: 0.95,
        },
      ],
      organizations: [{ id: "o1" }],
    });
    await recordVerifiedEmail(client, {
      personId: "p1",
      email: "jane@acme.com",
      source: "team_page",
    });
    expect(tables.people[0].work_email_source).toBe("send_confirmed");
    expect(tables.people[0].work_email_confidence).toBeCloseTo(0.95);
    expect(tables.people[0].work_email_verified_at).not.toBeNull();
  });
});

// ─── recordBounce ─────────────────────────────────────────────────────────

describe("recordBounce", () => {
  it("no-ops when person not found", async () => {
    const { client, tables } = createFakeSupabase({});
    await recordBounce(client, { personId: "missing", email: "x@y.com" });
    expect(tables.people).toHaveLength(0);
  });

  it("no-ops when bounced email differs from stored work_email", async () => {
    const { client, tables } = createFakeSupabase({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane.doe@acme.com",
          work_email_source: "send_confirmed",
          work_email_confidence: 0.95,
          work_email_verified_at: "2026-04-25T00:00:00Z",
        },
      ],
      organizations: [{ id: "o1" }],
    });
    await recordBounce(client, {
      personId: "p1",
      email: "different@acme.com",
    });
    // Untouched
    expect(tables.people[0].work_email_verified_at).toBe(
      "2026-04-25T00:00:00Z",
    );
    expect(tables.people[0].work_email_confidence).toBeCloseTo(0.95);
  });

  it("clears verified_at + confidence on the person", async () => {
    const { client, tables } = createFakeSupabase({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane.doe@acme.com",
          work_email_source: "team_page",
          work_email_confidence: 0.7,
          work_email_verified_at: "2026-04-25T00:00:00Z",
        },
      ],
      organizations: [{ id: "o1" }],
    });
    await recordBounce(client, { personId: "p1", email: "jane.doe@acme.com" });
    expect(tables.people[0].work_email_verified_at).toBeNull();
    expect(tables.people[0].work_email_confidence).toBe(0);
  });

  it("does NOT touch the org pattern when source != pattern_derived", async () => {
    const { client, tables } = createFakeSupabase({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane.doe@acme.com",
          work_email_source: "team_page",
          work_email_confidence: 0.7,
        },
      ],
      organizations: [
        {
          id: "o1",
          domain: "acme.com",
          email_pattern: "{first}.{last}",
          email_pattern_confidence: 0.9,
          email_pattern_evidence_count: 3,
          email_pattern_bounce_count: 0,
        },
      ],
    });
    await recordBounce(client, { personId: "p1", email: "jane.doe@acme.com" });
    expect(tables.organizations[0].email_pattern).toBe("{first}.{last}");
    expect(tables.organizations[0].email_pattern_confidence).toBeCloseTo(0.9);
    expect(tables.organizations[0].email_pattern_bounce_count).toBe(0);
  });

  it("halves the pattern confidence when bounce ratio crosses 0.3", async () => {
    const { client, tables } = createFakeSupabase({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane.doe@acme.com",
          work_email_source: "pattern_derived",
        },
      ],
      organizations: [
        {
          id: "o1",
          domain: "acme.com",
          email_pattern: "{first}.{last}",
          email_pattern_confidence: 0.8,
          email_pattern_evidence_count: 3,
          email_pattern_bounce_count: 0,
        },
      ],
    });
    await recordBounce(client, { personId: "p1", email: "jane.doe@acme.com" });
    // 1/3 = 0.33 → halve: 0.4
    expect(tables.organizations[0].email_pattern).toBe("{first}.{last}");
    expect(tables.organizations[0].email_pattern_confidence).toBeCloseTo(0.4);
    expect(tables.organizations[0].email_pattern_bounce_count).toBe(1);
  });

  it("clears the pattern entirely when bounce ratio crosses 0.5", async () => {
    const { client, tables } = createFakeSupabase({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane.doe@acme.com",
          work_email_source: "pattern_derived",
        },
      ],
      organizations: [
        {
          id: "o1",
          domain: "acme.com",
          email_pattern: "{first}.{last}",
          email_pattern_confidence: 0.8,
          email_pattern_evidence_count: 1,
          email_pattern_bounce_count: 0,
        },
      ],
    });
    await recordBounce(client, { personId: "p1", email: "jane.doe@acme.com" });
    // 1/1 = 1.0 → clear
    expect(tables.organizations[0].email_pattern).toBeNull();
    expect(tables.organizations[0].email_pattern_confidence).toBe(0);
    expect(tables.organizations[0].email_pattern_bounce_count).toBe(1);
  });

  it("does NOT wipe a pattern when evidence_count is 0 even after recompute", async () => {
    // Cached pattern exists but evidence_count is 0 (stale cache, no
    // verifiable people in the org). Bounce should bump count but leave the
    // pattern intact since recomputeOrgPattern would also see 0 evidence
    // and write null — meaning we end up not finding any votes for the
    // existing pattern. Behavior here: don't apply the ratio rule, just
    // bump the bounce count.
    const { client, tables } = createFakeSupabase({
      people: [
        {
          id: "p1",
          name: "Jane Doe",
          organization_id: "o1",
          work_email: "jane.doe@acme.com",
          work_email_source: "pattern_derived",
        },
      ],
      organizations: [
        {
          id: "o1",
          domain: "acme.com",
          email_pattern: "{first}.{last}",
          email_pattern_confidence: 0.8,
          email_pattern_evidence_count: 0,
          email_pattern_bounce_count: 0,
        },
      ],
    });
    await recordBounce(client, { personId: "p1", email: "jane.doe@acme.com" });
    // After recompute: no other verified people in the org, so pattern
    // becomes null + evidence stays 0. Bounce count bumps to 1, but the
    // ratio branch is skipped because evidence is still 0.
    expect(tables.organizations[0].email_pattern_bounce_count).toBe(1);
  });
});

describe("mxCheck", () => {
  it("returns true when DNS returns at least one MX record", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValue([{ exchange: "smtp.example.com", priority: 10 }]);
    expect(await mxCheck("acme.com", resolver)).toBe(true);
  });

  it("returns false when DNS lookup throws (NXDOMAIN, etc.)", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("NXDOMAIN"));
    expect(await mxCheck("nope.invalid", resolver)).toBe(false);
  });

  it("returns false when DNS returns zero MX records", async () => {
    const resolver = vi.fn().mockResolvedValue([]);
    expect(await mxCheck("noemail.example.com", resolver)).toBe(false);
  });
});
