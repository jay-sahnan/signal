// @vitest-environment node
//
// Integration test against a real Supabase (local by default). Proves that an
// app-signed identity (the MCP path, no Clerk session) lands in exactly the
// same RLS scope as a browser session: user A sees A's rows, user B sees none.
//
// Runs only when SUPABASE_JWT_SECRET and a Supabase URL are present, so CI
// without Supabase stays green. Locally:
//
//   supabase start
//   eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|JWT_SECRET)=')"
//   NEXT_PUBLIC_SUPABASE_URL=$API_URL \
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=$ANON_KEY \
//   SUPABASE_JWT_SECRET=$JWT_SECRET \
//   pnpm vitest run src/__tests__/mcp-rls-isolation.integration.test.ts
import { afterAll, describe, expect, it } from "vitest";

import { runWithIdentity } from "@/lib/auth/identity";
import { getSupabaseAndUser } from "@/lib/supabase/server";

const enabled =
  !!process.env.SUPABASE_JWT_SECRET &&
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

const USER_A = "user_mcp_isolation_a";
const USER_B = "user_mcp_isolation_b";
const PROBE_NAME = "mcp isolation probe";

describe.runIf(enabled)("MCP identity is RLS-scoped", () => {
  afterAll(async () => {
    // Best-effort cleanup as the owner; RLS only lets A delete A's rows.
    const asA = await runWithIdentity({ userId: USER_A, source: "mcp" }, () =>
      getSupabaseAndUser(),
    );
    await asA?.supabase.from("campaigns").delete().eq("name", PROBE_NAME);
  });

  it("user A sees only A's campaigns; user B sees none of them", async () => {
    const asA = await runWithIdentity({ userId: USER_A, source: "mcp" }, () =>
      getSupabaseAndUser(),
    );
    const asB = await runWithIdentity({ userId: USER_B, source: "mcp" }, () =>
      getSupabaseAndUser(),
    );
    expect(asA?.user.id).toBe(USER_A);
    expect(asB?.user.id).toBe(USER_B);

    // campaigns NOT NULL columns without defaults: name (user_id is nullable
    // in the schema but the insert policy requires it to equal the caller).
    const { error: insErr } = await asA!.supabase
      .from("campaigns")
      .insert({ user_id: USER_A, name: PROBE_NAME });
    expect(insErr).toBeNull();

    const a = await asA!.supabase.from("campaigns").select("id,user_id");
    const b = await asB!.supabase.from("campaigns").select("id,user_id");
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.data!.length).toBeGreaterThan(0);
    expect(a.data!.every((r) => r.user_id === USER_A)).toBe(true);
    expect(b.data).toEqual([]);

    // B cannot forge a row as A: the insert policy checks sub = user_id.
    const forged = await asB!.supabase
      .from("campaigns")
      .insert({ user_id: USER_A, name: PROBE_NAME });
    expect(forged.error).not.toBeNull();

    // B cannot delete A's row either (RLS filters it to zero rows, no error).
    await asB!.supabase.from("campaigns").delete().eq("name", PROBE_NAME);
    const still = await asA!.supabase
      .from("campaigns")
      .select("id")
      .eq("name", PROBE_NAME);
    expect(still.data!.length).toBeGreaterThan(0);
  });
});
