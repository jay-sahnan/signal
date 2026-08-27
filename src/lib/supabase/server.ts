import { auth } from "@clerk/nextjs/server";
import { createServerClient } from "@supabase/ssr";

import { getCurrentIdentity } from "@/lib/auth/identity";
import { signSupabaseJwt } from "@/lib/auth/supabase-jwt";
import { withTimeout } from "@/lib/utils/timeout";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

let warnedKeyless = false;
function warnIfKeyless() {
  if (warnedKeyless) return;
  if (process.env.CLERK_FRONTEND_API_DOMAIN) return;
  if (process.env.NODE_ENV === "production") {
    // In production a missing domain means RLS-backed queries always return
    // empty. Surface this as a hard log so it shows up in deploy logs.
    warnedKeyless = true;
    console.error(
      "FATAL: CLERK_FRONTEND_API_DOMAIN is unset in production. " +
        "Supabase third-party auth is disabled and every RLS-protected " +
        "query will return zero rows. Configure Clerk → Supabase before " +
        "serving traffic.",
    );
    return;
  }
  warnedKeyless = true;
  console.warn(
    "\n⚠ Clerk Keyless mode detected\n" +
      "  Supabase third-party auth is disabled because CLERK_FRONTEND_API_DOMAIN\n" +
      "  is not set. All RLS-protected queries will return empty rows.\n" +
      "  Fix: rerun `pnpm setup` (option [2]) or paste the domain into .env.local.\n" +
      "  See: https://clerk.com/setup/supabase\n",
  );
}

// ── Token freshness ────────────────────────────────────────────────────────
// Clerk's server-side getToken() with no options does NOT mint anything: it
// returns the JWT that arrived on the request, verbatim, forever (see
// createGetToken in @clerk/backend). Those tokens live ~60s, but our routes
// run much longer — maxDuration is 300s on /api/chat and on
// /api/find-email/bulk, and one chat turn can take dozens of tool steps. So any
// Supabase call made past the ~60s mark used to fail with "JWT expired", and
// stayed broken for the rest of the request, retries included.
//
// Passing expiresInSeconds takes Clerk's other branch, which mints a fresh
// token through the Backend API. We only do that once the request's own token
// is spent, so short requests behave exactly as before, with no extra calls.

/**
 * Doesn't need to outlive the longest route: the provider re-mints whenever
 * the cached token is within REFRESH_SKEW_MS of expiry, so a request longer
 * than the TTL just mints again mid-flight.
 */
const MINTED_TOKEN_TTL_SECONDS = 600;
/**
 * Minting goes over the network to api.clerk.com, and every concurrent query
 * in the session awaits the same in-flight mint. Without a bound, one stalled
 * connection (undici waits ~5min for headers) freezes every DB call behind a
 * single promise. Fail fast instead — the error surfaces as a normal query
 * failure and the next call starts a fresh mint.
 */
const MINT_TIMEOUT_MS = 15_000;
/** Treat a token expiring within this window as already spent. */
const REFRESH_SKEW_MS = 30_000;

type CachedToken = { token: string; expMs: number };

// Keyed by Clerk session id, so concurrent tool calls in one request — and
// back-to-back requests from the same session — share a single mint.
const tokenCache = new Map<string, CachedToken>();
const inFlightMints = new Map<string, Promise<string | null>>();

/**
 * `exp` in ms from a JWT, or null when it can't be read. No signature check —
 * Supabase verifies the token; we only need to know when to replace it.
 */
function jwtExpMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const { exp } = JSON.parse(json) as { exp?: number };
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function hasLifeLeft(token: string | null | undefined): token is string {
  if (!token) return false;
  const expMs = jwtExpMs(token);
  // Unreadable exp: replace it with one we can reason about.
  if (expMs === null) return false;
  return expMs - Date.now() > REFRESH_SKEW_MS;
}

let warnedMissingRole = false;
/**
 * A minted token inherits the instance's session token claims, so it should
 * carry the custom `role: authenticated` claim the Supabase integration needs.
 * If it ever doesn't, Supabase maps the request to `anon` and RLS returns zero
 * rows instead of erroring — so say so loudly rather than silently read empty.
 */
function warnIfRoleClaimMissing(token: string) {
  if (warnedMissingRole) return;
  const payload = token.split(".")[1];
  if (!payload) return;
  try {
    const { role } = JSON.parse(
      Buffer.from(
        payload.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    ) as { role?: string };
    if (role === "authenticated") return;
    warnedMissingRole = true;
    console.error(
      "FATAL: Clerk-minted session token has no `role: authenticated` claim " +
        `(got ${JSON.stringify(role)}). Supabase will treat these requests as ` +
        "anon and every RLS-protected query will return zero rows. Add the " +
        "claim to the session token in Clerk → Sessions → Customize token.",
    );
  } catch {
    // Unparseable payload is already handled by the exp fallback.
  }
}

function cacheToken(sessionId: string, token: string) {
  warnIfRoleClaimMissing(token);
  const now = Date.now();
  for (const [key, entry] of tokenCache) {
    if (entry.expMs <= now) tokenCache.delete(key);
  }
  tokenCache.set(sessionId, {
    token,
    expMs: jwtExpMs(token) ?? now + MINTED_TOKEN_TTL_SECONDS * 1000,
  });
}

type GetToken = (options?: {
  expiresInSeconds?: number;
}) => Promise<string | null>;

/**
 * Returns a getter for a token that is still valid right now, minting a
 * longer-lived one via Clerk's Backend API when the request's own token has
 * run out. `force` discards what we have and mints unconditionally.
 */
function createTokenProvider(getToken: GetToken, sessionId: string | null) {
  const mint = (): Promise<string | null> => {
    // No session id means no session to mint against (signed out, or a
    // machine token) — hand back whatever getToken gives us.
    if (!sessionId) return getToken();

    const pending = inFlightMints.get(sessionId);
    if (pending) return pending;

    const mintPromise = withTimeout(
      getToken({ expiresInSeconds: MINTED_TOKEN_TTL_SECONDS }),
      MINT_TIMEOUT_MS,
      "Clerk session token mint",
    )
      .then((token) => {
        if (token) cacheToken(sessionId, token);
        return token;
      })
      .finally(() => inFlightMints.delete(sessionId));

    inFlightMints.set(sessionId, mintPromise);
    return mintPromise;
  };

  return async ({ force = false } = {}): Promise<string | null> => {
    if (force) {
      if (sessionId) tokenCache.delete(sessionId);
      return mint();
    }
    const cached = sessionId ? tokenCache.get(sessionId) : undefined;
    if (cached && cached.expMs - Date.now() > REFRESH_SKEW_MS) {
      return cached.token;
    }
    const incoming = await getToken();
    if (hasLifeLeft(incoming)) return incoming;
    return mint();
  };
}

// Verified against local PostgREST: an expired JWT gets 401
// {"code":"PGRST303","message":"JWT expired"}. Older PostgREST used PGRST301;
// match both codes plus the message so a version bump can't unhook the retry.
const JWT_REJECTED = /jwt expired|PGRST30[13]/i;

/** True when a 401 is specifically "your token is past its exp". */
async function isExpiredTokenResponse(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    // Clone so the caller still receives an unread body.
    return JWT_REJECTED.test(await res.clone().text());
  } catch {
    return false;
  }
}

/** A request can only be replayed if its body can be sent a second time. */
function isReplayable(
  input: RequestInfo | URL,
  body: BodyInit | null,
): boolean {
  if (
    typeof Request !== "undefined" &&
    input instanceof Request &&
    input.body
  ) {
    return false;
  }
  if (body == null) return true;
  if (typeof body === "string") return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  if (body instanceof URLSearchParams) return true;
  return false; // streams, FormData — a half-consumed replay is worse than the 401
}

export const createClient = async () => {
  warnIfKeyless();
  const injected = getCurrentIdentity();
  const freshToken = injected
    ? // Session-less caller: the app signs its own token. The provider still
      // handles expiry so a long MCP tool call re-signs mid-flight.
      createTokenProvider(() => signSupabaseJwt(injected.userId), null)
    : await (async () => {
        const { getToken, sessionId } = await auth();
        return createTokenProvider(getToken, sessionId);
      })();

  return createServerClient(supabaseUrl!, supabaseKey!, {
    // @supabase/ssr requires a cookies adapter even though Clerk-issued JWTs
    // arrive via Authorization header, not Supabase cookies. No-op is safe.
    cookies: { getAll: () => [], setAll: () => {} },
    global: {
      fetch: async (input, init = {}) => {
        const send = async (token: string | null) => {
          const headers = new Headers(init.headers);
          if (token) headers.set("Authorization", `Bearer ${token}`);
          return fetch(input, { ...init, headers });
        };

        const res = await send(await freshToken());
        if (!isReplayable(input, init.body ?? null)) return res;
        if (!(await isExpiredTokenResponse(res))) return res;

        // The token was rejected anyway — clock skew, or an exp we misread.
        // Mint and replay exactly once, so a genuinely unauthorized request
        // still surfaces its 401 instead of looping.
        const retryToken = await freshToken({ force: true });
        if (!retryToken) return res;
        return send(retryToken);
      },
    },
  });
};

/**
 * Returns the Supabase client and current user for route handlers.
 * Returns null if not authenticated. Errors from auth() (e.g. called outside
 * request scope) propagate — those are real bugs, not "you're logged out."
 */
export async function getSupabaseAndUser(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email: string };
} | null> {
  const injected = getCurrentIdentity();
  if (injected) {
    const supabase = await createClient();
    return { supabase, user: { id: injected.userId, email: "" } };
  }
  // `isAuthenticated` is the modern Clerk idiom (replaces `!!userId`). Keep
  // the `userId` null-check too so TypeScript narrows the return type.
  const { isAuthenticated, userId, sessionClaims } = await auth();
  if (!isAuthenticated || !userId) return null;
  const supabase = await createClient();
  const email =
    (sessionClaims as { email?: string } | null | undefined)?.email ?? "";
  return { supabase, user: { id: userId, email } };
}
