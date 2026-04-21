# Architecture

A one-page map of what Signal is and how the pieces fit. For setup, see [`setup.md`](./setup.md). For signal-recipe authoring, see [`signal-authoring.md`](./signal-authoring.md).

## Shape

Signal is a Next.js App Router application backed by Supabase. There's no separate backend service — all server logic runs in Next.js route handlers and server components.

```
User ──▶ Next.js (App Router)
           │
           ├── UI (React 19 + Tailwind + shadcn/ui)
           ├── API routes (src/app/api/**)
           └── Server actions
                │
                ├──▶ Supabase (Postgres + Auth + RLS)
                ├──▶ Anthropic Claude (via Vercel AI SDK)
                ├──▶ Browserbase / Stagehand (web automation)
                ├──▶ AgentMail (outbound email + webhooks)
                ├──▶ QStash (scheduled jobs)
                └──▶ Exa / Google / Apify / GitHub (enrichment)
```

## Code layout

```
src/
  app/              # Next.js routes
    (auth)/         # login, signup
    api/            # route handlers (webhooks, AI chat, CSV import, etc.)
    campaigns/      # campaign workspace pages
    chat/           # chat-first UI
    outreach/       # sequence composer + review
    signals/        # signal management UI
    settings/       # user + team settings
    tracking/       # email open/click tracking endpoints
  components/       # shadcn-style UI components + feature components
  lib/
    supabase/       # client, server, middleware, admin clients
    tools/          # AI tool definitions (email, profile, sequences)
    services/       # integrations (agentmail, qstash, exa, browserbase, ...)
    signals/        # signal runner + recipe engine
    email-composition/
    types/          # shared TypeScript types
supabase/
  config.toml
  migrations/       # one consolidated initial schema
browserbase-functions/  # deployable Browserbase functions (env-probe, pricing-changes)
scripts/            # one-off dev utilities
e2e/                # Playwright tests (api, pages, knowledge-base, signals)
src/__tests__/      # Vitest unit tests
```

## Data model

The consolidated schema at `supabase/migrations/20260419000000_initial_schema.sql` defines the canonical data model. The main entities:

| Table                            | Purpose                                                |
| -------------------------------- | ------------------------------------------------------ |
| `campaigns`                      | Top-level container for a sales motion                 |
| `companies`, `people`            | Enriched entities surfaced or imported into a campaign |
| `signals`                        | Recipe-driven triggers watching for buying intent      |
| `signal_runs`, `signal_events`   | Execution history + emitted events                     |
| `chat_sessions`, `chat_messages` | Per-campaign chat history backing the workspace        |
| `sequences`, `sequence_steps`    | Multi-step outreach definitions                        |
| `email_drafts`, `email_events`   | Drafted emails + send/open/reply lifecycle             |
| `knowledge_base`                 | Shared user-authored notes, pinned in chat context     |
| `tracking_*`                     | Open / click pixel tracking                            |
| `api_usage`                      | Per-action cost attribution                            |
| `user_profiles`, `team_members`  | Multi-tenant auth scope                                |

Row-level security enforces tenant isolation on all user-scoped tables.

## Multi-tenancy

Signal is designed for **single-tenant self-hosting**. One Supabase project = one team.

Campaign-scoped tables (`campaigns`, `chats`, `email_drafts`, `campaign_organizations`, `campaign_people`, `campaign_signals`) are correctly scoped by `auth.uid()` — a user only ever sees their own campaigns and the contacts they've linked.

The enrichment pool is deliberately shared across all users on an instance: `organizations`, `people`, and `signal_results` have `USING (true)` RLS for SELECT. This lets a team's multiple users collaborate on the same enriched companies without re-paying for the same Exa / Apify lookups.

If you deploy Signal for multiple independent teams, **do not share a Supabase project between them** — they will see each other's enriched companies and contacts. Deploy one instance per team, or tighten the RLS on the shared tables to scope by an organization column before onboarding multi-tenant traffic.

## Key flows

### Chat → tool call → draft

1. User sends a message in a campaign's chat.
2. Route handler at `src/app/api/chat/route.ts` streams to Claude via `@ai-sdk/anthropic`.
3. Claude calls tools from `src/lib/tools/*` — company lookup, contact enrichment, sequence drafting.
4. Tool results stream back to the UI as structured cards.

### Signal run

1. QStash webhook at `src/app/api/outreach/process/route.ts` (and similar) fires on schedule.
2. `src/lib/signals/runner.ts` loads the recipe, dispatches steps (scraper / API / Stagehand), persists events.
3. New events raise contact priorities and surface in the campaign UI.

### Outreach send

1. User reviews draft sequences in `/outreach/review`.
2. Send request hits `src/app/api/outreach/send-now/route.ts`.
3. `src/lib/services/agentmail-service.ts` dispatches, stores `email_drafts` rows.
4. AgentMail webhook at `src/app/api/agentmail/webhook/route.ts` updates delivery / open / reply state.

## External service touchpoints

All integrations live under `src/lib/services/`. Each gates on its env var and fails with a descriptive error if unconfigured — nothing crashes the app if a secondary service is missing.

## Testing

- **Unit** (`src/__tests__/`, Vitest): tool shape contracts, recipe logic, differs, scrapers.
- **E2E** (`e2e/`, Playwright): API routes, page navigation, signal execution, knowledge-base. Run serially against a real Supabase instance.

## Adding a new signal type

See [`docs/signal-authoring.md`](./signal-authoring.md) for the full recipe-authoring guide.
