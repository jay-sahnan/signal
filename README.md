<div align="center">

<!-- Drop your logo at public/signal-logo.png (or .svg) and reference it here -->
<!-- <img src="./public/signal-logo.png" alt="Signal" width="140" /> -->

# Signal

### Open-source AI sales intelligence and outreach automation.

**The open alternative to Clay, Apollo, and Outreach — run it on your own keys.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./.github/CONTRIBUTING.md)
[![Built with Claude](https://img.shields.io/badge/Built%20with-Claude-d97757.svg)](https://www.anthropic.com/claude)
[![Stars](https://img.shields.io/github/stars/jay-sahnan/signal?style=social)](https://github.com/jay-sahnan/signal/stargazers)

🌐 [Website](https://github.com/jay-sahnan/signal) &nbsp;·&nbsp;
📚 [Docs](./docs) &nbsp;·&nbsp;
🏗️ [Architecture](./docs/architecture.md) &nbsp;·&nbsp;
⚡ [Quick start](#-quick-start) &nbsp;·&nbsp;
💬 [Discussions](../../discussions)

<br />

<!-- Drop a hero screenshot or GIF at docs/assets/hero.png and uncomment: -->
<!-- <img src="./docs/assets/hero.png" alt="Signal workspace" width="860" /> -->

</div>

---

Signal watches the web for buying signals (hiring changes, funding news, product launches, review shifts), enriches the companies and contacts behind them, drafts personalized outreach, and runs multi-step email sequences — all from a single chat-first workspace.

It's built for teams that want a CRM-adjacent tool they can read, fork, self-host, and extend. Instead of paying per seat for a black-box SaaS, run Signal on your own Supabase + Anthropic keys and own the pipeline end to end.

> 🧪 Signal is designed for single-tenant self-hosting — one Supabase project per team. See [architecture.md](./docs/architecture.md#multi-tenancy) before deploying for multiple independent teams.

> ⚠️ **Upgrading from a pre-Clerk version?** Auth has migrated from Supabase Auth to Clerk (Supabase remains the data layer). **Take a `pg_dump` first — this migration is destructive and not reversible.** It **wipes all user-owned data** (`campaigns`, `chats`, `user_profile`, `api_usage`, `user_settings`, `email_drafts`, `sent_emails`, `sequences`, plus user-authored `email_skills`) — old Supabase user UUIDs don't map to Clerk IDs. Built-in seed data and shared pools (`organizations`, `people`, `signals`) survive. Sign up for a free Clerk account ([10k MAU free](https://clerk.com/pricing)) and run `pnpm setup` to wire it up. See [docs/setup.md § Clerk](./docs/setup.md#4-clerk-auth) and [`supabase/migrations/20260427000000_clerk_auth_migration.sql`](./supabase/migrations/20260427000000_clerk_auth_migration.sql) if you need a custom backfill.

<br />

## ✨ Features

- 🛰️ **Signals engine** — authorable "recipes" that watch companies and surface buying triggers.
- 💬 **Campaign workspace** — chat-driven interface backed by Claude to research, shortlist, and draft.
- 🔎 **Contact enrichment** — pulls LinkedIn, GitHub, and company pages into a single profile.
- ✉️ **Outreach sequences** — multi-step emails via AgentMail with open / reply tracking.
- 🤖 **Browser automation** — Browserbase + Stagehand for the long tail of sites without APIs.
- 🔐 **Own your data** — Postgres + RLS on your Supabase; bring your own LLM keys.

<!-- Drop product GIFs here to mimic Postiz's feature grid. Example:
<div align="center">
  <img src="./docs/assets/signals.gif" width="48%" />
  <img src="./docs/assets/workspace.gif" width="48%" />
  <img src="./docs/assets/sequences.gif" width="48%" />
  <img src="./docs/assets/enrichment.gif" width="48%" />
</div>
-->

<br />

## 🛠️ Tech stack

- **Framework** — Next.js 16 (App Router) + React 19 + TypeScript
- **Database** — Supabase (Postgres + Auth + RLS)
- **AI** — Anthropic Claude via `@ai-sdk/anthropic` and the Vercel AI SDK
- **Automation** — Browserbase + Stagehand for browser tasks
- **Email** — AgentMail for send / reply / open tracking
- **Jobs** — QStash (Upstash) for scheduled signal runs
- **UI** — Tailwind CSS 4, shadcn/ui
- **Testing** — Vitest, Playwright

<br />

## 🚀 Quick start

You'll need **Node 20+**, **Docker**, the **Supabase CLI**, a **Supabase project** (hosted or local), and an **Anthropic API key**.

```bash
git clone https://github.com/jay-sahnan/signal.git
cd signal
corepack enable      # activates the pinned pnpm version
pnpm install
pnpm setup           # interactive: prompts for required keys, runs migrations
pnpm dev             # http://localhost:3000
```

Prefer to configure by hand? Follow [`docs/setup.md`](./docs/setup.md).

<br />

## 🐳 Self-host with Docker

```bash
cp .env.example .env
# fill in SUPABASE_URL + ANTHROPIC_API_KEY at minimum
docker compose up -d
```

Signal does not bundle Supabase in the compose file — bring your own (hosted Supabase project or local `supabase start`). See [`docs/setup.md`](./docs/setup.md) for the full walkthrough.

<br />

## 🤝 Contributing

Issues and PRs welcome. Start with [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md). AI-assisted PRs are fine — we build with Claude ourselves.

Looking for somewhere to start? Filter issues by [`good first issue`](../../labels/good%20first%20issue).

<br />

## 💬 Community

- 🐛 [Issues](../../issues) — bug reports and feature requests
- 💡 [Discussions](../../discussions) — questions, ideas, show & tell
- 🔒 [Security](./.github/SECURITY.md) — vulnerability disclosure

<br />

<br /><br />

## 📄 License

[AGPL-3.0](./LICENSE) with an optional enterprise carve-out for files explicitly tagged. See the license file for details.
