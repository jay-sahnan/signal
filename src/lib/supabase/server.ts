import { auth } from "@clerk/nextjs/server";
import { createServerClient } from "@supabase/ssr";

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

export const createClient = async () => {
  warnIfKeyless();
  const { getToken } = await auth();

  return createServerClient(supabaseUrl!, supabaseKey!, {
    // @supabase/ssr requires a cookies adapter even though Clerk-issued JWTs
    // arrive via Authorization header, not Supabase cookies. No-op is safe.
    cookies: { getAll: () => [], setAll: () => {} },
    global: {
      fetch: async (input, init = {}) => {
        const token = await getToken();
        const headers = new Headers(init.headers);
        if (token) headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
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
  // `isAuthenticated` is the modern Clerk idiom (replaces `!!userId`). Keep
  // the `userId` null-check too so TypeScript narrows the return type.
  const { isAuthenticated, userId, sessionClaims } = await auth();
  if (!isAuthenticated || !userId) return null;
  const supabase = await createClient();
  const email =
    (sessionClaims as { email?: string } | null | undefined)?.email ?? "";
  return { supabase, user: { id: userId, email } };
}
