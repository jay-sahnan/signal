/**
 * Fetches actual billed spend from provider APIs. Returns null on any failure
 * so the UI can fall back to local estimates with an "(est)" tag.
 *
 * Anthropic uses the Admin API (cost_report). Requires ANTHROPIC_ADMIN_KEY
 * (distinct from ANTHROPIC_API_KEY -- must start with sk-ant-admin...).
 *
 * Apify uses the monthly usage endpoint. Cycles are monthly, so periods that
 * cross cycle boundaries require multiple requests.
 *
 * Exa uses the team-management usage endpoint. Requires EXA_SERVICE_API_KEY
 * and EXA_API_KEY_ID (the UUID of the search key whose usage we want).
 *
 * Browserbase has no billed-spend endpoint that reliably reports non-zero,
 * so we sum completed session durations × our local per-hour rate.
 */

import { PRICING } from "@/lib/services/cost-tracker";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

async function fetchAnthropicSpend(
  startIso: string,
  endIso: string,
): Promise<number | null> {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) return null;

  // Use 1h buckets for short windows so a 24h request doesn't collapse into
  // a single partial day bucket; fall back to 1d for 7d/30d so payloads stay small.
  const windowMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  const bucketWidth = windowMs <= 36 * 3_600_000 ? "1h" : "1d";

  try {
    let total = 0;
    let page: string | undefined;
    do {
      const url = new URL(
        "https://api.anthropic.com/v1/organizations/cost_report",
      );
      url.searchParams.set("starting_at", startIso);
      url.searchParams.set("ending_at", endIso);
      url.searchParams.set("bucket_width", bucketWidth);
      url.searchParams.set("limit", "365");
      if (page) url.searchParams.set("page", page);

      const res = await fetchWithTimeout(
        url.toString(),
        {
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
        },
        30_000,
      );
      if (!res.ok) {
        console.error(
          `[real-spend] anthropic ${res.status}:`,
          await res.text().catch(() => ""),
        );
        return null;
      }
      const json = (await res.json()) as {
        data?: Array<{ results?: Array<{ amount?: string }> }>;
        has_more?: boolean;
        next_page?: string;
      };
      for (const bucket of json.data ?? []) {
        for (const item of bucket.results ?? []) {
          total += Number(item.amount ?? 0) / 100;
        }
      }
      page = json.has_more ? json.next_page : undefined;
    } while (page);

    return total;
  } catch (err) {
    console.error("[real-spend] anthropic error:", err);
    return null;
  }
}

interface ApifyMonthlyResponse {
  data?: {
    usageCycle?: { startAt: string; endAt: string };
    dailyServiceUsages?: Array<{
      date: string;
      totalUsageCreditsUsd?: number;
    }>;
    totalUsageCreditsUsdAfterVolumeDiscount?: number;
  };
}

async function fetchApifySpend(startIso: string): Promise<number | null> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) return null;

  const start = new Date(startIso);
  let total = 0;
  let cursor = new Date();
  // Cap at 13 months to prevent runaway loops on "all" period.
  for (let i = 0; i < 13; i++) {
    const dateParam = cursor.toISOString().slice(0, 10);
    try {
      const res = await fetchWithTimeout(
        `https://api.apify.com/v2/users/me/usage/monthly?date=${dateParam}`,
        { headers: { Authorization: `Bearer ${token}` } },
        30_000,
      );
      if (!res.ok) {
        console.error(
          `[real-spend] apify ${res.status}:`,
          await res.text().catch(() => ""),
        );
        return null;
      }
      const json = (await res.json()) as ApifyMonthlyResponse;
      const daily = json.data?.dailyServiceUsages ?? [];
      for (const day of daily) {
        const d = new Date(day.date);
        if (d >= start) total += Number(day.totalUsageCreditsUsd ?? 0);
      }

      const cycleStartIso = json.data?.usageCycle?.startAt;
      if (!cycleStartIso) break;
      const cycleStart = new Date(cycleStartIso);
      if (cycleStart <= start) break;
      // Step into the previous cycle.
      cursor = new Date(cycleStart.getTime() - 1);
    } catch (err) {
      console.error("[real-spend] apify error:", err);
      return null;
    }
  }

  return total;
}

async function fetchExaSpend(
  startIso: string,
  endIso: string,
): Promise<number | null> {
  const key = process.env.EXA_SERVICE_API_KEY;
  const keyId = process.env.EXA_API_KEY_ID;
  if (!key || !keyId) return null;

  // Exa caps lookback at 180 days. Clamp if the caller asked for more.
  const earliest = new Date(Date.now() - 180 * 86400000);
  const start = new Date(startIso);
  const startClamped = (start < earliest ? earliest : start).toISOString();

  try {
    const url = new URL(
      `https://admin-api.exa.ai/team-management/api-keys/${keyId}/usage`,
    );
    url.searchParams.set("start_date", startClamped);
    url.searchParams.set("end_date", endIso);

    const res = await fetchWithTimeout(
      url.toString(),
      { headers: { "x-api-key": key } },
      30_000,
    );
    if (!res.ok) {
      console.error(
        `[real-spend] exa ${res.status}:`,
        await res.text().catch(() => ""),
      );
      return null;
    }
    const json = (await res.json()) as { total_cost_usd?: number | string };
    // Distinguish "missing field" (parser/API change -- show est) from
    // "real value is 0" (genuinely no spend). A missing field returning $0
    // would be displayed as authoritative zero spend, which is misleading.
    if (json.total_cost_usd == null) {
      console.error("[real-spend] exa response missing total_cost_usd:", json);
      return null;
    }
    const total = Number(json.total_cost_usd);
    return Number.isFinite(total) ? total : null;
  } catch (err) {
    console.error("[real-spend] exa error:", err);
    return null;
  }
}

async function fetchBrowserbaseSpend(
  startIso: string,
  endIso: string,
): Promise<number | null> {
  const key = process.env.BROWSERBASE_API_KEY;
  if (!key) return null;

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();

  try {
    const res = await fetchWithTimeout(
      "https://api.browserbase.com/v1/sessions?status=COMPLETED",
      { headers: { "X-BB-API-Key": key } },
      30_000,
    );
    if (!res.ok) {
      console.error(
        `[real-spend] browserbase ${res.status}:`,
        await res.text().catch(() => ""),
      );
      return null;
    }
    const sessions = (await res.json()) as Array<{
      startedAt?: string;
      endedAt?: string;
    }>;

    // Browserbase returns all completed sessions in one response (no
    // pagination endpoint) sorted newest-first. We bail as soon as endedAt
    // drops below startMs so a 24h window doesn't walk through 6 months of
    // history. Defensive: if a session is out of order, we skip it rather
    // than terminating (break would undercount in that rare case).
    let totalHours = 0;
    let sawAnyInWindow = false;
    for (const s of sessions) {
      if (!s.startedAt || !s.endedAt) continue;
      const endedMs = new Date(s.endedAt).getTime();
      if (!Number.isFinite(endedMs)) continue;
      if (endedMs < startMs) {
        // Newest-first ordering -- once we drop below startMs AND we've seen
        // at least one in-window session, later entries are older and
        // irrelevant. Bail early.
        if (sawAnyInWindow) break;
        continue;
      }
      if (endedMs > endMs) continue;
      const startedMs = new Date(s.startedAt).getTime();
      if (!Number.isFinite(startedMs)) continue;
      const durMs = Math.max(0, endedMs - startedMs);
      totalHours += durMs / 3_600_000;
      sawAnyInWindow = true;
    }

    return totalHours * PRICING.browserbase_session_per_hr;
  } catch (err) {
    console.error("[real-spend] browserbase error:", err);
    return null;
  }
}

export interface RealSpend {
  claude: number | null;
  apify: number | null;
  exa: number | null;
  browserbase: number | null;
}

export async function fetchRealSpend(
  startIso: string,
  endIso: string,
): Promise<RealSpend> {
  // Use allSettled so that an unexpected rejection in one fetcher does not
  // blank the entire cost dashboard. Each fetcher is already contracted to
  // return null on handled errors; this is a defence-in-depth against paths
  // that escape their internal try/catch (e.g. malformed upstream data that
  // throws outside the covered region).
  const [claudeResult, apifyResult, exaResult, browserbaseResult] =
    await Promise.allSettled([
      fetchAnthropicSpend(startIso, endIso),
      fetchApifySpend(startIso),
      fetchExaSpend(startIso, endIso),
      fetchBrowserbaseSpend(startIso, endIso),
    ]);

  const claude =
    claudeResult.status === "fulfilled" ? claudeResult.value : null;
  const apify = apifyResult.status === "fulfilled" ? apifyResult.value : null;
  const exa = exaResult.status === "fulfilled" ? exaResult.value : null;
  const browserbase =
    browserbaseResult.status === "fulfilled" ? browserbaseResult.value : null;

  if (claudeResult.status === "rejected") {
    console.error("[real-spend] anthropic rejected:", claudeResult.reason);
  }
  if (apifyResult.status === "rejected") {
    console.error("[real-spend] apify rejected:", apifyResult.reason);
  }
  if (exaResult.status === "rejected") {
    console.error("[real-spend] exa rejected:", exaResult.reason);
  }
  if (browserbaseResult.status === "rejected") {
    console.error(
      "[real-spend] browserbase rejected:",
      browserbaseResult.reason,
    );
  }

  return { claude, apify, exa, browserbase };
}
