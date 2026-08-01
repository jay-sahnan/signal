import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findOrCreateOrganization,
  findOrCreatePerson,
} from "@/lib/services/knowledge-base";
import { mapUnknownHeaders } from "@/lib/csv/header-mapper";
import type { TargetAccountRow } from "@/lib/types/target-list";

/**
 * appendAccountsToList: rows resolve to the global organizations pool
 * (domain-deduped), land in target_accounts behind the (list_id,
 * organization_id) unique constraint, and bump the list's row_count.
 * Contact-per-row files additionally import people (Task 4b).
 */

const h = vi.hoisted(() => ({
  getSupabaseAndUser: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAndUser: h.getSupabaseAndUser,
}));
vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: () => ({ capture: h.capture }),
}));
vi.mock("@/lib/services/knowledge-base", () => ({
  findOrCreateOrganization: vi.fn(),
  findOrCreatePerson: vi.fn(),
  normalizeDomain: (d: string) =>
    d
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, ""),
  canHoldPeople: (org: { domain?: string | null }) => Boolean(org.domain),
}));
const affiliations: Array<Record<string, unknown>> = [];
vi.mock("@/lib/services/affiliation", () => ({
  recordAffiliation: vi.fn(async (_c: unknown, a: Record<string, unknown>) => {
    affiliations.push(a);
  }),
}));
const verifiedEmails: Array<Record<string, unknown>> = [];
vi.mock("@/lib/services/email-pattern", () => ({
  recordVerifiedEmail: vi.fn(
    async (_c: unknown, a: Record<string, unknown>) => {
      verifiedEmails.push(a);
    },
  ),
}));
vi.mock("@/lib/csv/header-mapper", () => ({
  mapUnknownHeaders: vi.fn(),
}));

import {
  appendAccountsToList,
  MAX_ROWS_PER_REQUEST,
} from "@/lib/services/target-lists";
import { POST as postAccounts } from "@/app/api/target-lists/[id]/accounts/route";

const findOrCreateOrgMock = vi.mocked(findOrCreateOrganization);
const findOrCreatePersonMock = vi.mocked(findOrCreatePerson);
const mapUnknownHeadersMock = vi.mocked(mapUnknownHeaders);

interface RecordedCall {
  table: string;
  ops: Array<{ name: string; args: unknown[] }>;
}

/**
 * Thenable query-builder fake (outreach-sender.test.ts pattern): every chained
 * method records itself; awaiting a chain pops the next queued response.
 */
function fakeSupabase(
  responses: Array<{ data?: unknown; error?: unknown; count?: number }>,
) {
  let i = 0;
  const calls: RecordedCall[] = [];

  const from = (table: string) => {
    const call: RecordedCall = { table, ops: [] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    for (const name of [
      "select",
      "eq",
      "order",
      "update",
      "insert",
      "upsert",
      "single",
      "maybeSingle",
    ]) {
      builder[name] = (...args: unknown[]) => {
        call.ops.push({ name, args });
        return builder;
      };
    }
    builder.then = (
      resolve: (v: unknown) => unknown,
      reject: (e: unknown) => unknown,
    ) =>
      Promise.resolve(responses[i++] ?? { data: null, error: null }).then(
        resolve,
        reject,
      );
    return builder;
  };

  return { client: { from } as never, calls };
}

function ops(calls: RecordedCall[], table: string, op: string) {
  return calls
    .filter((c) => c.table === table)
    .flatMap((c) => c.ops.filter((o) => o.name === op));
}

beforeEach(() => {
  affiliations.length = 0;
  verifiedEmails.length = 0;
  findOrCreateOrgMock.mockReset();
  findOrCreatePersonMock.mockReset();
  mapUnknownHeadersMock.mockReset();
  mapUnknownHeadersMock.mockResolvedValue({});
  h.getSupabaseAndUser.mockReset();
  h.capture.mockReset();
  findOrCreateOrgMock.mockImplementation(
    async (d) =>
      ({ id: `org_${d.domain ?? d.name}`, domain: d.domain }) as never,
  );
  findOrCreatePersonMock.mockImplementation(
    async (d) => ({ id: `per_${d.name}`, name: d.name }) as never,
  );
});

describe("appendAccountsToList", () => {
  it("resolves rows to orgs and upserts with onConflict list_id,organization_id", async () => {
    const { client, calls } = fakeSupabase([
      { data: [{ id: "ta_1" }] }, // upsert acme
      { data: [{ id: "ta_2" }] }, // upsert globex
      { data: { row_count: 5 } }, // row_count read
      {}, // row_count update
    ]);

    const result = await appendAccountsToList(client, "list-1", [
      { name: "Acme", domain: "acme.com" },
      { name: "Globex", domain: "globex.com" },
    ]);

    expect(result).toEqual({
      imported: 2,
      skipped: 0,
      failed: 0,
      peopleImported: 0,
    });
    // Companies-only rows import zero people.
    expect(findOrCreatePersonMock).not.toHaveBeenCalled();
    expect(findOrCreateOrgMock).toHaveBeenCalledTimes(2);
    expect(findOrCreateOrgMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme", source: "target_list" }),
    );

    const upserts = ops(calls, "target_accounts", "upsert");
    expect(upserts).toHaveLength(2);
    for (const u of upserts) {
      expect(u.args[1]).toEqual({
        onConflict: "list_id,organization_id",
        ignoreDuplicates: true,
      });
      expect(u.args[0]).toMatchObject({ list_id: "list-1" });
    }

    // row_count incremented by imported, read-modify-write.
    const updates = ops(calls, "target_account_lists", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toEqual({ row_count: 7 });
  });

  it("dedups rows within the batch by resolved org", async () => {
    const { client } = fakeSupabase([
      { data: [{ id: "ta_1" }] },
      { data: { row_count: 0 } },
      {},
    ]);

    const result = await appendAccountsToList(client, "list-1", [
      { name: "Acme", domain: "www.Acme.com" },
      { name: "Acme Inc", url: "https://acme.com/about" }, // same apex domain
    ]);

    expect(result).toMatchObject({ imported: 1, skipped: 1, failed: 0 });
    expect(findOrCreateOrgMock).toHaveBeenCalledTimes(1);
  });

  it("counts an account already in the list as skipped and leaves row_count alone", async () => {
    // ignoreDuplicates upsert returns no rows for an existing account.
    const { client, calls } = fakeSupabase([{ data: [] }]);

    const result = await appendAccountsToList(client, "list-1", [
      { name: "Acme", domain: "acme.com" },
    ]);

    expect(result).toMatchObject({ imported: 0, skipped: 1, failed: 0 });
    expect(ops(calls, "target_account_lists", "update")).toHaveLength(0);
  });

  it("counts failed org resolutions without aborting the batch", async () => {
    findOrCreateOrgMock.mockImplementation(async (d) => {
      if (d.name === "Broken") throw new Error("boom");
      return { id: `org_${d.domain}`, domain: d.domain } as never;
    });
    const { client } = fakeSupabase([
      { data: [{ id: "ta_1" }] },
      { data: { row_count: 0 } },
      {},
    ]);

    const result = await appendAccountsToList(client, "list-1", [
      { name: "Acme", domain: "acme.com" },
      { name: "Broken", domain: "broken.com" },
    ]);

    expect(result).toMatchObject({ imported: 1, skipped: 0, failed: 1 });
  });

  it("runs the header mapper once for unmapped headers and folds mapped fields in", async () => {
    mapUnknownHeadersMock.mockResolvedValue({
      "web address": "domain",
      notes: "ignore",
    });
    const { client } = fakeSupabase([
      { data: [{ id: "ta_1" }] },
      { data: { row_count: 0 } },
      {},
    ]);

    await appendAccountsToList(client, "list-1", [
      {
        name: "Acme",
        extra: { "web address": "acme.com", notes: "met at conf" },
      },
    ]);

    expect(mapUnknownHeadersMock).toHaveBeenCalledTimes(1);
    expect(mapUnknownHeadersMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ header: "web address" }),
        expect.objectContaining({ header: "notes" }),
      ]),
      expect.anything(),
    );
    expect(findOrCreateOrgMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme", domain: "acme.com" }),
    );
  });

  it("imports one org and three people from contact-per-row rows", async () => {
    const { client } = fakeSupabase([
      { data: [{ id: "ta_1" }] }, // one account upsert for the shared company
      { data: { row_count: 0 } },
      {},
    ]);

    const rows: TargetAccountRow[] = [
      {
        name: "Acme",
        domain: "acme.com",
        person: {
          name: "Ada Lovelace",
          title: "CTO",
          email: "ada@acme.com",
          linkedin_url: "https://www.linkedin.com/in/ada",
        },
      },
      {
        name: "Acme",
        domain: "acme.com",
        person: {
          name: "Grace Hopper",
          title: "VP Eng",
          email: "grace@acme.com",
          linkedin_url: "https://www.linkedin.com/in/grace",
        },
      },
      {
        name: "Acme",
        domain: "acme.com",
        person: { name: "Alan Turing", title: null, email: null },
      },
    ];

    const result = await appendAccountsToList(client, "list-1", rows);

    expect(result).toEqual({
      imported: 1,
      skipped: 0,
      failed: 0,
      peopleImported: 3,
    });
    expect(findOrCreateOrgMock).toHaveBeenCalledTimes(1);

    // People land via findOrCreatePerson with the org, title and source —
    // and the caller's supabase client (knowledge-base convention).
    expect(findOrCreatePersonMock).toHaveBeenCalledTimes(3);
    expect(findOrCreatePersonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ada Lovelace",
        title: "CTO",
        linkedin_url: "https://www.linkedin.com/in/ada",
        work_email: "ada@acme.com",
        organization_id: "org_acme.com",
        source: "target_list",
      }),
      client,
    );

    // Affiliation provenance: an upload is a suggestion, not a human
    // assertion — csv_import, never user_entered, so Signal's own
    // verification (email_domain) and explicit human edits both outrank it.
    expect(affiliations).toHaveLength(3);
    for (const a of affiliations) {
      expect(a).toMatchObject({
        organizationId: "org_acme.com",
        source: "csv_import",
      });
      expect(String(a.evidence)).toContain("uploaded target list");
    }

    // Imported addresses are free suggestions: recorded as csv_import — below
    // every verified-ish source, so an upload can never displace an
    // established address — and the send gate's just-in-time verifier still
    // proves them (verification stays unchecked until send).
    expect(verifiedEmails).toHaveLength(2);
    expect(verifiedEmails[0]).toMatchObject({
      email: "ada@acme.com",
      source: "csv_import",
    });
  });

  it("skips junk that is not email-shaped but still imports the person", async () => {
    const { client } = fakeSupabase([
      { data: [{ id: "ta_1" }] },
      { data: { row_count: 0 } },
      {},
    ]);

    const result = await appendAccountsToList(client, "list-1", [
      {
        name: "Acme",
        domain: "acme.com",
        person: { name: "Ada Lovelace", title: "CTO", email: "n/a" },
      },
      {
        name: "Acme",
        domain: "acme.com",
        person: { name: "Grace Hopper", email: "see notes @ CRM" },
      },
    ]);

    expect(result).toMatchObject({ imported: 1, peopleImported: 2 });
    expect(findOrCreatePersonMock).toHaveBeenCalledTimes(2);
    // Neither "n/a" nor "see notes @ CRM" reaches recordVerifiedEmail.
    expect(verifiedEmails).toHaveLength(0);
  });

  it("still imports people when the account already exists (linkedin-deduped downstream)", async () => {
    // Re-import of the same file: the account upsert returns no rows.
    const { client } = fakeSupabase([{ data: [] }]);

    const result = await appendAccountsToList(client, "list-1", [
      {
        name: "Acme",
        domain: "acme.com",
        person: {
          name: "Ada Lovelace",
          linkedin_url: "https://www.linkedin.com/in/ada",
        },
      },
    ]);

    expect(result).toEqual({
      imported: 0,
      skipped: 1,
      failed: 0,
      peopleImported: 1,
    });
    // Dedup on re-import is by linkedin_url, inside findOrCreatePerson —
    // the service must pass the URL through for that to hold.
    expect(findOrCreatePersonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedin_url: "https://www.linkedin.com/in/ada",
      }),
      client,
    );
  });

  it("refuses to attach people to a domain-less org", async () => {
    findOrCreateOrgMock.mockResolvedValue({
      id: "org_nodomain",
      domain: null,
    } as never);
    const { client } = fakeSupabase([
      { data: [{ id: "ta_1" }] },
      { data: { row_count: 0 } },
      {},
    ]);

    const result = await appendAccountsToList(client, "list-1", [
      {
        name: "Acme",
        person: { name: "Ada Lovelace", email: "ada@acme.com" },
      },
    ]);

    // The account still imports; the person does not (canHoldPeople).
    expect(result).toMatchObject({ imported: 1, peopleImported: 0 });
    expect(findOrCreatePersonMock).not.toHaveBeenCalled();
    expect(affiliations).toHaveLength(0);
  });

  it("skips the header mapper when no row carries extra", async () => {
    const { client } = fakeSupabase([
      { data: [{ id: "ta_1" }] },
      { data: { row_count: 0 } },
      {},
    ]);

    await appendAccountsToList(client, "list-1", [
      { name: "Acme", domain: "acme.com" },
    ]);

    expect(mapUnknownHeadersMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/target-lists/[id]/accounts", () => {
  function request(body: unknown): Request {
    return new Request("http://localhost/api/target-lists/list-1/accounts", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }
  const routeParams = { params: Promise.resolve({ id: "list-1" }) };

  it("rejects payloads over the row cap with 413", async () => {
    h.getSupabaseAndUser.mockResolvedValue({
      supabase: fakeSupabase([]).client,
      user: { id: "user_1", email: "" },
    });
    const rows: TargetAccountRow[] = Array.from(
      { length: MAX_ROWS_PER_REQUEST + 1 },
      (_, i) => ({ name: `Co ${i}`, domain: `co${i}.com` }),
    );

    const res = await postAccounts(request({ rows }), routeParams);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain(String(MAX_ROWS_PER_REQUEST));
    expect(findOrCreateOrgMock).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    h.getSupabaseAndUser.mockResolvedValue(null);
    const res = await postAccounts(
      request({ rows: [{ name: "Acme" }] }),
      routeParams,
    );
    expect(res.status).toBe(401);
  });

  it("403s when the list belongs to someone else", async () => {
    const { client } = fakeSupabase([
      { data: { id: "list-1", user_id: "someone_else" } },
    ]);
    h.getSupabaseAndUser.mockResolvedValue({
      supabase: client,
      user: { id: "user_1", email: "" },
    });

    const res = await postAccounts(
      request({ rows: [{ name: "Acme" }] }),
      routeParams,
    );
    expect(res.status).toBe(403);
  });
});
