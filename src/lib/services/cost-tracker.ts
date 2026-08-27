import { AsyncLocalStorage } from "node:async_hooks";

import { getCurrentIdentity } from "@/lib/auth/identity";
import { getAdminClient } from "@/lib/supabase/admin";

// ── Pricing constants (USD) ──────────────────────────────────────────────
// Last verified 2026-03-29. Sources:
//   Claude  -- https://docs.anthropic.com/en/docs/about-claude/pricing
//   Exa     -- https://exa.ai/pricing (March 2026: contents bundled into search)
//   Apify   -- https://apify.com/pricing (pay-per-result actors)
//   BB      -- https://browserbase.com/pricing
export const PRICING = {
  // Claude Sonnet 4 (per million tokens)
  claude_sonnet_input: 3.0,
  claude_sonnet_output: 15.0,
  claude_sonnet_cache_read: 0.3,
  claude_sonnet_cache_write: 3.75,
  // Claude Opus 5 (per million tokens) -- the email composer's model.
  // Cache read is 0.1x input, 5-minute cache write is 1.25x input.
  claude_opus_input: 5.0,
  claude_opus_output: 25.0,
  claude_opus_cache_read: 0.5,
  claude_opus_cache_write: 6.25,
  // Claude Haiku 4.5 (per million tokens)
  claude_haiku_input: 1.0,
  claude_haiku_output: 5.0,
  claude_haiku_cache_read: 0.1,
  claude_haiku_cache_write: 1.25,
  // Exa -- $7 per 1,000 searches (text + highlights for 10 results included)
  exa_search: 0.007,
  // Apify -- pay-per-result pricing (~20 posts per profile scrape)
  apify_linkedin: 0.05,
  // Apify tweet scraper -- $0.40/1k tweets, ~$0.04 for 100 tweets
  apify_twitter: 0.04,
  // Browserbase Fetch API with proxies -- $4 per 1,000 requests
  browserbase_fetch: 0.004,
  // Browserbase browser session -- billed by time, $0.10/hr
  browserbase_session_per_hr: 0.1,
  // Google Places API (New) -- Text Search with reviews field mask
  google_places_search: 0.032,
  // Email finder/verifier (Hunter.io by default). Last verified 2026-08-01.
  // Hunter bills in credits, not per call, and the per-credit rate depends on
  // the plan -- a finder call costs 1 credit, a verification 1 credit. These
  // are mid-tier estimates; adjust to your plan's actual rate. Set to 0 if you
  // are on the free tier and want them excluded from the cost report.
  email_provider_find: 0.008,
  email_provider_verify: 0.004,
} as const;

// ── Action context (AsyncLocalStorage) ───────────────────────────────────
// Route handlers wrap their work in `withAction()`. Every `trackUsage` call
// inside automatically inherits the action_id + label -- no signature changes
// needed on any service.

interface ActionContext {
  action_id: string;
  action_label: string;
  /**
   * Who the spend belongs to.
   *
   * Only 3 of ~30 trackUsage call sites ever passed a user_id, so Exa, Apify,
   * Browserbase, Hunter, Google Places and every Claude service call wrote
   * NULL. The rows land (the writer is the admin client) but /api/settings/
   * costs reads them under `requesting_user_id() = user_id`, and NULL never
   * equals a user, so a $12 run displayed $0.00. Carrying it on the action
   * context attributes everything inside a withAction block without touching
   * the call sites.
   */
  user_id?: string;
}

const actionStore = new AsyncLocalStorage<ActionContext>();

/**
 * Run `fn` inside an action context. All `trackUsage` calls made during `fn`
 * (including from nested service calls) will be tagged with this action.
 *
 * Pass `userId` wherever the caller knows it — without it the spend is
 * recorded but invisible to the person who incurred it.
 *
 * Usage:
 *   return withAction("Enrich person: John Smith", async () => { ... }, userId);
 */
export function withAction<T>(
  label: string,
  fn: () => Promise<T>,
  userId?: string,
): Promise<T> {
  return actionStore.run(
    { action_id: crypto.randomUUID(), action_label: label, user_id: userId },
    fn,
  );
}

export type ServiceName =
  | "claude"
  | "exa"
  | "apify"
  | "browserbase"
  | "google"
  | "gmail"
  | "email_provider";

interface UsageEntry {
  service: ServiceName;
  operation: string;
  tokens_input?: number;
  tokens_output?: number;
  estimated_cost_usd: number;
  metadata?: Record<string, unknown>;
  campaign_id?: string;
  user_id?: string;
}

export type ClaudeModel = "opus" | "sonnet" | "haiku";

export interface ClaudeCostParams {
  model: ClaudeModel;
  /** Total input tokens (AI SDK's `usage.inputTokens`, already includes cache reads + writes). */
  inputTokens: number;
  outputTokens: number;
  /** Tokens read from the prompt cache, billed at 10% of uncached input. */
  cacheReadTokens?: number;
  /** Tokens written to the prompt cache, billed at 125% of uncached input. */
  cacheCreationTokens?: number;
}

/**
 * Estimate Claude API cost from token counts with cache-aware pricing.
 * `inputTokens` is the total (cache reads + cache writes + uncached); we subtract
 * the cache buckets to get the uncached remainder, then bill each at its own rate.
 */
export function estimateClaudeCost(params: ClaudeCostParams): number {
  const { model } = params;
  const RATES = {
    opus: {
      input: PRICING.claude_opus_input,
      cacheRead: PRICING.claude_opus_cache_read,
      cacheWrite: PRICING.claude_opus_cache_write,
      output: PRICING.claude_opus_output,
    },
    sonnet: {
      input: PRICING.claude_sonnet_input,
      cacheRead: PRICING.claude_sonnet_cache_read,
      cacheWrite: PRICING.claude_sonnet_cache_write,
      output: PRICING.claude_sonnet_output,
    },
    haiku: {
      input: PRICING.claude_haiku_input,
      cacheRead: PRICING.claude_haiku_cache_read,
      cacheWrite: PRICING.claude_haiku_cache_write,
      output: PRICING.claude_haiku_output,
    },
  }[model];
  const uncachedRate = RATES.input;
  const cacheReadRate = RATES.cacheRead;
  const cacheWriteRate = RATES.cacheWrite;
  const outputRate = RATES.output;

  const cacheRead = params.cacheReadTokens ?? 0;
  const cacheWrite = params.cacheCreationTokens ?? 0;
  const uncached = Math.max(0, params.inputTokens - cacheRead - cacheWrite);

  return (
    (uncached / 1_000_000) * uncachedRate +
    (cacheRead / 1_000_000) * cacheReadRate +
    (cacheWrite / 1_000_000) * cacheWriteRate +
    (params.outputTokens / 1_000_000) * outputRate
  );
}

interface AiSdkUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  cachedInputTokens?: number;
}

/**
 * Convenience wrapper: pulls cache breakdown from AI SDK's `usage` object so
 * call sites don't have to reach into `providerMetadata.anthropic` manually.
 */
export function estimateClaudeCostFromUsage(
  model: ClaudeModel,
  usage: AiSdkUsageLike,
): number {
  return estimateClaudeCost({
    model,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens:
      usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens,
    cacheCreationTokens: usage.inputTokenDetails?.cacheWriteTokens,
  });
}

/**
 * Log an API usage entry. Fire-and-forget -- errors are swallowed so callers
 * are never disrupted by tracking failures.
 *
 * Automatically picks up action_id/action_label from the nearest `withAction`
 * context if one exists.
 */
/**
 * Inserts still in flight. Serverless can freeze the instance the moment a
 * response returns, silently dropping fire-and-forget writes: long-lived
 * paths (the job runner) await flushUsageTracking() before returning.
 */
const pendingInserts = new Set<Promise<void>>();

/** Await every in-flight api_usage insert. Never throws. */
export async function flushUsageTracking(): Promise<void> {
  await Promise.allSettled([...pendingInserts]);
}

export function trackUsage(entry: UsageEntry): void {
  const ctx = actionStore.getStore();

  const insert = (async () => {
    try {
      const { error } = await getAdminClient()
        .from("api_usage")
        .insert({
          service: entry.service,
          operation: entry.operation,
          tokens_input: entry.tokens_input ?? null,
          tokens_output: entry.tokens_output ?? null,
          estimated_cost_usd: entry.estimated_cost_usd,
          metadata: {
            ...(entry.metadata ?? {}),
            // Where the spend came from: the MCP route injects an identity;
            // the web app and jobs have none, so they read as "web".
            source: getCurrentIdentity()?.source ?? "web",
          },
          campaign_id: entry.campaign_id ?? null,
          // Explicit wins; otherwise inherit whoever the action belongs to.
          user_id: entry.user_id ?? ctx?.user_id ?? null,
          action_id: ctx?.action_id ?? null,
          action_label: ctx?.action_label ?? null,
        });
      if (error) console.error("[cost-tracker] insert failed:", error.message);
    } catch (err) {
      console.error("[cost-tracker] unexpected error:", err);
    }
  })();
  pendingInserts.add(insert);
  void insert.finally(() => pendingInserts.delete(insert));
}
