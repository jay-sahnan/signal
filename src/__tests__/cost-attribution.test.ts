import { beforeEach, describe, expect, it, vi } from "vitest";

const { insertMock } = vi.hoisted(() => ({ insertMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({ insert: insertMock }),
  }),
}));

import { runWithIdentity } from "@/lib/auth/identity";
import { trackUsage, withAction } from "@/lib/services/cost-tracker";

/** trackUsage is fire-and-forget, so let its microtask run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  insertMock.mockReset();
  insertMock.mockResolvedValue({ error: null });
});

/**
 * Spend has to be attributable to the person who incurred it.
 *
 * Only 3 of roughly 30 trackUsage call sites ever passed a user_id, so Exa,
 * Apify, Browserbase, Hunter, Google Places and every Claude service call
 * wrote NULL. The rows land -- the writer is the admin client -- but the cost
 * page reads them under `requesting_user_id() = user_id`, and NULL is never
 * equal to a user, so a run that really cost $12 displayed $0.00.
 *
 * Carrying the id on the action context fixes every one of those call sites at
 * once, which is why the assertion below is about a *bare* trackUsage call.
 */
describe("cost attribution", () => {
  it("attributes a bare trackUsage call to the action's user", async () => {
    await withAction(
      "Enrich company: Acme",
      async () => {
        trackUsage({
          service: "exa",
          operation: "search",
          estimated_cost_usd: 0.005,
        });
      },
      "user_abc",
    );
    await settle();

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      service: "exa",
      user_id: "user_abc",
    });
  });

  it("lets an explicit user_id win over the action's", async () => {
    await withAction(
      "Job run",
      async () => {
        trackUsage({
          service: "claude",
          operation: "compose",
          estimated_cost_usd: 0.01,
          user_id: "user_explicit",
        });
      },
      "user_context",
    );
    await settle();

    expect(insertMock.mock.calls[0][0].user_id).toBe("user_explicit");
  });

  it("records null rather than guessing when nobody owns the action", async () => {
    await withAction("Unattributed sweep", async () => {
      trackUsage({
        service: "browserbase",
        operation: "session",
        estimated_cost_usd: 0.1,
      });
    });
    await settle();

    expect(insertMock.mock.calls[0][0].user_id).toBeNull();
  });

  it("stamps metadata.source = mcp when running under an MCP identity", async () => {
    await runWithIdentity({ userId: "user_mcp", source: "mcp" }, async () => {
      trackUsage({
        service: "exa",
        operation: "search",
        estimated_cost_usd: 0.01,
      });
      await settle();
    });

    expect(insertMock.mock.calls[0][0].metadata).toMatchObject({
      source: "mcp",
    });
  });

  it("stamps metadata.source = web outside any injected identity", async () => {
    trackUsage({
      service: "exa",
      operation: "search",
      estimated_cost_usd: 0.01,
    });
    await settle();

    expect(insertMock.mock.calls[0][0].metadata).toMatchObject({
      source: "web",
    });
  });
});
