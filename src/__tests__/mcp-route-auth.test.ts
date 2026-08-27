// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ auth: vi.fn(), verify: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth }));
vi.mock("@clerk/mcp-tools/next", () => ({ verifyClerkToken: h.verify }));

import { verifyMcpBearer } from "@/lib/mcp/auth";

describe("verifyMcpBearer", () => {
  it("returns auth info with the Clerk user id for a valid OAuth token", async () => {
    h.auth.mockResolvedValue({ userId: "user_1" });
    h.verify.mockResolvedValue({
      token: "t",
      clientId: "c",
      scopes: [],
      extra: { userId: "user_1" },
    });
    const info = await verifyMcpBearer("t");
    expect(h.auth).toHaveBeenCalledWith({ acceptsToken: "oauth_token" });
    expect(info?.extra?.userId).toBe("user_1");
  });

  it("returns undefined when Clerk rejects the token", async () => {
    h.auth.mockResolvedValue({ userId: null });
    h.verify.mockResolvedValue(undefined);
    expect(await verifyMcpBearer("bad")).toBeUndefined();
  });
});
