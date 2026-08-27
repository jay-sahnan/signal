# Remote MCP server: drive Signal from Claude Code and Codex

Date: 2026-08-26
Status: design approved, implementation plan pending

## Goal

Any Clerk user of a Signal instance can connect Claude Code or Codex to that
instance and call the same tools the web chat agent uses, as themselves, with
one command and a browser sign-in. No keys to copy, no local process to run.

```
claude mcp add --transport http signal https://<app>/api/mcp
codex mcp add signal --url https://<app>/api/mcp
```

## Decisions

| Question                        | Decision                                                                                 | Rejected                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Shape                           | Remote MCP server exposing the tools directly; the coding agent is the agent             | CLI wrapping /api/chat (agent driving agent); structured-command CLI (much more surface) |
| Hosting                         | New `/api/mcp` route on the deployed Next.js app                                         | Local stdio package; local process talking straight to Supabase                          |
| Auth                            | OAuth 2.1 via Clerk (`@clerk/mcp-tools` + `mcp-handler`), Dynamic Client Registration on | Personal API keys (phase 2 if needed)                                                    |
| Tool surface                    | Everything in `allTools`, send and delete included; UI-only plumbing excluded            | Read-only subset                                                                         |
| Raw DB access                   | None; app tools are enough                                                               | Read-only SQL tool                                                                       |
| Identity bridge to Supabase RLS | App-signed HS256 JWT with `SUPABASE_JWT_SECRET`                                          | Minting Clerk sessions server-side; proxying through /api/chat                           |

## Architecture

### Request path

```
Claude Code --Bearer oauth_token--> /api/mcp
  withMcpAuth -> auth({ acceptsToken: 'oauth_token' }) -> verifyClerkToken -> userId
  runWithIdentity({ userId, source: 'mcp' }, () => tool.execute(args))
    getSupabaseAndUser() checks AsyncLocalStorage first:
      identity present -> sign JWT { sub: userId, role: 'authenticated', exp: +10m }
                          with SUPABASE_JWT_SECRET, cached per userId
      otherwise        -> existing Clerk cookie path, unchanged
```

RLS already keys every policy on `requesting_user_id()` =
`auth.jwt() ->> 'sub'`, which is the Clerk user id, so the signed token lands
in exactly the same scope as a browser session.

### Why the bridge is needed

Every tool reaches the database through `getSupabaseAndUser()` in
`src/lib/supabase/server.ts`, which calls Clerk's request-scoped `auth()` and
mints a session JWT for Supabase. An OAuth access token has no session behind
it: `getToken()` returns null and RLS returns zero rows. Identity therefore
has to be injected around the tool call rather than read from the cookie.

### Files

New:

- `src/lib/auth/identity.ts`: `AsyncLocalStorage<{ userId; source }>`,
  `runWithIdentity`, `getCurrentUserId()`, `getCurrentSource()`.
- `src/lib/auth/supabase-jwt.ts`: sign and cache the HS256 token.
- `src/app/api/mcp/route.ts`: `createMcpHandler` registering `allTools`,
  wrapped in `withMcpAuth`; `maxDuration = 800`.
- `src/app/.well-known/oauth-protected-resource/route.ts` and
  `src/app/.well-known/oauth-authorization-server/route.ts` from
  `@clerk/mcp-tools/next`.

Changed:

- `src/lib/supabase/server.ts`: `createClient` and `getSupabaseAndUser`
  consult the identity store before Clerk. Token refresh and 401 retry
  machinery reused; only the token source changes.
- Eight tool sites that call Clerk `auth()` directly for `userId`
  (`campaign-tools`, `profile-tools`, `learning-tools` x3,
  `sender-fact-tools` x2, `signal-tools`) switch to `getCurrentUserId()`.
- `src/proxy.ts`: `/api/mcp(.*)` and `/.well-known/(.*)` become public
  routes; the bearer check happens inside the handler and a cookie redirect
  would break the OAuth handshake.
- `src/lib/services/cost-tracker.ts` and PostHog events carry
  `source: 'mcp' | 'web'`.
- `docs/setup.md`, `pnpm setup`: `SUPABASE_JWT_SECRET` and the Clerk
  "Dynamic client registration" toggle.

### Tool registration

One loop over `allTools`: each AI SDK tool already has a Zod `inputSchema`
and `execute`, so `server.tool(name, description, schema, handler)` needs no
per-tool code. Results are returned as a single text content block holding
the JSON the chat model sees today.

Exclusions (`MCP_EXCLUDE`): tools that exist only to drive the browser UI.
`openPage` stays but returns the URL as text instead of navigating.

### Long-running tools

`enrichCompanies`, `findContacts`, `scrapeJobListingsBatch` and similar can
run for minutes. The route uses `maxDuration = 800` like `/api/chat`. Tools
with a progress callback emit MCP progress notifications. Work queued through
the Postgres job scheduler returns a job id; a `getJobStatus` tool exists (or
is added) so the client can poll.

### Guardrails

Daily send cap, kill switch, Hunter just-in-time verification and the
ownership predicates in `src/lib/tools/ownership.ts` live inside the tools
and apply unchanged. The identity store carries `source` so future policy
(for example, no sends over MCP for a given user) has a hook.

### Errors

- Tool throws: MCP result with `isError: true` and the message; never a 500
  that drops the session.
- Invalid or expired bearer: 401 with `WWW-Authenticate` pointing at the
  resource metadata, so clients re-run OAuth instead of hanging.
- `SUPABASE_JWT_SECRET` unset: route answers 503 and logs FATAL, mirroring
  the existing `CLERK_FRONTEND_API_DOMAIN` warning.

### Multi-user

Nothing is user-specific. Every Clerk user of the instance adds the same URL
and lands in their own RLS scope. Self-hosters need one env var and one Clerk
toggle. Revocation is per client in Clerk's dashboard.

## Testing

- Unit: identity store; JWT claims, expiry, role; `getSupabaseAndUser`
  prefers MCP identity over cookie.
- Integration (vitest, local Supabase): sign a token for user A, call
  `listCampaigns` through the handler, assert only A's rows; user B sees none.
- Manual: `claude mcp add` against a preview deploy; run search, enrich,
  draft, send on a test contact.

## Deployment order

1. Set `SUPABASE_JWT_SECRET` in Vercel and enable Dynamic client registration
   in Clerk for prod.
2. Deploy. No migration is required.

## Out of scope

API keys, a CLI binary, raw SQL, per-tool OAuth scopes, org/team sharing.
Each can layer on without touching the identity design.

## References

- Clerk MCP server guide: https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server
- `@clerk/mcp-tools`: https://github.com/clerk/mcp-tools
- Example app: https://github.com/clerk/mcp-nextjs-example
