import { afterEach, describe, expect, it, vi } from "vitest";

import { mcpConfigError } from "@/lib/mcp/config";

describe("mcpConfigError", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("names the missing secret", () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    expect(mcpConfigError()).toMatch(/SUPABASE_JWT_SECRET/);
  });
  it("is null when configured", () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "x".repeat(40));
    expect(mcpConfigError()).toBeNull();
  });
});
