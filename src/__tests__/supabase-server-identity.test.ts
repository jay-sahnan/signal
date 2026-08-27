import { beforeEach, describe, expect, it, vi } from "vitest";

type FetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  // One entry per createServerClient call, in order.
  fetches: [] as FetchImpl[],
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { global: { fetch: FetchImpl } },
  ) => {
    h.fetches.push(options.global.fetch);
    return {};
  },
}));
vi.mock("@/lib/auth/supabase-jwt", () => ({
  signSupabaseJwt: vi.fn(async (id: string) => `signed-for-${id}`),
}));

import { runWithIdentity } from "@/lib/auth/identity";
import { signSupabaseJwt } from "@/lib/auth/supabase-jwt";
import { getSupabaseAndUser } from "@/lib/supabase/server";

async function tokenSent(fetchImpl: FetchImpl) {
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}"));
  await fetchImpl("https://db/rest/v1/x", { method: "GET" });
  const init = spy.mock.calls[0][1] as RequestInit;
  spy.mockRestore();
  return new Headers(init.headers).get("authorization");
}

describe("getSupabaseAndUser with an injected identity", () => {
  beforeEach(() => {
    h.fetches.length = 0;
    h.auth.mockReset();
    vi.mocked(signSupabaseJwt).mockClear();
  });

  it("uses the injected user and a signed token, never touching Clerk", async () => {
    const ctx = await runWithIdentity(
      { userId: "user_mcp", source: "mcp" },
      () => getSupabaseAndUser(),
    );
    expect(ctx?.user).toEqual({ id: "user_mcp", email: "" });
    expect(h.auth).not.toHaveBeenCalled();
    expect(await tokenSent(h.fetches[0])).toBe("Bearer signed-for-user_mcp");
    expect(signSupabaseJwt).toHaveBeenCalledWith("user_mcp");
  });

  it("falls back to Clerk when no identity is injected", async () => {
    h.auth.mockResolvedValue({
      isAuthenticated: true,
      userId: "user_cookie",
      sessionId: "sess_1",
      sessionClaims: { email: "a@b.c" },
      getToken: async () => null,
    });
    const ctx = await getSupabaseAndUser();
    expect(ctx?.user).toEqual({ id: "user_cookie", email: "a@b.c" });
    // Once for the user, once inside createClient for the token getter.
    expect(h.auth).toHaveBeenCalled();
    expect(signSupabaseJwt).not.toHaveBeenCalled();
  });

  it("returns null for a signed-out cookie caller", async () => {
    h.auth.mockResolvedValue({
      isAuthenticated: false,
      userId: null,
      sessionId: null,
      sessionClaims: null,
      getToken: async () => null,
    });
    expect(await getSupabaseAndUser()).toBeNull();
    expect(h.fetches).toHaveLength(0);
  });
});
