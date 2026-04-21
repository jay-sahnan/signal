import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSingle = vi.fn();
const mockEq = vi.fn(() => ({ single: mockSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn((_table?: string) => ({ select: mockSelect }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi
    .fn()
    .mockResolvedValue({ from: (table: string) => mockFrom(table) }),
}));

import { getSignalDetail } from "@/lib/tools/signal-tools";

describe("getSignalDetail", () => {
  beforeEach(() => mockSingle.mockReset());

  it("returns full signal with recipe and config", async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: "s1",
        name: "Hiring Surge",
        category: "hiring",
        description: "long description here",
        recipe: { query: "FULL_RECIPE_CONTENT" },
        config: { threshold: 5 },
      },
      error: null,
    });
    const result = await getSignalDetail.execute!(
      { signalId: "s1" },
      {} as never,
    );
    expect(result).toMatchObject({
      id: "s1",
      recipe: { query: "FULL_RECIPE_CONTENT" },
      config: { threshold: 5 },
    });
  });

  it("returns error on missing signal", async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "gone" },
    });
    const result = await getSignalDetail.execute!(
      { signalId: "x" },
      {} as never,
    );
    expect(result).toEqual({ error: expect.stringContaining("gone") });
  });
});
