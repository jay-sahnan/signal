# Driving Signal from Claude Code or Codex

Signal exposes its agent tools over MCP at `https://<your-app>/api/mcp`.
Sign in once in the browser; from then on your coding agent calls the same
tools the web chat uses, scoped to your account.

## Connect

    claude mcp add --transport http signal https://<your-app>/api/mcp
    codex mcp add signal --url https://<your-app>/api/mcp

Your client opens Clerk's sign-in page. Approve, and you are done.

## Operator setup (once per instance)

1. Supabase Dashboard: Settings: API: copy **JWT Secret** into `SUPABASE_JWT_SECRET`.
2. Clerk Dashboard: OAuth Applications: enable **Dynamic client registration**.
3. Deploy. No migration.

## Revoking access

Clerk Dashboard: Users: pick the user: OAuth authorizations.

## What is exposed

Every tool in the web chat, including sending and deleting. The daily send
cap, kill switch and ownership checks apply exactly as in the browser.
