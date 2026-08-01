import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Target-list agent tools. Invariants under test:
 * - getTargetList reports the counts the agent quotes progress from.
 * - linkTargetListToCampaign bulk-upserts campaign_organizations with the
 *   exact onConflict key + ignoreDuplicates, upserts campaign_people for
 *   imported contacts (status "pending"), and is idempotent.
 * - prioritizeTargetAccounts hard-gates on a missing ICP with ZERO LLM
 *   calls, requires the list to be linked, only scores unscored rows, and
 *   writes score/reason/status keyed by organizationId.
 */

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  auth: vi.fn(),
  scoreTargetAccounts: vi.fn(),
  getQStashClient: vi.fn(),
  publishJSON: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: h.createClient,
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: h.auth,
}));
vi.mock("@/lib/services/target-account-scorer", () => ({
  scoreTargetAccounts: h.scoreTargetAccounts,
}));
vi.mock("@/lib/services/qstash", () => ({
  getQStashClient: h.getQStashClient,
  getBaseUrl: () => "http://localhost:3000",
}));

import {
  getTargetLists,
  getTargetList,
  linkTargetListToCampaign,
  prioritizeTargetAccounts,
  enrichTargetAccounts,
} from "@/lib/tools/target-list-tools";

const LIST = "11111111-1111-1111-1111-111111111111";
const CAMPAIGN = "22222222-2222-2222-2222-222222222222";
const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ORG_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

interface RecordedCall {
  table: string;
  ops: Array<{ name: string; args: unknown[] }>;
}

/**
 * Thenable query-builder fake (outreach-sender.test.ts pattern): every
 * chained method records itself, awaiting the chain pops the next queued
 * response.
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
      "in",
      "is",
      "not",
      "order",
      "limit",
      "range",
      "update",
      "upsert",
      "insert",
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

function op(calls: RecordedCall[], table: string, name: string) {
  const call = calls.find(
    (c) => c.table === table && c.ops.some((o) => o.name === name),
  );
  return call?.ops.find((o) => o.name === name);
}

const run = <T>(tool: { execute?: unknown }, input: Record<string, unknown>) =>
  (tool.execute as (i: unknown, o: unknown) => Promise<T>)(input, {} as never);

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ userId: "user_1" });
  h.scoreTargetAccounts.mockResolvedValue([]);
  h.publishJSON.mockResolvedValue({ messageId: "msg_1" });
  h.getQStashClient.mockReturnValue({ publishJSON: h.publishJSON });
});

describe("getTargetLists", () => {
  it("lists mine newest first", async () => {
    const { client, calls } = fakeSupabase([
      { data: [{ id: LIST, name: "Q3 targets", row_count: 40 }] },
    ]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{ lists: unknown[] }>(getTargetLists, {});

    expect(result.lists).toHaveLength(1);
    expect(op(calls, "target_account_lists", "order")?.args).toEqual([
      "created_at",
      { ascending: false },
    ]);
  });
});

describe("getTargetList", () => {
  it("returns meta, first accounts, and total/enriched/queued counts", async () => {
    const { client, calls } = fakeSupabase([
      { data: { id: LIST, name: "Q3 targets", row_count: 3 } },
      {
        data: [
          {
            organization_id: "org_1",
            enrich_requested_at: null,
            organization: {
              name: "Acme",
              domain: "acme.com",
              enrichment_status: "enriched",
            },
          },
        ],
      },
      { count: 3 }, // total
      { count: 1 }, // enriched
      { count: 2 }, // queued
    ]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{
      list: { name: string };
      accounts: Array<Record<string, unknown>>;
      counts: { total: number; enriched: number; enrichQueued: number };
    }>(getTargetList, { listId: LIST });

    expect(result.list.name).toBe("Q3 targets");
    expect(result.accounts).toEqual([
      {
        organizationId: "org_1",
        name: "Acme",
        domain: "acme.com",
        enrichmentStatus: "enriched",
        enrichQueued: false,
      },
    ]);
    expect(result.counts).toEqual({ total: 3, enriched: 1, enrichQueued: 2 });
    expect(op(calls, "target_accounts", "limit")?.args).toEqual([25]);

    // enrichQueued mirrors the processor's picker: stamped AND org still
    // pending — otherwise it overstates in-flight work forever.
    const queuedCall = calls.find(
      (c) =>
        c.table === "target_accounts" &&
        c.ops.some(
          (o) =>
            o.name === "not" &&
            o.args[0] === "enrich_requested_at" &&
            o.args[2] === null,
        ),
    );
    expect(queuedCall?.ops).toContainEqual({
      name: "eq",
      args: ["organizations.enrichment_status", "pending"],
    });
  });
});

describe("linkTargetListToCampaign", () => {
  it("bulk-upserts campaign_organizations and campaign_people with the right onConflict", async () => {
    const { client, calls } = fakeSupabase([
      { data: { id: LIST, name: "Q3 targets" } },
      { data: [{ organization_id: "org_1" }, { organization_id: "org_2" }] },
      { data: [{ organization_id: "org_1" }, { organization_id: "org_2" }] },
      { data: [{ id: "p1" }] },
      { data: [{ person_id: "p1" }] },
    ]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{
      linked: number;
      alreadyLinked: number;
      peopleLinked: number;
    }>(linkTargetListToCampaign, { listId: LIST, campaignId: CAMPAIGN });

    expect(result.linked).toBe(2);
    expect(result.alreadyLinked).toBe(0);
    expect(result.peopleLinked).toBe(1);

    const orgUpsert = op(calls, "campaign_organizations", "upsert")!;
    expect(orgUpsert.args[0]).toEqual([
      { campaign_id: CAMPAIGN, organization_id: "org_1" },
      { campaign_id: CAMPAIGN, organization_id: "org_2" },
    ]);
    expect(orgUpsert.args[1]).toEqual({
      onConflict: "campaign_id,organization_id",
      ignoreDuplicates: true,
    });

    const peopleUpsert = op(calls, "campaign_people", "upsert")!;
    expect(peopleUpsert.args[0]).toEqual([
      { campaign_id: CAMPAIGN, person_id: "p1", status: "pending" },
    ]);
    expect(peopleUpsert.args[1]).toEqual({
      onConflict: "campaign_id,person_id",
      ignoreDuplicates: true,
    });

    // Orgs live in a shared pool: only list-imported contacts ride along,
    // never people other campaigns/users discovered at the same companies.
    const peopleSelect = calls.find((c) => c.table === "people");
    expect(peopleSelect?.ops).toContainEqual({
      name: "eq",
      args: ["source", "target_list"],
    });
  });

  it("is idempotent: a second call reports alreadyLinked", async () => {
    const { client } = fakeSupabase([
      { data: { id: LIST, name: "Q3 targets" } },
      { data: [{ organization_id: "org_1" }, { organization_id: "org_2" }] },
      { data: [] }, // duplicates ignored — nothing inserted
      { data: [{ id: "p1" }] },
      { data: [] },
    ]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{
      linked: number;
      alreadyLinked: number;
      peopleLinked: number;
    }>(linkTargetListToCampaign, { listId: LIST, campaignId: CAMPAIGN });

    expect(result).toMatchObject({
      linked: 0,
      alreadyLinked: 2,
      peopleLinked: 0,
    });
  });
});

describe("prioritizeTargetAccounts", () => {
  const campaignRow = (icp: Record<string, unknown>) => ({
    data: {
      id: CAMPAIGN,
      name: "Q3 UK fintech",
      icp,
      offering: { description: "API monitoring" },
    },
  });

  const accountRow = (id: string, name: string) => ({
    organization_id: id,
    raw: {},
    organization: {
      id,
      name,
      domain: `${name.toLowerCase()}.com`,
      industry: null,
      location: null,
    },
  });

  it("hard-gates on missing ICP with zero LLM calls", async () => {
    const { client, calls } = fakeSupabase([campaignRow({})]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{ error?: string }>(prioritizeTargetAccounts, {
      listId: LIST,
      campaignId: CAMPAIGN,
    });

    expect(result.error).toMatch(/no ICP/i);
    expect(result.error).toMatch(/saveCampaign/);
    expect(h.scoreTargetAccounts).not.toHaveBeenCalled();
    // Short-circuits before touching the list at all.
    expect(calls.map((c) => c.table)).toEqual(["campaigns"]);
  });

  it("requires the list to be linked first", async () => {
    const { client } = fakeSupabase([
      campaignRow({ targetTitles: ["CTO"] }),
      { data: [accountRow("org_a", "Acme")] },
      { data: [] }, // no campaign_organizations memberships
    ]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{ error?: string }>(prioritizeTargetAccounts, {
      listId: LIST,
      campaignId: CAMPAIGN,
    });

    expect(result.error).toMatch(/linkTargetListToCampaign/);
    expect(h.scoreTargetAccounts).not.toHaveBeenCalled();
  });

  it("scores only unscored rows and writes score/reason/status keyed by organizationId", async () => {
    const { client, calls } = fakeSupabase([
      campaignRow({ targetTitles: ["CTO"] }),
      {
        data: [
          accountRow("org_a", "Acme"),
          accountRow("org_b", "Beta"),
          accountRow("org_c", "Gamma"),
        ],
      },
      {
        data: [
          { organization_id: "org_a", relevance_score: 7, score_reason: "old" },
          { organization_id: "org_b", relevance_score: 0, score_reason: null },
          {
            organization_id: "org_c",
            relevance_score: null,
            score_reason: null,
          },
        ],
      },
      { data: null }, // update org_b
      { data: null }, // update org_c
      { data: [{ organization_id: "org_b" }, { organization_id: "org_b" }] }, // imported contacts
    ]);
    h.createClient.mockResolvedValue(client);
    h.scoreTargetAccounts.mockResolvedValue([
      { organizationId: "org_b", score: 8, reason: "Strong fit" },
      { organizationId: "org_c", score: 3, reason: "Weak fit" },
    ]);

    const result = await run<{
      scored: number;
      topSlice: Array<Record<string, unknown>>;
      estimatedEnrichCostUsd: number;
    }>(prioritizeTargetAccounts, { listId: LIST, campaignId: CAMPAIGN });

    // org_a (already scored) never reaches the scorer.
    const scorerInput = h.scoreTargetAccounts.mock.calls[0][0] as {
      campaign: { id: string };
      accounts: Array<{ organizationId: string }>;
      userId: string;
    };
    expect(scorerInput.campaign.id).toBe(CAMPAIGN);
    expect(scorerInput.userId).toBe("user_1");
    expect(scorerInput.accounts.map((a) => a.organizationId)).toEqual([
      "org_b",
      "org_c",
    ]);

    // Writes keyed by organizationId on the campaign membership.
    const updates = calls.filter(
      (c) =>
        c.table === "campaign_organizations" &&
        c.ops.some((o) => o.name === "update"),
    );
    expect(updates).toHaveLength(2);
    expect(updates[0].ops.find((o) => o.name === "update")?.args[0]).toEqual({
      relevance_score: 8,
      score_reason: "Strong fit",
      status: "qualified",
    });
    expect(
      updates[0].ops.filter((o) => o.name === "eq").map((o) => o.args),
    ).toEqual([
      ["campaign_id", CAMPAIGN],
      ["organization_id", "org_b"],
    ]);
    expect(updates[1].ops.find((o) => o.name === "update")?.args[0]).toEqual({
      relevance_score: 3,
      score_reason: "Weak fit",
      status: "disqualified",
    });

    // Top slice: ceil(3 * 0.1) = 1, best score first, with contact coverage.
    expect(result.scored).toBe(2);
    expect(result.topSlice).toHaveLength(1);
    expect(result.topSlice[0]).toMatchObject({
      organizationId: "org_b",
      name: "Beta",
      score: 8,
      reason: "Strong fit",
      importedContacts: 2,
    });
    expect(result.estimatedEnrichCostUsd).toBeCloseTo(0.08);
  });

  it("skips the LLM entirely when every linked row is already scored", async () => {
    const { client } = fakeSupabase([
      campaignRow({ targetTitles: ["CTO"] }),
      { data: [accountRow("org_a", "Acme")] },
      {
        data: [
          { organization_id: "org_a", relevance_score: 9, score_reason: "hot" },
        ],
      },
      { data: [{ organization_id: "org_a" }] }, // imported contacts for slice
    ]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{
      scored: number;
      topSlice: Array<Record<string, unknown>>;
    }>(prioritizeTargetAccounts, { listId: LIST, campaignId: CAMPAIGN });

    expect(h.scoreTargetAccounts).not.toHaveBeenCalled();
    expect(result.scored).toBe(0);
    expect(result.topSlice[0]).toMatchObject({
      organizationId: "org_a",
      score: 9,
    });
  });
});

describe("enrichTargetAccounts", () => {
  const listRow = { data: { id: LIST, name: "Q3 targets" } };
  const campaignRow = { data: { id: CAMPAIGN } };
  const verifyRow = (id: string, status = "pending") => ({
    organization_id: id,
    organization: { enrichment_status: status },
  });

  it("errors when the campaign is not found (or not mine) before touching rows", async () => {
    const { client, calls } = fakeSupabase([
      listRow,
      { data: null, error: { message: "0 rows" } }, // campaign lookup
    ]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{ error?: string }>(enrichTargetAccounts, {
      listId: LIST,
      campaignId: CAMPAIGN,
      organizationIds: [ORG_A],
    });

    expect(result.error).toMatch(/campaign not found/i);
    expect(h.publishJSON).not.toHaveBeenCalled();
    expect(op(calls, "target_accounts", "update")).toBeUndefined();
  });

  it("rejects organizations that are not on the list, without stamping", async () => {
    const { client, calls } = fakeSupabase([
      listRow,
      campaignRow,
      { data: [verifyRow(ORG_A)] }, // ORG_B missing from the list
    ]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{ error?: string }>(enrichTargetAccounts, {
      listId: LIST,
      campaignId: CAMPAIGN,
      organizationIds: [ORG_A, ORG_B],
    });

    expect(result.error).toMatch(/not in this list/);
    expect(result.error).toContain(ORG_B);
    expect(h.publishJSON).not.toHaveBeenCalled();
    expect(op(calls, "target_accounts", "update")).toBeUndefined();
  });

  it("checks QStash config BEFORE stamping any rows", async () => {
    h.getQStashClient.mockImplementation(() => {
      throw new Error("QSTASH_TOKEN is not set");
    });
    const { client, calls } = fakeSupabase([
      listRow,
      campaignRow,
      { data: [verifyRow(ORG_A)] },
    ]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{ error?: string }>(enrichTargetAccounts, {
      listId: LIST,
      campaignId: CAMPAIGN,
      organizationIds: [ORG_A],
    });

    expect(result.error).toMatch(/QStash/);
    // No stamped queue left behind that nothing will ever drain.
    expect(op(calls, "target_accounts", "update")).toBeUndefined();
    expect(h.publishJSON).not.toHaveBeenCalled();
  });

  it("stamps the per-row skip flag and publishes a payload WITHOUT skipContactFinding", async () => {
    const { client, calls } = fakeSupabase([
      listRow,
      campaignRow,
      { data: [verifyRow(ORG_A), verifyRow(ORG_B)] },
      {}, // stamp update
    ]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{
      queued: number;
      skippedNotPending: Array<Record<string, string>>;
    }>(enrichTargetAccounts, {
      listId: LIST,
      campaignId: CAMPAIGN,
      organizationIds: [ORG_A, ORG_B],
      skipContactFinding: true,
    });

    expect(result.queued).toBe(2);
    expect(result.skippedNotPending).toEqual([]);

    // The flag lands on the rows…
    const stamp = calls.find(
      (c) =>
        c.table === "target_accounts" && c.ops.some((o) => o.name === "update"),
    )!;
    const stampArgs = stamp.ops.find((o) => o.name === "update")!
      .args[0] as Record<string, unknown>;
    expect(stampArgs.skip_contact_finding).toBe(true);
    expect(stampArgs.enrich_requested_at).toEqual(expect.any(String));
    expect(stamp.ops).toContainEqual({
      name: "in",
      args: ["organization_id", [ORG_A, ORG_B]],
    });

    // …and NOT in the chain payload (exact match asserts absence): a
    // chain-level flag cross-contaminates concurrent tranches.
    expect(h.publishJSON).toHaveBeenCalledTimes(1);
    expect(h.publishJSON).toHaveBeenCalledWith({
      url: "http://localhost:3000/api/target-lists/process",
      body: { listId: LIST, campaignId: CAMPAIGN, userId: "user_1" },
    });
  });

  it("stamps only pending orgs and reports the rest as skippedNotPending", async () => {
    const { client, calls } = fakeSupabase([
      listRow,
      campaignRow,
      {
        data: [
          verifyRow(ORG_A, "pending"),
          verifyRow(ORG_B, "enriched"),
          verifyRow(ORG_C, "failed"),
        ],
      },
      {}, // stamp update (ORG_A only)
    ]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{
      queued: number;
      skippedNotPending: Array<{ organizationId: string; status: string }>;
    }>(enrichTargetAccounts, {
      listId: LIST,
      campaignId: CAMPAIGN,
      organizationIds: [ORG_A, ORG_B, ORG_C],
    });

    expect(result.queued).toBe(1);
    expect(result.skippedNotPending).toEqual([
      { organizationId: ORG_B, status: "enriched" },
      { organizationId: ORG_C, status: "failed" },
    ]);

    const stamp = calls.find(
      (c) =>
        c.table === "target_accounts" && c.ops.some((o) => o.name === "update"),
    )!;
    expect(stamp.ops).toContainEqual({
      name: "in",
      args: ["organization_id", [ORG_A]],
    });
    expect(h.publishJSON).toHaveBeenCalledTimes(1);
  });

  it("queues nothing (and skips QStash) when no org is pending", async () => {
    const { client, calls } = fakeSupabase([
      listRow,
      campaignRow,
      { data: [verifyRow(ORG_A, "enriched")] },
    ]);
    h.createClient.mockResolvedValue(client);

    const result = await run<{
      queued: number;
      skippedNotPending: Array<{ organizationId: string; status: string }>;
    }>(enrichTargetAccounts, {
      listId: LIST,
      campaignId: CAMPAIGN,
      organizationIds: [ORG_A],
    });

    expect(result.queued).toBe(0);
    expect(result.skippedNotPending).toEqual([
      { organizationId: ORG_A, status: "enriched" },
    ]);
    expect(op(calls, "target_accounts", "update")).toBeUndefined();
    expect(h.publishJSON).not.toHaveBeenCalled();
  });
});
