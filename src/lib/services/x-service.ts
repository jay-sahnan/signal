import { PRICING, trackUsage } from "@/lib/services/cost-tracker";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

export interface XUser {
  id: string;
  username: string;
  name: string;
  description?: string;
  followers_count?: number;
  following_count?: number;
  tweet_count?: number;
  verified?: boolean;
  profile_image_url?: string;
}

export interface XTweet {
  id: string;
  text: string;
  created_at: string;
  url?: string;
  public_metrics?: {
    retweet_count?: number;
    like_count?: number;
    reply_count?: number;
    quote_count?: number;
    view_count?: number;
  };
  is_reply?: boolean;
  lang?: string;
}

export interface XEnrichment {
  url: string;
  username: string;
  user: XUser | null;
  tweets: XTweet[];
  totalTweets: number;
}

export class XService {
  private apifyApiToken: string;

  constructor() {
    const apifyApiToken = process.env.APIFY_API_TOKEN;
    if (!apifyApiToken) {
      throw new Error("APIFY_API_TOKEN environment variable is required");
    }
    this.apifyApiToken = apifyApiToken;
  }

  extractUsername(twitterUrl: string): string {
    const cleaned = twitterUrl.trim().replace(/\/+$/, "");
    const match = cleaned.match(/(?:twitter\.com|x\.com)\/([^\/\?\s]+)/);
    if (!match || !match[1]) {
      const directMatch = cleaned.match(/^([^\/\?\s]+)$/);
      if (directMatch && directMatch[1]) return directMatch[1];
      throw new Error(`Invalid Twitter/X URL format: ${twitterUrl}`);
    }
    return match[1];
  }

  private async startApifyRun(username: string): Promise<string> {
    const url = `https://api.apify.com/v2/acts/apidojo~tweet-scraper/runs`;
    const payload = {
      twitterHandles: [username],
      getReplies: true,
      maxItems: 50,
    };

    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apifyApiToken}`,
        },
        body: JSON.stringify(payload),
      },
      30_000,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Apify API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    return result.data.id;
  }

  private async waitForRunCompletion(runId: string): Promise<void> {
    const maxWaitTime = 120000;
    const pollInterval = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const url = `https://api.apify.com/v2/actor-runs/${runId}`;
      const response = await fetchWithTimeout(
        url,
        { headers: { Authorization: `Bearer ${this.apifyApiToken}` } },
        15_000,
      );

      if (!response.ok) {
        throw new Error(`Failed to check run status: ${response.status}`);
      }

      const result = await response.json();
      const status = result.data.status;

      if (status === "SUCCEEDED") return;

      if (status === "FAILED" || status === "ABORTED") {
        throw new Error(
          `Apify run ${status}: ${result.data.statusMessage || "Unknown error"}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error("Apify run timed out after 2 minutes");
  }

  private async getRunResults(runId: string): Promise<unknown[]> {
    const url = `https://api.apify.com/v2/actor-runs/${runId}/dataset/items`;
    const response = await fetchWithTimeout(
      url,
      { headers: { Authorization: `Bearer ${this.apifyApiToken}` } },
      30_000,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch run results: ${response.status} - ${errorText}`,
      );
    }

    const results = await response.json();
    return Array.isArray(results) ? results : [];
  }

  async getUserTweetsAndReplies(
    username: string,
  ): Promise<{ tweets: XTweet[]; rawResults: unknown[] }> {
    console.log(`[X] Starting Apify run for @${username}`);

    const runId = await this.startApifyRun(username);
    console.log(`[X] Run started: ${runId}`);

    await this.waitForRunCompletion(runId);

    const results = await this.getRunResults(runId);
    console.log(`[X] Fetched ${results.length} items`);

    const getString = (
      item: Record<string, unknown>,
      ...keys: string[]
    ): string => {
      for (const key of keys) {
        const value = item[key];
        if (typeof value === "string" && value) return value;
      }
      return "";
    };

    const getOptionalString = (
      item: Record<string, unknown>,
      ...keys: string[]
    ): string | undefined => {
      for (const key of keys) {
        const value = item[key];
        if (typeof value === "string" && value) return value;
      }
      return undefined;
    };

    const getNumber = (
      item: Record<string, unknown>,
      ...keys: string[]
    ): number => {
      for (const key of keys) {
        const value = item[key];
        if (typeof value === "number") return value;
      }
      return 0;
    };

    const getBoolean = (
      item: Record<string, unknown>,
      key: string,
    ): boolean => {
      const value = item[key];
      return typeof value === "boolean" ? value : false;
    };

    const tweets: XTweet[] = (results as Record<string, unknown>[]).map(
      (item) => ({
        id: getString(item, "id", "tweetId"),
        text: getString(item, "fullText", "text"),
        created_at: getString(item, "createdAt", "created_at"),
        url: getOptionalString(item, "url", "twitterUrl"),
        public_metrics: {
          retweet_count: getNumber(item, "retweetCount", "retweet_count"),
          like_count: getNumber(item, "likeCount", "like_count"),
          reply_count: getNumber(item, "replyCount", "reply_count"),
          quote_count: getNumber(item, "quoteCount", "quote_count"),
          view_count: getNumber(item, "viewCount"),
        },
        is_reply: getBoolean(item, "isReply"),
        lang: getOptionalString(item, "lang"),
      }),
    );

    return { tweets, rawResults: results };
  }

  async enrichTwitterProfile(twitterUrl: string): Promise<XEnrichment> {
    console.log(`[X] Enriching profile: ${twitterUrl}`);

    const username = this.extractUsername(twitterUrl);
    const { tweets, rawResults } = await this.getUserTweetsAndReplies(username);
    console.log(`[X] Found ${tweets.length} tweets/replies`);

    trackUsage({
      service: "apify",
      operation: "scrape-twitter",
      estimated_cost_usd: PRICING.apify_twitter,
      metadata: { username, tweetCount: tweets.length },
    });

    let user: XUser | null = null;
    if (rawResults.length > 0) {
      const firstResult = rawResults[0];
      if (
        firstResult &&
        typeof firstResult === "object" &&
        "author" in firstResult &&
        firstResult.author &&
        typeof firstResult.author === "object"
      ) {
        const author = firstResult.author as Record<string, unknown>;
        const s = (key: string, fb: string): string => {
          const v = author[key];
          return typeof v === "string" ? v : fb;
        };
        const os = (key: string): string | undefined => {
          const v = author[key];
          return typeof v === "string" ? v : undefined;
        };
        const n = (key: string): number | undefined => {
          const v = author[key];
          return typeof v === "number" ? v : undefined;
        };
        const b = (key: string): boolean => {
          const v = author[key];
          return typeof v === "boolean" ? v : false;
        };
        user = {
          id: s("id", ""),
          username: s("userName", username),
          name: s("name", ""),
          description: os("description"),
          followers_count: n("followers"),
          following_count: n("following"),
          tweet_count: n("statusesCount"),
          verified: b("isVerified") || b("isBlueVerified"),
          profile_image_url: os("profilePicture"),
        };
      }
    }

    return {
      url: twitterUrl,
      username,
      user,
      tweets,
      totalTweets: tweets.length,
    };
  }
}
