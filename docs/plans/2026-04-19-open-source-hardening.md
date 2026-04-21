# Open-Source Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the findings from the pre-publish code review so Signal is ship-ready for public release.

**Architecture:** The plan is split into two tracks. Track 1 is genuine ship-blockers — they fix real vulnerabilities or data-integrity bugs and must land before the first public commit. Track 2 is hardening — consistency, resilience, and follow-up that can land in the days after publication. Each task is scoped to a single commit so progress is easy to track and roll back.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), TypeScript, Vitest, Playwright.

**Verification during review:**

- `send-now/route.ts` was flagged CRITICAL but is actually fine — service-role fetch is immediately followed by ownership check before any side effect. Excluded.
- Ownership gaps on `enrich`, `enrich-company`, `refresh-scores`, `find-contacts`, `import-csv`, `chat/summarize` are mostly caught by RLS (`camp_orgs_select`, `camp_people_select`, `campaigns_select` are all scoped to `auth.uid()`). Defense-in-depth only — demoted to Track 2.

---

## TRACK 1 — Ship-blockers

### Task 1: Delete `collect-test/*` test-only routes

**Context:** `src/app/api/tracking/collect-test/start/route.ts:22` has zero auth and enqueues a Browserbase invocation + QStash message for any unauthenticated POST. Header comment even says _"Not QStash-signed; called directly by the test driver script."_ The test driver (`scripts/test-collect-flow.ts`) was already deleted in the open-source cleanup, so these routes have no caller.

**Files:**

- Delete: `src/app/api/tracking/collect-test/start/route.ts`
- Delete: `src/app/api/tracking/collect-test/route.ts`
- Delete: `src/app/api/tracking/collect-test/store.ts`
- Delete directory: `src/app/api/tracking/collect-test/` (after files removed)

**Step 1: Confirm no other caller**

Run: `rg -n "collect-test" /Users/jay/signal/src /Users/jay/signal/e2e /Users/jay/signal/scripts`
Expected: only references inside the `collect-test/` directory itself (internal imports between the three files).

**Step 2: Delete the routes**

```bash
rm -rf /Users/jay/signal/src/app/api/tracking/collect-test
```

**Step 3: Verify the app still builds**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx vitest run`
Expected: 88/88 passing (nothing was testing these routes).

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(api): remove unauthenticated collect-test endpoints"
```

---

### Task 2: Drop `_companies_deprecated` and `_contacts_deprecated` tables

**Context:** `supabase/migrations/20260419000000_initial_schema.sql:569-570` renames the legacy tables but never drops them. New deployers inherit two dead tables plus their RLS policy drops at lines 787–788. No code reads or writes them (verify in Step 1).

**Files:**

- Modify: `supabase/migrations/20260419000000_initial_schema.sql` — append `DROP TABLE` at the end of the migration (after the last existing statement, before EOF).

**Step 1: Confirm no code references the deprecated tables**

Run: `rg -n "_companies_deprecated|_contacts_deprecated" /Users/jay/signal/src`
Expected: no results.

**Step 2: Append the drops to the migration**

Find the end of the file. Append exactly:

```sql

-- ===========================================
-- Drop legacy renamed tables
-- ===========================================
-- The original `companies` and `contacts` tables were renamed during the
-- transition to the shared `organizations` / `people` pool. Data has been
-- backfilled; the renamed tables are no longer referenced anywhere in code.
drop table if exists _companies_deprecated cascade;
drop table if exists _contacts_deprecated cascade;
```

**Step 3: Verify the migration applies cleanly**

Run: `supabase db reset`
Expected: migration applies without error; `\dt` in `supabase db execute` shows no `_*_deprecated` tables.

(If the user doesn't have a local Supabase running, skip this and note it in the PR body for reviewer verification.)

**Step 4: Re-run e2e and unit tests**

Run: `npx vitest run`
Expected: 88/88 passing.

**Step 5: Commit**

```bash
git add supabase/migrations/20260419000000_initial_schema.sql
git commit -m "chore(db): drop legacy _companies_deprecated and _contacts_deprecated tables"
```

---

### Task 3: Add `ON DELETE` clause to `sent_emails.draft_id` FK

**Context:** `supabase/migrations/…:1004` — `draft_id uuid references email_drafts(id)` has no `ON DELETE` clause (default is `NO ACTION`). If a draft is deleted while a send row exists, the delete fails with a FK violation. The send log should persist as an audit trail even if the draft is removed, so `SET NULL` is the right choice.

**Files:**

- Modify: `supabase/migrations/20260419000000_initial_schema.sql:1004` — add `on delete set null`.

**Step 1: Apply the edit**

Replace line 1004:

```sql
  draft_id uuid references email_drafts(id),
```

with:

```sql
  draft_id uuid references email_drafts(id) on delete set null,
```

**Step 2: Verify migration still applies from scratch**

Run: `supabase db reset`
Expected: clean apply.

Run: `supabase db execute "insert into email_drafts (id, user_id, body) values (gen_random_uuid(), auth.uid(), 'test') returning id;"` — grab the id, then manually insert a `sent_emails` row referencing it, delete the draft, and confirm `sent_emails.draft_id` is now null.

(Optional if you trust the one-line change — the SQL is small.)

**Step 3: Commit**

```bash
git add supabase/migrations/20260419000000_initial_schema.sql
git commit -m "fix(db): set null on sent_emails.draft_id when a draft is deleted"
```

---

### Task 4: Document shared-table RLS as a single-tenant design

**Context:** `organizations`, `people`, `signal_results` have `USING (true)` RLS for SELECT (migration lines ~807–827). Comment says "shared enrichment pool" — deliberate, but a self-hoster who points multiple teams at the same instance will leak companies/contacts between them. No code change needed; just make this loud in the docs.

**Files:**

- Modify: `docs/architecture.md` — add a "Multi-tenancy" section after the data-model section.
- Modify: `README.md` — one sentence in the "What's in the box" area pointing readers at the doc.

**Step 1: Add section to `docs/architecture.md`**

Find the end of the data-model section and insert:

```markdown
## Multi-tenancy

Signal is designed for **single-tenant self-hosting**. One Supabase project = one team.

Signal intentionally shares the enrichment pool across all users on an instance:
`organizations`, `people`, and `signal_results` are readable by any authenticated user
(RLS: `USING (true)`). This lets a team's multiple users collaborate on the same
enriched companies without re-paying for the same Exa / Apify lookups.

If you deploy Signal for multiple independent teams, **do not share a Supabase
project between them** — they will see each other's enriched companies and
contacts. Deploy one instance per team, or tighten the RLS on the shared tables
to scope by an organization column before onboarding multi-tenant traffic.

Campaign-scoped tables (`campaigns`, `chats`, `email_drafts`, `campaign_organizations`,
`campaign_people`, etc.) are correctly scoped by `auth.uid()` — a user only ever
sees their own campaigns and the contacts they've linked.
```

**Step 2: Add the pointer sentence to `README.md`**

Under the "What's in the box" section, add:

```markdown
> Signal is designed for single-tenant self-hosting — one Supabase project per
> team. See [architecture.md](./docs/architecture.md#multi-tenancy) before
> deploying for multiple independent teams.
```

**Step 3: Commit**

```bash
git add docs/architecture.md README.md
git commit -m "docs: document shared-table RLS and single-tenant design"
```

---

## TRACK 2 — Post-publish hardening

These are genuine improvements but not exploitable today. Ship in follow-up PRs after public release.

### Task 5: Defense-in-depth ownership checks on write routes

**Context:** `enrich-company/route.ts:82`, `refresh-scores/route.ts`, `find-contacts/route.ts`, `import-csv/route.ts`, `chat/summarize/route.ts`, `enrich/route.ts` accept `campaignId`/`companyId`/`contactId` from the body. RLS catches cross-user access (verified against `camp_orgs_select`, `camp_people_select`, `campaigns_select` policies), so this is defense-in-depth — if RLS ever regresses, the routes still fail safely.

**Pattern to apply to each route** (exemplar: `outreach/send-now/route.ts:44-50`):

```typescript
const { data: campaign } = await supabase
  .from("campaigns")
  .select("user_id")
  .eq("id", campaignId)
  .single();

if (!campaign || campaign.user_id !== user.id) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

**Files, one commit per route:**

- Task 5a: `src/app/api/enrich-company/route.ts` — after line 88, before the company lookup.
- Task 5b: `src/app/api/refresh-scores/route.ts` — after `campaignId` validation.
- Task 5c: `src/app/api/find-contacts/route.ts` — same.
- Task 5d: `src/app/api/import-csv/route.ts` — same.
- Task 5e: `src/app/api/chat/summarize/route.ts` — add `.eq("user_id", user.id)` to the existing chat select.
- Task 5f: `src/app/api/enrich/route.ts` — fetch the person's linked campaign via `campaign_people`, confirm ownership.

**Per-route steps:**

1. Read the route, locate where `campaignId`/etc. is first trusted.
2. Insert the ownership check above that line.
3. Add a unit/e2e test: attempt the action with a different user's campaignId, expect 403. (Extend `e2e/api.routes.test.ts` — the file already has `createTestUser` / `authedFetch` infra.)
4. Run `npx vitest run` + `npm run test:e2e:api`.
5. Commit per route: `fix(api): scope <route> to campaign owner`.

---

### Task 6: `Promise.all` → `Promise.allSettled` in `real-spend`

**Context:** `src/lib/services/real-spend.ts:136` — one failing upstream (Anthropic admin or Apify) kills the whole cost dashboard fetch.

**Files:**

- Modify: `src/lib/services/real-spend.ts:136`

**Steps:**

1. Write failing test: mock one fetcher to reject; assert the other still returns its value. (`src/__tests__/real-spend.test.ts` — new file if one doesn't exist.)
2. Replace `Promise.all([a, b])` with `Promise.allSettled([a, b])`; map `fulfilled` → value, `rejected` → null.
3. Run test, expect PASS.
4. Commit: `fix(cost): use allSettled so one failing upstream does not blank the dashboard`.

---

### Task 7: Compile-time-safe recipe registry

**Context:** `src/lib/signals/recipes/index.ts` hand-lists recipes. Adding `src/lib/signals/recipes/new-thing.ts` but forgetting to add it to `RECIPES` fails only at runtime via `getRecipe(slug)`.

**Approach:** Replace the hand-list with a barrel import + `as const` tuple, and enforce at the type level that every recipe file's `slug` appears in the registry.

**Steps:**

1. Read `src/lib/signals/recipes/index.ts` and `src/lib/signals/recipes/pricing-changes.ts` to understand the shape.
2. Write the failing compile check: add a second recipe file (or a stub) with a unique slug; assert the registry compile-errors if the new file isn't re-exported.
3. Rewrite `index.ts` to glob or explicitly import all `recipes/*.ts` and assemble `RECIPES` as a typed record keyed by `slug`.
4. Add a unit test: `getRecipe('pricing-changes')` returns a defined object; `getRecipe('nonexistent')` throws a typed error.
5. `npx tsc --noEmit && npx vitest run` green.
6. Commit: `refactor(signals): registry is now compile-time-checked`.

---

### Task 8: Global timeout on Browserbase/Stagehand sessions

**Context:** `src/lib/services/yc-scraper.ts:85`, `hiring-scraper.ts:47`, `signals/runner.ts:103–130` — page-level timeouts exist but a hung `stagehand.init()` leaves the session billing.

**Steps:**

1. Add a `withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T>` helper at `src/lib/utils/timeout.ts` (promote from the duplicated one inside `exa-service.ts` / `google-places-service.ts`).
2. Wrap every `stagehand.init()` call in `withTimeout(init, 60_000, 'stagehand.init')`.
3. Ensure `finally { await stagehand.close(); }` exists at every top-level try.
4. Delete the duplicate helpers in `exa-service.ts:40–50` and `google-places-service.ts:36–46`; import the shared one.
5. `npx tsc --noEmit && npx vitest run` green.
6. Commit: `refactor(services): shared withTimeout; bound Stagehand init duration`.

---

### Task 9: Extract `status-styles` module

**Context:** `STATUS_COLORS` (dashboard/campaign-table), `OUTREACH_STYLES` (campaign/companies-list), `ReadinessBadge` (tracking/tracking-table) reinvent the same state→color+label map.

**Steps:**

1. Create `src/lib/status-styles.ts` exporting `campaignStatus`, `outreachStatus`, `trackingReadiness` maps with `{ color, label, icon? }`.
2. Replace each call site (~3 components) with imports from the new module.
3. Run `npx tsc --noEmit && npx vitest run`.
4. Visual check: `npm run dev`, click through the three pages, confirm status badges render identically.
5. Commit: `refactor(ui): centralize status-style maps`.

---

### Task 10: A11y fix — keyboard-accessible row expansion

**Context:** `src/components/contacts-table.tsx:102–104` has `<tr onClick>` with no keyboard handler.

**Steps:**

1. Add `tabIndex={0}`, `role="button"`, `aria-expanded={isExpanded}`, and an `onKeyDown` that fires on Enter/Space.
2. Alternative (cleaner): move the click target to a dedicated chevron `<button>` inside the first cell, keep the `<tr>` non-interactive.
3. Manually test: tab to row, hit Enter, confirm expansion; tab into expanded detail, tab out.
4. Commit: `fix(a11y): keyboard-navigable contact row expansion`.

---

## Verification (end-to-end)

After each task, the minimum verification bundle is:

```bash
npx tsc --noEmit
npx vitest run
rg -n "TODO\\|FIXME\\|XXX" <files-touched>   # no new TODOs left behind
```

After Track 1 is done, before the first public commit:

```bash
supabase db reset          # migration applies cleanly
npm run test:e2e           # requires dev server; run once
rg -n "collect-test\\|_deprecated" src supabase   # zero results
```

---

## Out of scope

- Rate limits / per-user spend caps on Claude/Exa/Browserbase calls. Genuine follow-up but scoped as its own design exercise — the right answer needs a decision on whether Signal ships with built-in guardrails or leaves that to the deployer. Track it as a GitHub issue after publication, not as a code task here.
- Tightening RLS on `organizations`/`people` to scope by organization (vs the current shared pool). Changes the product's collaboration story; design conversation before code.
- Additional test coverage on the enrichment, tracking, and CSV-import pipelines. Real gap, but best opened as "good first issue" tickets for contributors rather than one giant PR.
