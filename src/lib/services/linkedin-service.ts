import { PRICING, trackUsage } from "@/lib/services/cost-tracker";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

// ── harvestapi/linkedin-profile-posts (A3cAPGpwBEG8RJwse) ──
// Synchronous scraping — no polling needed
interface HarvestApiProfilePost {
  type?: string;
  id?: string;
  linkedinUrl?: string;
  content?: string;
  author?: {
    publicIdentifier?: string;
    name?: string;
    info?: string; // headline
    linkedinUrl?: string;
  };
  postedAt?: {
    timestamp?: number;
    date?: string;
  };
  postImages?: unknown[];
  postVideo?: unknown;
  repostedBy?: {
    name?: string;
    publicIdentifier?: string;
  };
  engagement?: {
    likes?: number;
    comments?: number;
    shares?: number;
  };
}

const PROFILE_POSTS_ACTOR = "A3cAPGpwBEG8RJwse"; // harvestapi/linkedin-profile-posts

export interface LinkedInPost {
  id: string;
  text: string;
  url: string;
  created_at: string;
  likes: number;
  comments: number;
  reposts: number;
  is_repost: boolean;
}

export interface LinkedInProfile {
  username: string;
  name: string;
  headline: string;
}

export interface LinkedInScrapeResult {
  profile: LinkedInProfile | null;
  posts: LinkedInPost[];
}

function cleanLinkedInUsername(input: string): string {
  return input
    .replace(/^@/, "")
    .replace(/.*linkedin\.com\/in\//, "")
    .replace(/.*linkedin\.com\/company\//, "")
    .replace(/\/$/, "")
    .replace(/\?.*$/, "");
}

function extractPost(
  post: HarvestApiProfilePost,
  fallbackUsername: string,
): LinkedInPost {
  const engagement = post.engagement || {};
  const postUrl =
    post.linkedinUrl ?? `https://linkedin.com/in/${fallbackUsername}`;

  return {
    id: String(post.id ?? postUrl),
    text: post.content ?? "",
    url: postUrl,
    created_at: post.postedAt?.date ?? "",
    likes: engagement.likes ?? 0,
    comments: engagement.comments ?? 0,
    reposts: engagement.shares ?? 0,
    is_repost: !!post.repostedBy,
  };
}

export class LinkedinService {
  private apifyApiToken: string | undefined;

  constructor() {
    this.apifyApiToken = process.env.APIFY_API_TOKEN;

    if (!this.apifyApiToken) {
      console.warn("APIFY_API_TOKEN not set - LinkedIn scraping will not work");
    }
  }

  extractUsername(linkedinUrl: string): string {
    return cleanLinkedInUsername(linkedinUrl);
  }

  /**
   * Scrape LinkedIn profile and posts using harvestapi actor.
   * Uses synchronous run-sync-get-dataset-items — no polling needed.
   */
  async scrapeProfile(linkedinUrl: string): Promise<LinkedInScrapeResult> {
    if (!this.apifyApiToken) {
      throw new Error("APIFY_API_TOKEN environment variable is required");
    }

    const username = cleanLinkedInUsername(linkedinUrl);
    const profileUrl = `https://www.linkedin.com/in/${username}/`;

    console.log(`[LinkedIn] Scraping profile: ${profileUrl}`);

    const apiUrl = `https://api.apify.com/v2/acts/${PROFILE_POSTS_ACTOR}/run-sync-get-dataset-items`;

    const response = await fetchWithTimeout(
      apiUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apifyApiToken}`,
        },
        body: JSON.stringify({ profileUrls: [profileUrl] }),
      },
      90_000,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Apify API error ${response.status}: ${errorText}`);
    }

    const result: HarvestApiProfilePost[] = await response.json();
    if (!Array.isArray(result)) return { posts: [], profile: null };

    console.log(`[LinkedIn] Got ${result.length} posts for ${username}`);

    trackUsage({
      service: "apify",
      operation: "scrape-linkedin",
      estimated_cost_usd: PRICING.apify_linkedin,
      metadata: { username, postCount: result.length },
    });

    // Extract profile info from the first non-repost authored by the user
    let profile: LinkedInProfile | null = null;
    const ownPost = result.find(
      (p) => !p.repostedBy && p.author?.publicIdentifier === username,
    );
    if (ownPost?.author) {
      profile = {
        username,
        name: ownPost.author.name ?? "",
        headline: ownPost.author.info ?? "",
      };
    }

    const posts = result
      .filter(
        (post): post is HarvestApiProfilePost =>
          typeof post === "object" && post !== null,
      )
      .map((post) => extractPost(post, username));

    return { posts, profile };
  }
}
