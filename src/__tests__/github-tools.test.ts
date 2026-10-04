import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseFake, type FakeRow } from "./helpers/supabase-fake";

/**
 * The GitHub pipeline: stargazer collection and profile enrichment. The
 * failure this file guards hardest against is the stub overwrite: a stargazer
 * pass carries six fields, and letting it replace a stored full profile
 * destroys all GitHub grounding for drafting while looking freshly enriched.
 */

/** Routes GitHub API paths to canned responses. */
const routes = new Map<string, { status?: number; body: unknown }>();

function respond(path: string) {
  for (const [prefix, r] of routes) {
    if (path.includes(prefix)) {
      return {
        ok: (r.status ?? 200) < 400,
        status: r.status ?? 200,
        headers: { get: () => "5000" },
        json: async () => r.body,
      };
    }
  }
  throw new Error(`unrouted github fetch: ${path}`);
}

vi.mock("@/lib/fetch-with-timeout", () => ({
  fetchWithTimeout: async (url: string) => respond(url),
}));

let people: FakeRow[] = [];
let signals: FakeRow[] = [];
let signalResults: FakeRow[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () =>
    createSupabaseFake({
      tables: {
        people: () => people,
        signals: () => signals,
        signal_results: () => signalResults,
      },
    }),
  ),
}));

vi.mock("@/lib/services/knowledge-base", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/knowledge-base")>();
  return {
    ...actual,
    linkPersonToCampaign: vi.fn(async () => ({ id: "cp" })),
  };
});

import {
  fetchGitHubStargazers,
  enrichGitHubProfiles,
} from "@/lib/tools/github-tools";

const CAMPAIGN = "11111111-1111-1111-1111-111111111111";

function starPage(logins: string[]) {
  return logins.map((login) => ({
    starred_at: "2026-08-01T00:00:00Z",
    user: {
      login,
      avatar_url: `https://avatars.test/${login}`,
      html_url: `https://github.com/${login}`,
    },
  }));
}

beforeEach(() => {
  routes.clear();
  people = [];
  signals = [];
  signalResults = [];
});

describe("fetchGitHubStargazers", () => {
  const repo = (stars: number) => ({
    full_name: "acme/tool",
    description: "d",
    stargazers_count: stars,
    forks_count: 1,
    language: "TypeScript",
    html_url: "https://github.com/acme/tool",
  });

  it("does not let a stargazer stub overwrite a stored full profile", async () => {
    const richGithub = {
      username: "jane",
      profile_url: "https://github.com/jane",
      bio: "builds things",
      followers: 4200,
      top_repos: [{ name: "flagship", stars: 20000 }],
      fetched_at: "2026-07-01T00:00:00Z",
    };
    people = [
      {
        id: "p1",
        github_url: "https://github.com/jane",
        enrichment_data: { github: richGithub, news: ["kept"] },
        enrichment_status: "enriched",
        last_enriched_at: "2026-07-01T00:00:00Z",
        location: "SF",
      },
    ];
    routes.set("/repos/acme/tool/stargazers", { body: starPage(["jane"]) });
    routes.set("/repos/acme/tool", { body: repo(1) });

    await fetchGitHubStargazers.execute!(
      { owner: "acme", repo: "tool", count: 100 },
      {} as never,
    );

    const github = (people[0].enrichment_data as Record<string, unknown>)
      .github as Record<string, unknown>;
    expect(github.top_repos).toEqual([{ name: "flagship", stars: 20000 }]);
    expect(github.followers).toBe(4200);
    // The new signal fields still land.
    expect(github.starred_repo).toBe("acme/tool");
    // Lifecycle columns untouched: a stub is not an enrichment, and a fresh
    // stamp here made isRecentlyEnriched skip the person for 7 days.
    expect(people[0].enrichment_status).toBe("enriched");
    expect(people[0].last_enriched_at).toBe("2026-07-01T00:00:00Z");
    expect(github.fetched_at).toBe("2026-07-01T00:00:00Z");
    // and sibling top-level keys survive
    expect((people[0].enrichment_data as Record<string, unknown>).news).toEqual(
      ["kept"],
    );
  });

  it("fetches enough pages when the newest page is partial", async () => {
    // 150 stars: page 2 holds 50, page 1 holds 100. ceil(100/100)=1 page from
    // the end used to stop before page 1 and return 50 for a count of 100.
    routes.set("/repos/acme/tool/stargazers?per_page=100&page=2", {
      body: starPage(Array.from({ length: 50 }, (_, i) => `late${i}`)),
    });
    routes.set("/repos/acme/tool/stargazers?per_page=100&page=1", {
      body: starPage(Array.from({ length: 100 }, (_, i) => `early${i}`)),
    });
    routes.set("/repos/acme/tool", { body: repo(150) });

    const result = (await fetchGitHubStargazers.execute!(
      { owner: "acme", repo: "tool", count: 100 },
      {} as never,
    )) as { fetched: number };

    expect(result.fetched).toBe(100);
  });

  it("reports when signal tracking did not happen", async () => {
    // Empty signals table: the built-ins seed is missing (documented failure
    // mode). The tool used to claim full success while the campaign's signal
    // history silently omitted the run.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    routes.set("/repos/acme/tool/stargazers", { body: starPage(["jane"]) });
    routes.set("/repos/acme/tool", { body: repo(1) });

    const result = (await fetchGitHubStargazers.execute!(
      { owner: "acme", repo: "tool", count: 10, campaignId: CAMPAIGN },
      {} as never,
    )) as { signal_tracked?: boolean };

    expect(result.signal_tracked).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("records the signal when the seed exists", async () => {
    signals = [
      { id: "custom-signal", slug: "github-stargazers", is_builtin: false },
      { id: "sig-1", slug: "github-stargazers", is_builtin: true },
    ];
    routes.set("/repos/acme/tool/stargazers", { body: starPage(["jane"]) });
    routes.set("/repos/acme/tool", { body: repo(1) });

    const result = (await fetchGitHubStargazers.execute!(
      { owner: "acme", repo: "tool", count: 10, campaignId: CAMPAIGN },
      {} as never,
    )) as { signal_tracked?: boolean };

    expect(result.signal_tracked).toBe(true);
    expect(signalResults).toHaveLength(1);
    expect(signalResults[0].signal_id).toBe("sig-1");
  });
});

describe("enrichGitHubProfiles", () => {
  it("ranks top repos by stars itself: the API has no stars sort", async () => {
    routes.set("/users/jane/repos", {
      body: [
        {
          name: "aardvark-toy",
          full_name: "jane/aardvark-toy",
          description: null,
          html_url: "u",
          stargazers_count: 2,
          forks_count: 0,
          language: "Python",
          topics: [],
          fork: false,
          created_at: "",
          updated_at: "",
          pushed_at: "",
        },
        {
          name: "zeta-flagship",
          full_name: "jane/zeta-flagship",
          description: "the real work",
          html_url: "u2",
          stargazers_count: 20000,
          forks_count: 900,
          language: "TypeScript",
          topics: ["ai"],
          fork: false,
          created_at: "",
          updated_at: "",
          pushed_at: "",
        },
      ],
    });
    routes.set("/users/jane", {
      body: {
        login: "jane",
        html_url: "https://github.com/jane",
        avatar_url: "a",
        name: "Jane",
        email: null,
        twitter_username: null,
        bio: null,
        location: null,
      },
    });

    const result = (await enrichGitHubProfiles.execute!(
      { usernames: ["jane"] },
      {} as never,
    )) as unknown as {
      profiles: Array<{ top_repos: Array<{ name: string }> }>;
    };

    expect(result.profiles[0].top_repos[0].name).toBe("zeta-flagship");
  });
});
