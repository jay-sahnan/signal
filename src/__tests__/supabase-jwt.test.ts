// @vitest-environment node
import { jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-secret-at-least-32-characters-long!!";

describe("signSupabaseJwt", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_JWT_SECRET", SECRET);
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("signs sub and role: authenticated with a 10 minute expiry", async () => {
    const { signSupabaseJwt } = await import("@/lib/auth/supabase-jwt");
    const token = await signSupabaseJwt("user_abc");
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(SECRET),
    );
    expect(payload.sub).toBe("user_abc");
    expect(payload.role).toBe("authenticated");
    expect(payload.exp! - payload.iat!).toBe(600);
  });

  it("reuses a cached token for the same user while it has life left", async () => {
    const { signSupabaseJwt } = await import("@/lib/auth/supabase-jwt");
    const a = await signSupabaseJwt("user_abc");
    const b = await signSupabaseJwt("user_abc");
    expect(b).toBe(a);
    const c = await signSupabaseJwt("user_other");
    expect(c).not.toBe(a);
  });

  it("throws a clear error when the secret is unset", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    const { signSupabaseJwt } = await import("@/lib/auth/supabase-jwt");
    await expect(signSupabaseJwt("user_abc")).rejects.toThrow(
      /SUPABASE_JWT_SECRET/,
    );
  });
});
