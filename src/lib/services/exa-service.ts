import Exa from "exa-js";
import { PRICING, trackUsage } from "@/lib/services/cost-tracker";
import { withTimeout } from "@/lib/utils/timeout";

export type SearchType = "neural" | "fast" | "auto" | "deep";
export type SearchCategory =
  | "company"
  | "research paper"
  | "news"
  | "pdf"
  | "tweet"
  | "personal site"
  | "financial report"
  | "people";

export interface ExaSearchResult {
  title: string;
  url: string;
  publishedDate: string | null;
  author: string | null;
  text: string | null;
  summary: string | null;
}

export interface ExaSearchResponse {
  results: ExaSearchResult[];
  searchType: string;
  resultCount: number;
}

export interface ExaSearchOptions {
  numResults?: number;
  searchType?: SearchType;
  category?: SearchCategory;
  includeText?: boolean;
  includeDomains?: string[];
}

const TIMEOUT_MS = 30_000;

// ── Concurrency limiter ────────────────────────────────────────────────────
// Exa allows 10 QPS on search. Cap at 8 to leave headroom.
const MAX_CONCURRENT = 8;
let activeCount = 0;
const waitQueue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeCount++;
      resolve();
    });
  });
}

function release(): void {
  activeCount--;
  const next = waitQueue.shift();
  if (next) next();
}

// ── Retry with exponential backoff ─────────────────────────────────────────
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("too many request")
    );
  }
  return false;
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === MAX_RETRIES) break;

      const isRateLimit = isRateLimitError(error);
      const delay = isRateLimit
        ? BASE_DELAY_MS * Math.pow(2, attempt + 1) // 2s, 4s, 8s for rate limits
        : BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s for other errors

      console.warn(
        `[Exa] ${isRateLimit ? "Rate limited" : "Error"} on "${label}" (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ── Exa Service ────────────────────────────────────────────────────────────

export class ExaService {
  private exa: Exa;

  constructor() {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      throw new Error(
        "EXA_API_KEY environment variable is required. Get your API key at https://dashboard.exa.ai/api-keys",
      );
    }
    this.exa = new Exa(apiKey);
  }

  async search(
    query: string,
    options: ExaSearchOptions = {},
  ): Promise<ExaSearchResponse> {
    await acquire();
    try {
      return await withRetry(() => this.executeSearch(query, options), query);
    } finally {
      release();
    }
  }

  private async executeSearch(
    query: string,
    options: ExaSearchOptions,
  ): Promise<ExaSearchResponse> {
    const {
      numResults = 10,
      searchType = "auto",
      category,
      includeText = false,
      includeDomains,
    } = options;

    const searchOptions: {
      numResults: number;
      type: SearchType;
      category?: SearchCategory;
      includeDomains?: string[];
    } = {
      numResults,
      type: searchType,
    };

    if (category) {
      searchOptions.category = category;
    }
    if (includeDomains && includeDomains.length > 0) {
      searchOptions.includeDomains = includeDomains;
    }

    console.log(`[Exa] Searching: "${query}" (type: ${searchType})`);

    // Local SearchType/SearchCategory include values ("deep", "tweet") that
    // exa-js's newer narrowed types don't accept; cast through unknown so the
    // SDK call compiles while the upstream types catch up.
    const results = await withTimeout(
      includeText
        ? this.exa.searchAndContents(query, {
            ...searchOptions,
            text: true,
            context: { maxCharacters: 10000 },
          } as unknown as Parameters<typeof this.exa.searchAndContents>[1])
        : this.exa.search(
            query,
            searchOptions as unknown as Parameters<typeof this.exa.search>[1],
          ),
      TIMEOUT_MS,
      `Exa search for "${query}"`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultArray = (results as any).results || [];

    console.log(`[Exa] Got ${resultArray.length} results for "${query}"`);

    trackUsage({
      service: "exa",
      operation: "search",
      estimated_cost_usd: PRICING.exa_search,
      metadata: {
        query,
        searchType,
        numResults,
        includeText,
        resultCount: resultArray.length,
      },
    });

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results: resultArray.map((result: any) => ({
        title: result.title ?? "",
        url: result.url ?? "",
        publishedDate: result.publishedDate ?? null,
        author: result.author ?? null,
        text: result.text ?? null,
        summary: (result as { summary?: string | null }).summary ?? null,
      })),
      searchType: (results as { searchType?: string }).searchType ?? searchType,
      resultCount: resultArray.length,
    };
  }
}
