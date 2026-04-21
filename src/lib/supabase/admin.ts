import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Supabase client that bypasses RLS. Lazily initialized on first call.
 * Use ONLY for:
 * - QStash webhook handlers (no user session)
 * - Cost tracker fire-and-forget inserts (no cookie context)
 * - E2E test setup/teardown
 * Never expose this client to the browser.
 */
export function getAdminClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is required to create the admin client.",
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required to create the admin client. " +
        "Grab it from `supabase status -o env` (local) or Project Settings → API (hosted).",
    );
  }

  _client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return _client;
}
