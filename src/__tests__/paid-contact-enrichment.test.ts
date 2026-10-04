import { beforeEach, expect, it, vi } from "vitest";
import { createSupabaseFake } from "./helpers/supabase-fake";
const h = vi.hoisted(() => ({
  paid: vi.fn(),
  holds: vi.fn(),
  recent: vi.fn(),
  search: vi.fn(),
  email: vi.fn(),
  hosted: true,
  updates: [] as unknown[],
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid }));
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
  createClient: async () =>
    createSupabaseFake({
      tables: {
        people: () => [
          {
            id: "person",
            name: "Ada",
            enrichment_status: "pending",
            affiliation_confidence: 1,
          },
        ],
        organizations: () => [],
      },
      relations: { people: { organization: { localKey: "organization_id" } } },
      onQuery: (q) => {
        if (q.kind === "update") h.updates.push(q.payload);
      },
    }),
}));
import { enrichContact, enrichContacts } from "@/lib/tools/enrichment-tools";
import { getCurrentIdentity, runWithIdentity } from "@/lib/auth/identity";
const key = "22222222-2222-4222-8222-222222222222";
const call = () =>
  runWithIdentity({ userId: "owner", source: "mcp" }, () =>
    enrichContact.execute!(
      { contactId: "person", operationId: key } as never,
      {} as never,
    ),
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.hosted = true;
  h.updates = [];
  h.holds.mockResolvedValue(true);
  h.recent.mockResolvedValue(false);
  h.search.mockResolvedValue({ results: [] });
  h.email.mockResolvedValue({ email: null });
  h.paid.mockResolvedValue({
    contactId: "person",
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
      request: { personId: "person", linkedinUrl: null, twitterUrl: null },
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
        { contactIds: ["person"], operationId: key } as never,
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
