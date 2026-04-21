/**
 * `fetch` with a hard deadline. Without this, a slow upstream (Apify,
 * Browserbase, Exa, AgentMail, Twitter) can hang a request path forever —
 * the outer Next.js route times out at the platform level, but the service
 * call keeps consuming connections and (for paid APIs) billing.
 *
 * Usage:
 *   fetchWithTimeout(url, init, 30_000)
 *
 * If the caller already passes `init.signal`, we respect it and skip the
 * internal controller. Default timeout is 30s — short enough to abort on
 * stuck upstreams, long enough for slow scrapes.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  if (init.signal) {
    return fetch(url, init);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
