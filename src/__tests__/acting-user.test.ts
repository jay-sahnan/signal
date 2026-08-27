import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth }));

import { actingUserId } from "@/lib/auth/acting-user";
import { runWithIdentity } from "@/lib/auth/identity";

describe("actingUserId", () => {
  it("prefers the injected identity", async () => {
    const id = await runWithIdentity(
      { userId: "user_mcp", source: "mcp" },
      () => actingUserId(),
    );
    expect(id).toBe("user_mcp");
    expect(h.auth).not.toHaveBeenCalled();
  });
  it("falls back to Clerk", async () => {
    h.auth.mockResolvedValue({ userId: "user_cookie" });
    expect(await actingUserId()).toBe("user_cookie");
  });
});
