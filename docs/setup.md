# Setup

The fastest path is `npm run setup` — an interactive script that prompts for keys, starts local Supabase, and runs migrations. If you don't have a hosted Supabase project, just skip those prompts: after `supabase start`, the script auto-writes the local URL + keys into `.env.local`. You'll sign up for the first account once on first run; local Supabase has email confirmation disabled, so signup is instant.

This doc is the manual walkthrough for when the script doesn't fit your setup, or you want to understand each step.

## Prerequisites

| Tool         | Version   | Why                                     |
| ------------ | --------- | --------------------------------------- |
| Node         | 20+       | Runtime                                 |
| npm          | (bundled) | Package manager                         |
| Docker       | 24+       | For local Supabase                      |
| Supabase CLI | 2.30+     | Applies migrations, runs local Supabase |
| Git          | 2.30+     | —                                       |

Install the Supabase CLI:

```bash
# macOS
brew install supabase/tap/supabase

# Linux / Windows — see https://supabase.com/docs/guides/cli/getting-started
```

## 1. Clone and install

```bash
git clone https://github.com/jay-sahnan/signal.git
cd signal
npm install
```

## 2. Create env file

```bash
cp .env.example .env.local
```

Open `.env.local` in your editor. You'll fill this in as you go.

## 3. Supabase

You have two options.

### Option A — Local Supabase (recommended for dev)

```bash
supabase start
```

This boots Postgres, Auth, Storage, and the Studio UI in Docker. It prints a block of URLs and keys at the end — copy these into `.env.local`:

```
API URL:    →  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_URL
anon key:   →  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY, SUPABASE_ANON_KEY
service_role key: →  SUPABASE_SERVICE_ROLE_KEY
```

Then apply the schema:

```bash
supabase db reset
```

This runs `supabase/migrations/20260419000000_initial_schema.sql` against the local DB.

### Option B — Hosted Supabase

Create a project at [supabase.com](https://supabase.com/dashboard). From **Project Settings → API**, copy the URL and keys into `.env.local`.

Then apply the schema:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## 4. Anthropic key

Get a key at [console.anthropic.com](https://console.anthropic.com) and paste into `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

At this point, you have enough to run `npm run dev` and see the app boot.

## 5. Optional services

Every block in `.env.example` beyond the required ones is feature-gated. If you don't set a key, the feature that uses it will fail gracefully with a "not configured" message. Pick what you need:

| Service          | Unlocks                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| Browserbase      | Web scraping, YC scraper, hiring signals (uses your Anthropic key for Stagehand) |
| AgentMail        | Sending outreach emails + delivery/reply webhooks                                |
| QStash           | Scheduled signal runs                                                            |
| Exa              | Neural web search inside chat                                                    |
| Google API + CSE | Google Places enrichment                                                         |
| Apify            | LinkedIn + X enrichment                                                          |
| GitHub token     | GitHub-based signals (commits, releases)                                         |

Signup links live in `.env.example` next to each block.

## 6. Run

```bash
npm run dev
# → http://localhost:3000
```

On first run, visit http://localhost:3000 and you'll be redirected to `/login`. Click "Sign up" to create the first account — no email confirmation, you land in the app immediately. If you get stuck, check [Issues](../../issues) or [Discussions](../../discussions).

## 7. Running tests

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run test          # Vitest unit tests
npm run test:e2e      # Playwright E2E (requires a running dev server + real DB)
```

E2E tests hit a real Supabase instance and share DB state — run them serially against a non-production project. They require `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` for fixture setup/teardown.

## Troubleshooting

**`supabase db reset` fails with connection refused** — Docker isn't running, or `supabase start` wasn't called first.

**Redirected to `/login` on a fresh install** — expected. Click "Sign up" to create the first account. Local Supabase has `enable_confirmations = false` in `supabase/config.toml`, so no email is sent and you're signed in immediately.

**Schema drift** — If you make DB changes locally, generate a new migration with `supabase db diff -f <name>` and commit it.
