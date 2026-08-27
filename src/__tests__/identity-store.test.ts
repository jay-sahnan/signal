import { describe, expect, it } from "vitest";

import {
  getCurrentIdentity,
  getCurrentUserId,
  runWithIdentity,
} from "@/lib/auth/identity";

describe("identity store", () => {
  it("is empty outside a scope", () => {
    expect(getCurrentIdentity()).toBeUndefined();
  });

  it("exposes the identity inside runWithIdentity, including across awaits", async () => {
    const seen = await runWithIdentity(
      { userId: "user_a", source: "mcp" },
      async () => {
        await Promise.resolve();
        return getCurrentIdentity();
      },
    );
    expect(seen).toEqual({ userId: "user_a", source: "mcp" });
    expect(getCurrentIdentity()).toBeUndefined();
  });

  it("getCurrentUserId falls back to the provided resolver when no scope is set", async () => {
    const id = await getCurrentUserId(async () => "user_from_clerk");
    expect(id).toBe("user_from_clerk");
    const scoped = await runWithIdentity(
      { userId: "user_b", source: "mcp" },
      () => getCurrentUserId(async () => "user_from_clerk"),
    );
    expect(scoped).toBe("user_b");
  });
});
