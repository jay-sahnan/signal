import { describe, expect, it, vi } from "vitest";

const allSignals = [
  {
    id: "s1",
    name: "Hiring Surge",
    category: "hiring",
    description: "Company is hiring aggressively...",
    is_builtin: true,
    recipe: { query: "BIG_BLOB_THAT_SHOULD_NOT_APPEAR", params: {} },
    config: { threshold: 5, lookbackDays: 30 },
  },
];

const mockSignalsSelectOrder2 = vi
  .fn()
  .mockResolvedValue({ data: allSignals, error: null });
const mockSignalsSelectOrder1 = vi.fn(() => ({
  order: mockSignalsSelectOrder2,
}));
const mockSignalsSelect = vi.fn(() => ({ order: mockSignalsSelectOrder1 }));

const mockTogglesEq = vi.fn().mockResolvedValue({
  data: [{ signal_id: "s1", enabled: true, config_override: { threshold: 3 } }],
  error: null,
});
const mockTogglesSelect = vi.fn(() => ({ eq: mockTogglesEq }));

const mockFrom = vi.fn((table: string) => {
  if (table === "signals") return { select: mockSignalsSelect };
  if (table === "campaign_signals") return { select: mockTogglesSelect };
  throw new Error(`unexpected table ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi
    .fn()
    .mockResolvedValue({ from: (table: string) => mockFrom(table) }),
}));

import { getCampaignSignals } from "@/lib/tools/signal-tools";

describe("getCampaignSignals return shape", () => {
  it("returns thin rows without recipe/config blobs", async () => {
    const result = (await getCampaignSignals.execute!(
      { campaignId: "c1" },
      {} as never,
    )) as { signals: Array<Record<string, unknown>> };

    expect(result.signals).toHaveLength(1);
    const s = result.signals[0];
    expect(s).not.toHaveProperty("recipe");
    expect(s).not.toHaveProperty("config");
    expect(s).not.toHaveProperty("config_override");
    expect(JSON.stringify(s)).not.toContain("BIG_BLOB_THAT_SHOULD_NOT_APPEAR");
    expect(s).toMatchObject({
      id: "s1",
      name: "Hiring Surge",
      category: "hiring",
      enabled: true,
    });
  });
});
