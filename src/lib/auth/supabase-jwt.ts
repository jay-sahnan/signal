import { SignJWT } from "jose";

/**
 * Supabase-accepted JWT for a caller that has no Clerk session (MCP OAuth).
 *
 * RLS keys every policy on requesting_user_id() = auth.jwt() ->> 'sub', which
 * for browser sessions is the Clerk user id. Signing the same sub with the
 * project's JWT secret lands the caller in exactly the same scope. `role`
 * must be `authenticated` or PostgREST maps the request to anon and every
 * policy returns zero rows (same trap as the Clerk role claim).
 */
export const SUPABASE_JWT_TTL_SECONDS = 600;
const REFRESH_SKEW_MS = 30_000;

type Cached = { token: string; expMs: number };
const cache = new Map<string, Cached>();

function secret(): Uint8Array {
  const s = process.env.SUPABASE_JWT_SECRET;
  if (!s) {
    throw new Error(
      "SUPABASE_JWT_SECRET is unset: cannot sign a Supabase token for MCP callers. " +
        "Copy it from Supabase Dashboard: Settings: API: JWT Secret.",
    );
  }
  return new TextEncoder().encode(s);
}

export async function signSupabaseJwt(userId: string): Promise<string> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expMs - now > REFRESH_SKEW_MS) return hit.token;

  const iat = Math.floor(now / 1000);
  const exp = iat + SUPABASE_JWT_TTL_SECONDS;
  const token = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(secret());

  for (const [k, v] of cache) if (v.expMs <= now) cache.delete(k);
  cache.set(userId, { token, expMs: exp * 1000 });
  return token;
}

/** Test hook. */
export function clearSupabaseJwtCache() {
  cache.clear();
}
