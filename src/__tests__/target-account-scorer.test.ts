import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * scoreTargetAccounts is the chunked sonnet scorer behind
 * prioritizeTargetAccounts. Invariants: no accounts means no LLM call,
 * chunks of 25, the rubric/ICP stay in the trusted block (with ephemeral
 * cacheControl) while CSV-derived rows are wrapped as untrusted, usage is
 * tracked per chunk, and hallucinated organizationIds are dropped.
 */

const generateObjectMock = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: (model: string) => model }));
// llmTimeout() returns AbortSignal.timeout(...), whose pending timer outlives
// the test; the timeout is not under test here.
vi.mock("@/lib/utils/timeout", () => ({ llmTimeout: () => undefined }));

const trackUsageMock = vi.fn();
vi.mock("@/lib/services/cost-tracker", () => ({
  trackUsage: (...args: unknown[]) => trackUsageMock(...args),
  estimateClaudeCostFromUsage: () => 0.001,
}));

import { scoreTargetAccounts } from "@/lib/services/target-account-scorer";
import { MODELS } from "@/lib/ai/models";

interface CapturedCall {
  model: string;
  messages: Array<{
    role: string;
    content: string;
    providerOptions?: Record<string, unknown>;
  }>;
}

function account(i: number) {
  return {
    organizationId: `org_${i}`,
    name: `Company ${i}`,
    domain: `co${i}.example.com`,
    industry: i % 2 === 0 ? "Fintech" : null,
    location: null,
    raw: { plan: "growth" },
  };
}

const campaign = {
  id: "camp_1",
  name: "Q3 UK fintech",
  icp: { targetTitles: ["CTO", "VP Engineering"], industry: "fintech" },
  offering: { description: "API monitoring" },
};

function reply(
  scores: Array<{ organizationId: string; score: number; reason: string }>,
) {
  generateObjectMock.mockResolvedValueOnce({
    object: { scores },
    usage: { inputTokens: 100, outputTokens: 50 },
  });
}

beforeEach(() => {
  generateObjectMock.mockReset();
  trackUsageMock.mockReset();
});

describe("scoreTargetAccounts", () => {
  it("returns [] without calling the model when there are no accounts", async () => {
    const out = await scoreTargetAccounts({
      campaign,
      accounts: [],
      userId: "user_1",
    });
    expect(out).toEqual([]);
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(trackUsageMock).not.toHaveBeenCalled();
  });

  it("splits 26 accounts into 2 chunks of 25 + 1", async () => {
    reply([]);
    reply([]);

    const accounts = Array.from({ length: 26 }, (_, i) => account(i));
    await scoreTargetAccounts({ campaign, accounts, userId: "user_1" });

    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    const first = generateObjectMock.mock.calls[0][0] as CapturedCall;
    const second = generateObjectMock.mock.calls[1][0] as CapturedCall;
    const firstUser = first.messages.find((m) => m.role === "user")!.content;
    const secondUser = second.messages.find((m) => m.role === "user")!.content;
    expect(firstUser).toContain("org_24");
    expect(firstUser).not.toContain("org_25");
    expect(secondUser).toContain("org_25");
    expect(secondUser).not.toContain("org_24");
  });

  it("keeps the rubric + ICP trusted (with cacheControl) and wraps account rows as untrusted", async () => {
    reply([]);

    await scoreTargetAccounts({
      campaign,
      accounts: [account(0)],
      userId: "user_1",
    });

    const call = generateObjectMock.mock.calls[0][0] as CapturedCall;
    expect(call.model).toBe(MODELS.STRUCTURED);

    const system = call.messages.find((m) => m.role === "system")!;
    // The rubric block is cacheable across chunks.
    expect(system.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    // ICP + offering live in the trusted block, with explicit bands.
    expect(system.content).toContain("CTO");
    expect(system.content).toContain("API monitoring");
    expect(system.content).toMatch(/8-10/);
    expect(system.content).toMatch(/6-7/);
    expect(system.content).toMatch(/do not invent/i);

    const user = call.messages.find((m) => m.role === "user")!;
    expect(user.content).toContain("<untrusted>");
    const untrusted = user.content.slice(user.content.indexOf("<untrusted>"));
    expect(untrusted).toContain("Company 0");
    // The ICP never leaks into the untrusted block.
    expect(untrusted).not.toContain("VP Engineering");
  });

  it("drops hallucinated organizationIds and passes real ones through", async () => {
    reply([
      { organizationId: "org_0", score: 8, reason: "Strong fit" },
      { organizationId: "org_i_made_up", score: 10, reason: "Nope" },
    ]);

    const out = await scoreTargetAccounts({
      campaign,
      accounts: [account(0), account(1)],
      userId: "user_1",
    });

    expect(out).toEqual([
      { organizationId: "org_0", score: 8, reason: "Strong fit" },
    ]);
  });

  it("tracks usage once per chunk with campaign and user attribution", async () => {
    reply([]);
    reply([]);

    const accounts = Array.from({ length: 26 }, (_, i) => account(i));
    await scoreTargetAccounts({ campaign, accounts, userId: "user_1" });

    expect(trackUsageMock).toHaveBeenCalledTimes(2);
    for (const [entry] of trackUsageMock.mock.calls) {
      expect(entry).toMatchObject({
        service: "claude",
        operation: "prioritize-target-accounts",
        campaign_id: "camp_1",
        user_id: "user_1",
      });
      expect(entry.estimated_cost_usd).toBeGreaterThan(0);
    }
  });
});
