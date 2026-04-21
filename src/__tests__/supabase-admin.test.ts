import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getAdminClient", () => {
  const ORIG_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ORIG_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIG_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG_URL;
    if (ORIG_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIG_KEY;
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { getAdminClient } = await import("@/lib/supabase/admin");
    expect(() => getAdminClient()).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY is required/,
    );
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

    const { getAdminClient } = await import("@/lib/supabase/admin");
    expect(() => getAdminClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("returns a client when both env vars are present", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

    const { getAdminClient } = await import("@/lib/supabase/admin");
    const client = getAdminClient();
    expect(client).toBeTruthy();
    expect(typeof client.from).toBe("function");
  });
});
