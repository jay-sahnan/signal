import { tool } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  linkPersonToCampaign,
  mergeEnrichmentData,
} from "@/lib/services/knowledge-base";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const GITHUB_API = "https://api.github.com";
const PER_PAGE = 100;
// GitHub caps stargazers pagination at 400 pages (40,000 results)
const MAX_STARGAZER_PAGE = 400;

function githubHeaders(accept?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept ?? "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Signal-App",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function githubFetch<T>(
  path: string,
  accept?: string,
): Promise<{ data: T | null; status: number; remaining: number }> {
  const url = `${GITHUB_API}${path}`;
  let res = await fetchWithTimeout(
    url,
    { headers: githubHeaders(accept) },
    30_000,
  );

  // Some orgs (e.g. browserbase) block classic PATs -- retry without auth
  if (res.status === 403 && process.env.GITHUB_TOKEN) {
    const noAuthHeaders: Record<string, string> = {
      Accept: accept ?? "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Signal-App",
    };
    res = await fetchWithTimeout(url, { headers: noAuthHeaders }, 30_000);
  }

  const remaining = parseInt(res.headers.get("x-ratelimit-remaining") ?? "0");
  if (!res.ok) return { data: null, status: res.status, remaining };
  const data = (await res.json()) as T;
  return { data, status: res.status, remaining };
}

/**
 * Find or create a person by their GitHub profile URL.
 * Stores the full GitHub API response in enrichment_data.github.
 */
async function findOrCreateGitHubPerson(profile: {
  username: string;
  github_url: string;
  avatar_url: string;
  // Full profile fields (from /users/{username} -- null if only from stargazers endpoint)
  raw?: Record<string, unknown>;
  name?: string | null;
  email?: string | null;
  twitter_username?: string | null;
  // Signal context
  starred_repo?: string;
  starred_at?: string;
  source: string;
}): Promise<string> {
  const supabase = await createClient();

  // Dedup by github_url
  const { data: existing } = await supabase
    .from("people")
    .select("id, enrichment_data")
    .eq("github_url", profile.github_url)
    .maybeSingle();

  // Build github enrichment data -- store everything
  const githubData: Record<string, unknown> = {
    username: profile.username,
    profile_url: profile.github_url,
    avatar_url: profile.avatar_url,
    starred_repo: profile.starred_repo ?? null,
    starred_at: profile.starred_at ?? null,
    fetched_at: new Date().toISOString(),
    // Dump the full API response if we have it
    ...(profile.raw ?? {}),
  };

  if (existing) {
    await mergeEnrichmentData("people", existing.id, { github: githubData });
    return existing.id;
  }

  // Create new person
  const twitterUrl = profile.twitter_username
    ? `https://x.com/${profile.twitter_username}`
    : null;

  const hasFullProfile = !!profile.raw;
  const name = profile.name || profile.username;
  const bio = profile.raw?.bio != null ? String(profile.raw.bio) : null;

  const { data: created, error } = await supabase
    .from("people")
    .insert({
      name,
      github_url: profile.github_url,
      personal_email: profile.email ?? null,
      twitter_url: twitterUrl,
      title: bio?.slice(0, 200) ?? null,
      source: profile.source,
      enrichment_data: { github: githubData },
      enrichment_status: hasFullProfile ? "enriched" : "pending",
      last_enriched_at: hasFullProfile ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: raceHit } = await supabase
        .from("people")
        .select("id")
        .eq("github_url", profile.github_url)
        .single();
      if (raceHit) return raceHit.id;
    }
    throw new Error(`Failed to create person: ${error.message}`);
  }

  return created.id;
}

// ---------------------------------------------------------------------------
// Tool 1: Bulk-fetch stargazer usernames + save to people table
// ---------------------------------------------------------------------------
export const fetchGitHubStargazers = tool({
  description:
    "Bulk-fetch recent stargazers from a GitHub repo. Saves each person to the people table automatically (deduped by GitHub URL). Returns usernames for comparison. Use count up to 5000 for large-scale collection.",
  inputSchema: z.object({
    owner: z.string().describe('GitHub org or user (e.g. "browserbase")'),
    repo: z.string().describe('Repository name (e.g. "stagehand")'),
    count: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(100)
      .describe("Number of recent stargazers to fetch (1-5000, default 100)"),
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign ID to link people to and store signal results"),
    companyId: z
      .string()
      .uuid()
      .optional()
      .describe("Company ID to associate results with"),
  }),
  execute: async (input) => {
    // 1. Get repo info
    const { data: repoData, status: repoStatus } = await githubFetch<{
      full_name: string;
      description: string | null;
      stargazers_count: number;
      forks_count: number;
      language: string | null;
      html_url: string;
    }>(`/repos/${input.owner}/${input.repo}`);

    if (!repoData) {
      const reason =
        repoStatus === 404
          ? "not found"
          : repoStatus === 403 || repoStatus === 429
            ? "rate limited"
            : `HTTP ${repoStatus}`;
      return {
        error: `Repository ${input.owner}/${input.repo}: ${reason}`,
        stargazers: [],
        usernames: [],
      };
    }

    const totalStars = repoData.stargazers_count;
    // GitHub caps at 400 pages for stargazers
    const accessiblePages = Math.min(
      Math.ceil(totalStars / PER_PAGE),
      MAX_STARGAZER_PAGE,
    );
    const pagesNeeded = Math.ceil(input.count / PER_PAGE);

    // 2. Fetch pages from the end (most recent stargazers first)
    const stargazers: Array<{
      username: string;
      avatar_url: string;
      github_url: string;
      starred_at: string;
    }> = [];

    for (
      let page = accessiblePages;
      page >= Math.max(1, accessiblePages - pagesNeeded + 1) &&
      stargazers.length < input.count;
      page--
    ) {
      const { data, status, remaining } = await githubFetch<
        Array<{
          starred_at: string;
          user: { login: string; avatar_url: string; html_url: string };
        }>
      >(
        `/repos/${input.owner}/${input.repo}/stargazers?per_page=${PER_PAGE}&page=${page}`,
        "application/vnd.github.v3.star+json",
      );

      if (!data || data.length === 0) {
        // If we hit an empty page, try the previous one
        if (status === 422 && page > 1) continue;
        break;
      }

      // Reverse so most recent comes first
      for (
        let i = data.length - 1;
        i >= 0 && stargazers.length < input.count;
        i--
      ) {
        stargazers.push({
          username: data[i].user.login,
          avatar_url: data[i].user.avatar_url,
          github_url: data[i].user.html_url,
          starred_at: data[i].starred_at,
        });
      }

      if (remaining < 10) break;
    }

    // 3. Save each stargazer to the people table (batched)
    let saved = 0;
    let skipped = 0;
    const repoContext = `${input.owner}/${input.repo}`;

    for (let i = 0; i < stargazers.length; i += 10) {
      const batch = stargazers.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(async (sg) => {
          const personId = await findOrCreateGitHubPerson({
            username: sg.username,
            github_url: sg.github_url,
            avatar_url: sg.avatar_url,
            starred_repo: repoContext,
            starred_at: sg.starred_at,
            source: "github",
          });

          if (input.campaignId) {
            await linkPersonToCampaign(personId, input.campaignId);
          }

          return personId;
        }),
      );

      for (const r of results) {
        if (r.status === "fulfilled") saved++;
        else skipped++;
      }
    }

    const output = {
      repository: {
        full_name: repoData.full_name,
        description: repoData.description,
        stars: totalStars,
        forks: repoData.forks_count,
        language: repoData.language,
        url: repoData.html_url,
      },
      total_stars: totalStars,
      fetched: stargazers.length,
      saved_to_db: saved,
      skipped_or_failed: skipped,
      usernames: stargazers.map((s) => s.username),
      stargazers: stargazers.slice(0, 50),
    };

    // 4. Store in signal_results
    if (input.campaignId) {
      const supabase = await createClient();
      const { data: signal } = await supabase
        .from("signals")
        .select("id")
        .eq("slug", "github-stargazers")
        .maybeSingle();

      if (signal) {
        await supabase.from("signal_results").insert({
          signal_id: signal.id,
          campaign_id: input.campaignId,
          organization_id: input.companyId ?? null,
          output: {
            repository: output.repository,
            total_stars: output.total_stars,
            fetched: output.fetched,
            saved_to_db: output.saved_to_db,
            usernames: output.usernames,
          },
          status: stargazers.length > 0 ? "success" : "partial",
        });
      }
    }

    return output;
  },
});

// ---------------------------------------------------------------------------
// Tool 2: Enrich specific GitHub users with full profiles + top repos
// ---------------------------------------------------------------------------
export const enrichGitHubProfiles = tool({
  description:
    "Fetch full GitHub profiles AND their top public repositories for specific usernames. Saves everything to the people table. Gets: name, company, location, bio, email, twitter, blog, followers, following, hireable, created_at, plus their top 10 repos (name, description, stars, forks, language, topics). Use after fetchGitHubStargazers to enrich interesting people.",
  inputSchema: z.object({
    usernames: z
      .array(z.string())
      .min(1)
      .max(100)
      .describe("GitHub usernames to enrich (1-100)"),
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign ID to link enriched people to"),
    signalContext: z
      .string()
      .optional()
      .describe(
        'Context for this enrichment (e.g. "overlap: stagehand + playwright")',
      ),
  }),
  execute: async (input) => {
    const enriched: Array<Record<string, unknown>> = [];
    const failed: string[] = [];

    for (let i = 0; i < input.usernames.length; i += 10) {
      const batch = input.usernames.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(async (username) => {
          // Fetch profile + top repos in parallel
          const [profileRes, reposRes] = await Promise.all([
            githubFetch<Record<string, unknown>>(`/users/${username}`),
            githubFetch<
              Array<{
                name: string;
                full_name: string;
                description: string | null;
                html_url: string;
                stargazers_count: number;
                forks_count: number;
                language: string | null;
                topics: string[];
                fork: boolean;
                created_at: string;
                updated_at: string;
                pushed_at: string;
              }>
            >(
              `/users/${username}/repos?sort=stars&direction=desc&per_page=10&type=owner`,
            ),
          ]);
          return { profile: profileRes.data, repos: reposRes.data };
        }),
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const username = batch[j];
        if (result.status === "fulfilled" && result.value.profile) {
          const raw = result.value.profile;
          const repos = result.value.repos ?? [];

          // Map repos to a clean structure
          const topRepos = repos
            .filter((r) => !r.fork) // skip forks
            .slice(0, 10)
            .map((r) => ({
              name: r.name,
              full_name: r.full_name,
              description: r.description,
              url: r.html_url,
              stars: r.stargazers_count,
              forks: r.forks_count,
              language: r.language,
              topics: r.topics,
              last_push: r.pushed_at,
            }));

          // Derive tech stack from repos
          const languages = new Set<string>();
          const allTopics = new Set<string>();
          for (const r of topRepos) {
            if (r.language) languages.add(r.language);
            for (const t of r.topics ?? []) allTopics.add(t);
          }

          // Store profile + repos together
          const fullRaw = {
            ...raw,
            top_repos: topRepos,
            languages: [...languages],
            topics: [...allTopics],
          };

          const personId = await findOrCreateGitHubPerson({
            username: String(raw.login),
            github_url: String(raw.html_url),
            avatar_url: String(raw.avatar_url),
            name: raw.name != null ? String(raw.name) : null,
            email: raw.email != null ? String(raw.email) : null,
            twitter_username:
              raw.twitter_username != null
                ? String(raw.twitter_username)
                : null,
            raw: fullRaw,
            starred_repo: input.signalContext ?? undefined,
            source: "github",
          });

          if (input.campaignId) {
            await linkPersonToCampaign(personId, input.campaignId);
          }

          enriched.push({
            username: raw.login,
            name: raw.name,
            company: raw.company,
            location: raw.location,
            bio: raw.bio,
            blog: raw.blog,
            email: raw.email,
            twitter_username: raw.twitter_username,
            hireable: raw.hireable,
            followers: raw.followers,
            following: raw.following,
            public_repos: raw.public_repos,
            public_gists: raw.public_gists,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            profile_url: raw.html_url,
            languages: [...languages],
            topics: [...allTopics],
            top_repos: topRepos,
          });
        } else {
          failed.push(username);
        }
      }
    }

    return {
      enriched: enriched.length,
      failed: failed.length,
      profiles: enriched,
      failed_usernames: failed.length > 0 ? failed : undefined,
    };
  },
});

// ---------------------------------------------------------------------------
// Tool 3: Search GitHub repos
// ---------------------------------------------------------------------------
export const searchGitHubRepos = tool({
  description:
    "Search GitHub for repositories belonging to a company or org. Use this to find a company's GitHub presence before fetching stargazers.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'Search query -- org name, company name, or "org:{orgname}" for exact match',
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe("Max repos to return (1-10, default 5)"),
  }),
  execute: async (input) => {
    const { data } = await githubFetch<{
      total_count: number;
      items: Array<{
        name: string;
        full_name: string;
        description: string | null;
        stargazers_count: number;
        forks_count: number;
        language: string | null;
        html_url: string;
        owner: { login: string; avatar_url: string; html_url: string };
      }>;
    }>(
      `/search/repositories?q=${encodeURIComponent(input.query)}&sort=stars&order=desc&per_page=${input.maxResults}`,
    );

    if (!data) {
      return { error: "GitHub search failed or rate limited", repos: [] };
    }

    return {
      total_count: data.total_count,
      repos: data.items.map((r) => ({
        name: r.name,
        full_name: r.full_name,
        description: r.description,
        stars: r.stargazers_count,
        forks: r.forks_count,
        language: r.language,
        url: r.html_url,
        owner: r.owner.login,
      })),
    };
  },
});
