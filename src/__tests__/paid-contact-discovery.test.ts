import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ paid: vi.fn(), hosted: true }));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid }));
import { paidContactDiscovery } from "@/lib/billing/contact-discovery";
import { NoBillableWork, CompletedWithoutCharge } from "@/lib/billing/credit-execution";
import type { ContactDiscoveryResult } from "@/lib/services/contact-discovery";
const input = { identity: { userId: "owner", source: "web" as const }, key: "11111111-1111-4111-8111-111111111111", request: { organizationId: "org" } };
const result = (extra = {}): ContactDiscoveryResult => ({
  organizationId: "org", companyName: "Acme", contacts: [], alreadyLinked: [], alreadyLinkedTotal: 0,
  searchesRun: [{ title: "engineer", query: "query", resultsFound: 0 }], sourcesSucceeded: 1,
  totalFound: 0, duplicatesSkipped: 0, verifiedCount: 0, uncertainCount: 0,
  rejectedAsWrongCompany: 0, departedCount: 0, affiliationUnchanged: 0, teamPageUnlinked: 0, ...extra,
});
beforeEach(() => { vi.clearAllMocks(); h.hosted = true; h.paid.mockImplementation(async (_input, work) => work()); });
it("reserves before discovery and passes the stable caller request", async () => {
  const work = vi.fn().mockResolvedValue(result());
  h.paid.mockRejectedValue(new Error("Insufficient credits"));
  await expect(paidContactDiscovery(input, work)).rejects.toThrow("Insufficient credits");
  expect(work).not.toHaveBeenCalled();
  expect(h.paid).toHaveBeenCalledWith({ ...input, kind: "contact.discover" }, expect.any(Function));
});
it("replays saved results without provider work", async () => {
  h.paid.mockResolvedValue(result({ totalFound: 2 }));
  const work = vi.fn();
  expect(await paidContactDiscovery(input, work)).toMatchObject({ totalFound: 2 });
  expect(work).not.toHaveBeenCalled();
});
it("marks only trusted pre-provider refusal as zero-charge work", async () => {
  h.paid.mockImplementation(async (_input, work) => {
    const outcome = await work();
    expect(outcome).toBeInstanceOf(NoBillableWork);
    return outcome.value;
  });
  expect(await paidContactDiscovery(input, async () => result({ noBillableWork: true, error: "No domain" }))).toHaveProperty("error", expect.stringContaining("new discovery request"));
});
it("does not settle a complete search failure as successful discovery", async () => {
  expect(await paidContactDiscovery(input, async () => result({ sourcesSucceeded: 0, searchesRun: [{ error: "Unavailable" }] })))
    .toBeInstanceOf(CompletedWithoutCharge);
});
it("accepts useful partial research at the configured flat rate", async () => {
  const partial = result({ contacts: [{ id: "person" }], totalFound: 1, searchesRun: [{ error: "Unavailable" }] });
  expect(await paidContactDiscovery(input, async () => partial)).toEqual(partial);
});
it("preserves self-hosted error results without billing", async () => {
  h.hosted = false;
  const failed = result({ sourcesSucceeded: 0, searchesRun: [{ error: "Unavailable" }] });
  expect(await paidContactDiscovery(input, async () => failed)).toEqual(failed);
  expect(h.paid).not.toHaveBeenCalled();
});

it("does not charge when a domain-only request has no successful source", async () => {
  expect(await paidContactDiscovery(input, async () => result({ sourcesSucceeded: 0, searchesRun: [] })))
    .toBeInstanceOf(CompletedWithoutCharge);
});
