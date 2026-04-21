import { describe, expect, it, vi } from "vitest";

const rows = [
  {
    id: "s1",
    name: "Hiring Surge",
    category: "hiring",
    description: "short",
    is_builtin: true,
    recipe: { query: "BIG_RECIPE_BLOB" },
    config: { threshold: 5 },
  },
];

const mockOrder2 = vi.fn().mockResolvedValue({ data: rows, error: null });
const mockOrder1 = vi.fn(() => ({ order: mockOrder2 }));
const mockSelect = vi.fn(() => ({ order: mockOrder1 }));
const mockFrom = vi.fn((_table?: string) => ({ select: mockSelect }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi
    .fn()
    .mockResolvedValue({ from: (table: string) => mockFrom(table) }),
}));

import { getSignals } from "@/lib/tools/signal-tools";

describe("getSignals return shape", () => {
  it("omits recipe/config and truncates description", async () => {
    const result = (await getSignals.execute!({}, {} as never)) as {
      signals: Array<Record<string, unknown>>;
    };
    const s = result.signals[0];
    expect(s).not.toHaveProperty("recipe");
    expect(s).not.toHaveProperty("config");
    expect(JSON.stringify(s)).not.toContain("BIG_RECIPE_BLOB");
    expect(s).toMatchObject({
      id: "s1",
      name: "Hiring Surge",
      category: "hiring",
      is_builtin: true,
    });
  });
});
