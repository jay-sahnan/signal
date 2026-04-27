# Setup

The fastest path is `pnpm setup` — an interactive script that prompts for keys, starts local Supabase, and runs migrations. If you don't have a hosted Supabase project, just skip those prompts: after `supabase start`, the script auto-writes the local URL + keys into `.env.local`. You'll sign up for the first account once on first run; local Supabase has email confirmation disabled, so signup is instant.

This doc is the manual walkthrough for when the script doesn't fit your setup, or you want to understand each step.

## Prerequisites

| Tool         | Version | Why                                                               |
| ------------ | ------- | ----------------------------------------------------------------- |
| Node         | 20+     | Runtime                                                           |
| pnpm         | 10.x    | Package manager (run `corepack enable` to get the pinned version) |
| Docker       | 24+     | For local Supabase                                                |
| Supabase CLI | 2.30+   | Applies migrations, runs local Supabase                           |
| Git          | 2.30+   | —                                                                 |

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
corepack enable
pnpm install
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

## 4. Clerk (auth)

Signal uses [Clerk](https://clerk.com) for sign-in/sign-up. Free tier covers 10k MAU.

**Easiest path:** run `pnpm setup`, pick option [2], and the script walks you through every dashboard click. Manual steps below if you'd rather click through it yourself:

1. Sign up at [clerk.com](https://clerk.com) and create an application (any name).
2. **Configure → API Keys**: copy the publishable + secret keys into `.env.local`:
   ```
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   ```
3. **Configure → Integrations → Supabase**: click "Activate Supabase integration." This makes Clerk-issued JWTs include the `aud`/`role` claims Supabase needs.
4. Copy the Frontend API domain (under Domain, e.g. `your-app.clerk.accounts.dev`) into `.env.local`:
   ```
   CLERK_FRONTEND_API_DOMAIN=your-app.clerk.accounts.dev
   ```
5. **Hosted Supabase only**: in your Supabase dashboard, go to Authentication → Providers → "Clerk" and add the same Frontend API domain. Local Supabase reads the env var via `supabase/config.toml` automatically — no extra step.

**Keyless mode** (skip Clerk setup for now): leave the three env vars blank. Clerk auto-creates an ephemeral dev application on first dev-server load. Sign-in works, but RLS-protected reads return empty rows because Supabase can't validate the Clerk JWT yet — you'll see an amber banner in the app explaining how to fix it. Useful for "just kicking the tires."

## 5. Anthropic key

Get a key at [console.anthropic.com](https://console.anthropic.com) and paste into `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

At this point, you have enough to run `pnpm dev` and see the app boot.

## 6. Optional services

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

## 7. Run

```bash
pnpm dev
# → http://localhost:3000
```

On first run, visit http://localhost:3000 — Clerk's themed sign-in page renders. Click "Sign up" to create the first account. If you get stuck, check [Issues](../../issues) or [Discussions](../../discussions).

## 8. Running tests

```bash
pnpm lint          # ESLint
pnpm typecheck     # tsc --noEmit
pnpm test          # Vitest unit tests
pnpm test:e2e      # Playwright E2E (requires a running dev server + real DB)
```

E2E tests hit a real Supabase instance and share DB state — run them serially against a non-production project. They require:

- `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` for fixture setup/teardown
- `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` from a Clerk **test** instance (separate from prod) — `e2e/helpers.ts` mints test users via Clerk's Backend API
- `CLERK_FRONTEND_API_DOMAIN` so Supabase third-party auth validates the test JWTs

## Troubleshooting

**`supabase db reset` fails with connection refused** — Docker isn't running, or `supabase start` wasn't called first.

**Redirected to `/login` on a fresh install** — expected. Click "Sign up" to create the first account via Clerk.

**Amber "Keyless mode active" banner appears** — your Clerk env vars are blank. Run `pnpm setup` and pick option [2], or paste real keys into `.env.local` and restart the dev server.

**Dashboard is empty after signing in** — the Clerk JWT isn't being validated by Supabase. Confirm `CLERK_FRONTEND_API_DOMAIN` is set in `.env.local`, then run `supabase stop && supabase start` so `supabase/config.toml`'s env interpolation re-evaluates.

**Schema drift** — If you make DB changes locally, generate a new migration with `supabase db diff -f <name>` and commit it.
