import { z } from "zod";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSupabaseFake } from "./helpers/supabase-fake";
const h = vi.hoisted(() => ({
  paid: vi.fn(),
  existing: vi.fn(),
  holds: vi.fn(),
  recent: vi.fn(),
  search: vi.fn(),
  email: vi.fn(),
  hosted: true,
  status: "pending",
  stall: false,
  lookups: vi.fn(),
  updates: [] as unknown[],
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid, hasPaidAction: h.existing }));
vi.mock("@/lib/tools/ownership", async (original) => ({
  ...(await original<object>()),
  toolSession: async () => ({ userId: "owner", supabase: {} }),
  callerHoldsPerson: h.holds,
}));
vi.mock("@/lib/services/knowledge-base", async (original) => ({
  ...(await original<object>()),
  isRecentlyEnriched: h.recent,
  mergeEnrichmentData: async () => {},
}));
vi.mock("@/lib/services/exa-service", () => ({
  ExaService: class {
    search = h.search;
  },
}));
vi.mock("@/lib/services/enrichment-summarizer", () => ({
  summarizePerson: async () => null,
}));
vi.mock("@/lib/tools/email-tools", () => ({ findEmailForPerson: h.email }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    h.lookups();
    if (h.stall) await new Promise(() => {});
    return createSupabaseFake({
      tables: {
        people: () => [
          {
            id: "a1111111-1111-4111-8111-111111111111",
            name: "Ada",
            enrichment_status: h.status,
            affiliation_confidence: 1,
          },
        ],
        campaign_people: () => [
          { id: "33333333-3333-4333-8333-333333333333", person_id: "a1111111-1111-4111-8111-111111111111" },
          { id: "44444444-4444-4444-8444-444444444444", person_id: "a1111111-1111-4111-8111-111111111111" },
        ],
        organizations: () => [],
      },
      relations: { people: { organization: { localKey: "organization_id" } } },
      onQuery: (q) => {
        if (q.kind === "update") h.updates.push(q.payload);
      },
    });
  },
}));
import { enrichContact, enrichContacts } from "@/lib/tools/enrichment-tools";
import { getCurrentIdentity, runWithIdentity } from "@/lib/auth/identity";
const key = "22222222-2222-4222-8222-222222222222";
const call = () =>
  runWithIdentity({ userId: "owner", source: "mcp" }, () =>
    enrichContact.execute!(
      { contactId: "a1111111-1111-4111-8111-111111111111", operationId: key } as never,
      {} as never,
    ),
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.hosted = true;
  h.stall = false;
  h.status = "pending";
  h.existing.mockResolvedValue(false);
  h.updates = [];
  h.holds.mockResolvedValue(true);
  h.recent.mockResolvedValue(false);
  h.search.mockResolvedValue({ results: [] });
  h.email.mockResolvedValue({ email: null });
  h.paid.mockResolvedValue({
    contactId: "a1111111-1111-4111-8111-111111111111",
    status: "enriched",
    summary: {},
  });
});
it("reserves the contact action before provider calls or writes", async () => {
  await call();
  expect(h.paid).toHaveBeenCalledWith(
    expect.objectContaining({
      key,
      kind: "contact.enrich",
      request: { personId: "a1111111-1111-4111-8111-111111111111", linkedinUrl: null, twitterUrl: null },
    }),
    expect.any(Function),
  );
  expect(h.search).not.toHaveBeenCalled();
  expect(h.updates).toHaveLength(0);
});
it("returns recent enrichment for free", async () => {
  h.recent.mockResolvedValue(true);
  expect(await call()).toMatchObject({ skipped: true });
  expect(h.paid).not.toHaveBeenCalled();
  expect(h.search).not.toHaveBeenCalled();
});
it("rejects foreign contacts before reservation", async () => {
  h.holds.mockResolvedValue(false);
  await expect(call()).rejects.toThrow("No person found");
  expect(h.paid).not.toHaveBeenCalled();
});
it("does not start provider work when credits are refused", async () => {
  h.paid.mockRejectedValue(new Error("Insufficient credits"));
  await expect(call()).rejects.toThrow("Insufficient credits");
  expect(h.search).not.toHaveBeenCalled();
  expect(h.updates).toHaveLength(0);
});
it("runs discovery within the same reserved enrichment operation", async () => {
  h.paid.mockImplementation(async (_request, work) =>
    runWithIdentity(
      { userId: "owner", source: "mcp", operationId: "reserved" },
      work,
    ),
  );
  h.email.mockImplementation(async () => {
    expect(getCurrentIdentity()?.operationId).toBe("reserved");
    return { email: "ada@example.com" };
  });
  await call();
  expect(h.search).toHaveBeenCalledTimes(3);
  expect(h.email).toHaveBeenCalledTimes(1);
  expect(h.paid).toHaveBeenCalledTimes(1);
});
it("throws rather than settling an all-sources-failed run as success", async () => {
  h.paid.mockImplementation(async (_request, work) =>
    runWithIdentity(
      { userId: "owner", source: "mcp", operationId: "reserved" },
      work,
    ),
  );
  h.search.mockRejectedValue(new Error("Provider unavailable"));
  await expect(call()).rejects.toThrow("All enrichment sources failed");
});
it("preserves self-hosted behavior without a reservation", async () => {
  h.hosted = false;
  await call();
  expect(h.paid).not.toHaveBeenCalled();
  expect(h.search).toHaveBeenCalledTimes(3);
});
it("reuses the per-contact key when retrying a batch", async () => {
  const batch = () =>
    runWithIdentity({ userId: "owner", source: "mcp" }, () =>
      enrichContacts.execute!(
        { contactIds: ["a1111111-1111-4111-8111-111111111111"], operationId: key } as never,
        {} as never,
      ),
    );
  await batch();
  await batch();
  expect(h.paid).toHaveBeenCalledTimes(2);
  expect(h.paid.mock.calls[0][0].key).toMatch(/^[0-9a-f-]{36}$/);
  expect(h.paid.mock.calls[0][0].key).toBe(h.paid.mock.calls[1][0].key);
});

it("does not reserve if the freshness check fails", async () => {
  h.recent.mockRejectedValueOnce(new Error("Freshness unavailable"));
  await expect(call()).rejects.toThrow("Freshness unavailable");
  expect(h.paid).not.toHaveBeenCalled();
  expect(h.search).not.toHaveBeenCalled();
});

it("replays existing contact operations instead of returning cached summaries", async () => {
  h.recent.mockResolvedValue(true);
  h.existing.mockResolvedValue(true);
  h.paid.mockResolvedValue({ contactId: "a1111111-1111-4111-8111-111111111111", status: "enriched", errors: ["Original error"] });
  expect(await call()).toMatchObject({ errors: ["Original error"] });
  expect(h.paid).toHaveBeenCalledTimes(1);
});
it("cannot hide unresolved credit operations behind fresh contact data", async () => {
  h.recent.mockResolvedValue(true);
  h.existing.mockResolvedValue(true);
  h.paid.mockRejectedValue(new Error("Unresolved"));
  await expect(call()).rejects.toThrow("Unresolved");
});

it("does not label a failed contact enriched because its older timestamp is recent", async () => {
  h.status = "failed";
  h.recent.mockResolvedValue(true);
  await call();
  expect(h.paid).toHaveBeenCalledTimes(1);
});

const person = "a1111111-1111-4111-8111-111111111111";
const alias = "33333333-3333-4333-8333-333333333333";
const alias2 = "44444444-4444-4444-8444-444444444444";
const batch = (contactIds: string[]) => runWithIdentity({ userId: "owner", source: "mcp" }, () =>
  enrichContacts.execute!(
    (enrichContacts.inputSchema as z.ZodType).parse({ contactIds, operationId: key }) as never,
    {} as never,
  ),
);
it("charges once when a batch includes two links and the same person", async () => {
  expect(await batch([alias, person, alias2, person])).toMatchObject({ total: 1, succeeded: 1 });
  expect(h.paid).toHaveBeenCalledTimes(1);
  expect(h.paid.mock.calls[0][0].request.personId).toBe(person);
});
it("keeps the same paid key when a batch retry uses a different contact alias", async () => {
  await batch([alias]);
  await batch([person]);
  expect(h.paid).toHaveBeenCalledTimes(2);
  expect(h.paid.mock.calls[0][0].key).toBe(h.paid.mock.calls[1][0].key);
});
it("isolates invalid contact IDs without repeating valid aliases", async () => {
  const missing = "55555555-5555-4555-8555-555555555555";
  expect(await batch([alias, missing, person])).toMatchObject({
    total: 2, succeeded: 1, failed: 1, errors: [{ contactId: missing }],
  });
  expect(h.paid).toHaveBeenCalledTimes(1);
});

afterEach(() => vi.useRealTimers());
it("bounds stalled alias lookups before starting paid contact work", async () => {
  vi.useFakeTimers();
  h.stall = true;
  let settled = false;
  const result = Promise.resolve(batch([person])).then(value => { settled = true; return value; });
  await vi.advanceTimersByTimeAsync(5001);
  expect(settled).toBe(true);
  expect(await result).toMatchObject({ failed: 1, succeeded: 0 });
  expect(h.paid).not.toHaveBeenCalled();
});
it("defers an exhausted turn before any contact lookup", async () => {
  const result = await runWithIdentity({ userId: "owner", source: "mcp" }, () =>
    enrichContacts.execute!({ contactIds: [person], operationId: key }, {
      experimental_context: { deadlineAt: Date.now() + 100 },
    } as never),
  );
  expect(result).toMatchObject({ deferred: [person], succeeded: 0, failed: 0 });
  expect(h.lookups).not.toHaveBeenCalled();
  expect(h.paid).not.toHaveBeenCalled();
});

it("treats uppercase UUIDs and link aliases as the same contact", async () => {
  expect(await batch([person.toUpperCase(), alias])).toMatchObject({ total: 1, succeeded: 1, failed: 0 });
  expect(h.paid).toHaveBeenCalledTimes(1);
});
