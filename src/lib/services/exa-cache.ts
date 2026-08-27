import { createHash } from "node:crypto";

import { getAdminClient } from "@/lib/supabase/admin";

import type { ExaSearchOptions, ExaSearchResponse } from "./exa-service";

/**
 * Shared cache for Exa responses (table exa_search_cache).
 *
 * Fails open at every step: a missing table (migration not pushed yet), a
 * network error or a malformed row all mean "no cache", never "no search".
 * People change jobs, so the TTL is short; findEmail's revalidate path and
 * anything else that must see fresh data passes `bypassCache`.
 */
export const EXA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normaliseQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

export function exaCacheKey(query: string, options: ExaSearchOptions): string {
  const canonical = JSON.stringify({
    q: normaliseQuery(query),
    n: options.numResults ?? 10,
    t: options.searchType ?? "auto",
    c: options.category ?? null,
    x: options.includeText ?? false,
    d: [...(options.includeDomains ?? [])].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function readExaCache(
  key: string,
  now: number = Date.now(),
): Promise<ExaSearchResponse | null> {
  try {
    const { data, error } = await getAdminClient()
      .from("exa_search_cache")
      .select("response, created_at")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    const age = now - new Date(data.created_at as string).getTime();
    if (!Number.isFinite(age) || age > EXA_CACHE_TTL_MS) return null;
    const response = data.response as ExaSearchResponse;
    if (!response || !Array.isArray(response.results)) return null;
    return response;
  } catch {
    return null;
  }
}

export async function writeExaCache(
  key: string,
  query: string,
  options: ExaSearchOptions,
  response: ExaSearchResponse,
): Promise<void> {
  try {
    await getAdminClient()
      .from("exa_search_cache")
      .upsert(
        {
          key,
          query,
          options: options as Record<string, unknown>,
          response: response as unknown as Record<string, unknown>,
          created_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
  } catch {
    // Cache write failures are invisible by design.
  }
}
