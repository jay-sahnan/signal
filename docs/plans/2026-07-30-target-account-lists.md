# Target Account Lists Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Design rationale: `docs/plans/2026-07-30-target-account-lists-design.md` (local, gitignored by repo convention).

**Goal:** Users drop a target-account CSV into chat; the agent interviews them (who to reach, what's sold), triages the list against the ICP, enriches the top ~10% on approval, and flows into existing contact/outreach machinery — with lists stored as first-class owned data.

**Architecture:** Two new owner-scoped tables (`target_account_lists`, `target_accounts`) resolve rows to the global `organizations` pool at import. Scoring reuses `campaign_organizations.relevance_score/score_reason/status` (no parallel tier system). Prioritization is a chunked sonnet scorer gated on campaign ICP. Enrichment tranches run as a self-draining QStash chain (1–2 accounts/hop) over an `enrichAndFindContacts` service extracted from the enrich-company route. Chat upload parses client-side and POSTs JSON rows — never CSV into model context.

**Tech Stack:** Next.js 16 App Router, Supabase RLS (Clerk `requesting_user_id()`), QStash, Vercel AI SDK `generateObject` + zod, Vitest.

**Branch:** `feat/target-accounts` (off main @ 42f8a5a, which includes the Gmail transport AND the contact-data-quality work — lazy email verification, affiliation provenance, consolidated contact discovery).

**Re-verified 2026-07-31 against main @ 42f8a5a.** Four amendments vs the original draft:

1. Migration slot is now `20260801000002` (data-quality migrations took 20260801000000/1).
2. Task 5 shrank: contact-finding was already consolidated into `src/lib/services/contact-discovery.ts` — `findContactsForOrganization(supabase, {organizationId, campaignId, titles, numResults})` already takes a client param. Only `enrichOrganization` still needs extracting from the route.
3. Task 8's service composes `enrichOrganization` (extracted) + `findContactsForOrganization` (existing) under the admin client.
4. E2E expectations: discovered contact emails now arrive as `unchecked` by design (owner decision: discovery is free, Hunter verification happens just-in-time inside `claimAndSendDraft`, bounded by the daily send cap). Enrichment output includes affiliation provenance. The tranche flow is unchanged.

**Conventions the executor must follow (from the 2026-07-30 audits):**

- New tools: RLS `createClient()` from `@/lib/supabase/server`, explicit `campaignId`/`listId` zod inputs (tools do NOT read campaignId from context), register in `src/lib/tools/index.ts` barrel (telemetry wraps automatically).
- Never name anything `companyId` — use `organizationId` (elsewhere `companyId` means the campaign-link id).
- All CSV-derived text entering prompts goes through `wrapUntrusted`/`UNTRUSTED_NOTICE` (`src/lib/prompt-safety.ts`).
- LLM cost: `withAction("Verb: subject", …)` around route bodies AFTER auth; `trackUsage({service:"claude", operation, tokens, estimated_cost_usd: estimateClaudeCostFromUsage("sonnet"|"haiku", usage), campaign_id, user_id})` per chunk.
- Tests: vitest jsdom; `vi.hoisted` mocks; thenable `fakeSupabase(responses[])` pattern from `src/__tests__/outreach-sender.test.ts`.

---

### Task 1: Migration

**Files:**

- Create: `supabase/migrations/20260801000002_target_account_lists.sql`

**Step 1: Write it** (shape copied from `20260729000000_email_voice_profiles.sql` — transaction, lock timeouts, named policies, updated_at trigger):

```sql
-- Target account lists: first-class, user-owned uploads of companies.
-- A list is a lens over the global organizations pool: rows resolve to
-- organizations at import (domain-deduped), so enrichment/contacts/outreach
-- reuse existing machinery. Scores/qualification deliberately do NOT live
-- here — they belong to campaign_organizations (see design doc D1/D4).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists target_account_lists (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,           -- Clerk sub; no FK by convention
  name text not null,
  original_filename text,
  row_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger target_account_lists_updated_at
  before update on target_account_lists
  for each row execute function update_updated_at_column();

create table if not exists target_accounts (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references target_account_lists(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  raw jsonb not null default '{}'::jsonb,   -- original CSV row, verbatim
  enrich_requested_at timestamptz,          -- set when a tranche is approved
  created_at timestamptz not null default now(),
  unique (list_id, organization_id)
);

create index if not exists idx_target_accounts_list on target_accounts(list_id);
create index if not exists idx_target_accounts_org on target_accounts(organization_id);
-- The QStash processor's work query:
create index if not exists idx_target_accounts_enrich_queue
  on target_accounts(list_id, enrich_requested_at)
  where enrich_requested_at is not null;

alter table target_account_lists enable row level security;
create policy "target_account_lists_select" on target_account_lists
  for select to authenticated using (user_id = requesting_user_id());
create policy "target_account_lists_insert" on target_account_lists
  for insert to authenticated with check (user_id = requesting_user_id());
create policy "target_account_lists_update" on target_account_lists
  for update to authenticated using (user_id = requesting_user_id())
  with check (user_id = requesting_user_id());
create policy "target_account_lists_delete" on target_account_lists
  for delete to authenticated using (user_id = requesting_user_id());

alter table target_accounts enable row level security;
create policy "target_accounts_select" on target_accounts
  for select to authenticated using (
    exists (select 1 from target_account_lists l
            where l.id = target_accounts.list_id
              and l.user_id = requesting_user_id()));
create policy "target_accounts_insert" on target_accounts
  for insert to authenticated with check (
    exists (select 1 from target_account_lists l
            where l.id = target_accounts.list_id
              and l.user_id = requesting_user_id()));
create policy "target_accounts_update" on target_accounts
  for update to authenticated using (
    exists (select 1 from target_account_lists l
            where l.id = target_accounts.list_id
              and l.user_id = requesting_user_id()));
create policy "target_accounts_delete" on target_accounts
  for delete to authenticated using (
    exists (select 1 from target_account_lists l
            where l.id = target_accounts.list_id
              and l.user_id = requesting_user_id()));

commit;
```

**Step 2:** `supabase migration up` → applies. `psql "\d target_accounts"` shows the partial index. (Never `db reset` — wipes seeded signals.)

**Step 3:** Commit: `feat(db): target account lists tables`

---

### Task 2: Types

**Files:**

- Create: `src/lib/types/target-list.ts`

```ts
export interface TargetAccountList {
  id: string;
  user_id: string;
  name: string;
  original_filename: string | null;
  row_count: number;
  created_at: string;
  updated_at: string;
}

export interface TargetAccount {
  id: string;
  list_id: string;
  organization_id: string;
  raw: Record<string, string>;
  enrich_requested_at: string | null;
  created_at: string;
}

/** A parsed, column-mapped CSV row ready for import. */
export interface TargetAccountRow {
  name: string;
  domain?: string | null;
  url?: string | null;
  industry?: string | null;
  location?: string | null;
  description?: string | null;
  /** Present when the file is contact-per-row (e.g. Apollo/Clay exports). */
  person?: {
    name: string;
    title?: string | null;
    email?: string | null;
    linkedin_url?: string | null;
  } | null;
  /** Everything else from the original row, preserved verbatim. */
  extra?: Record<string, string>;
}
```

Commit with Task 3 (no behavior yet).

---

### Task 3: Shared CSV parsing module (lift from csv-upload.tsx) + LLM header fallback (TDD)

**Files:**

- Create: `src/lib/csv/company-csv.ts` (move `parseCSV`, `COLUMN_MAP`, `mapColumns` out of `src/components/campaign/csv-upload.tsx:30-169`; the component imports from here afterward — behavior identical)
- Create: `src/lib/csv/header-mapper.ts` (server-side Haiku fallback for unrecognized headers)
- Test: `src/__tests__/company-csv.test.ts`, `src/__tests__/header-mapper.test.ts`

**Step 1: Failing tests for the extraction** — exercise `parseCSV` (quoted fields, commas inside quotes, CRLF), `mapColumns` (aliases: `company_name→name`, `website→domain`, `hq→location`; first-column fallback to name; unmapped headers land in `extra`). Two behavior extensions vs today's component code:

1. Unmapped columns are collected into `extra` (today they're dropped; `csv-upload.tsx` ignores `extra`).
2. **Person-column detection** for contact-per-row exports (Apollo/Clay/CRM): aliases `first_name`+`last_name`/`full_name`/`contact name`→person.name, `title`/`job_title`/`role`→person.title, `email`/`work_email`/`contact email`→person.email, `linkedin`/`linkedin_url`/`person_linkedin`→person.linkedin_url. When person columns exist, each row carries `person`; company fields dedupe across rows at import. Disambiguation rule: a bare `name` column maps to the COMPANY when a separate company column exists, else to the company (companies-only files unchanged); a bare `email` column is the person's. Tests: contact-per-row file (3 rows, 2 companies) maps correctly; companies-only file yields `person: null` everywhere.

**Step 2:** Red. **Step 3:** Move code + add `extra` collection. **Step 4:** Green, plus `pnpm test src/__tests__/import-csv-batching.test.ts` still green (component unchanged behaviorally).

**Step 5: header-mapper** — pure prompt-wrapper, clone the department-classifier shape but `MODELS.LIGHT`:

```ts
// src/lib/csv/header-mapper.ts
// Given headers COLUMN_MAP didn't recognize plus 3 sample values each,
// ask Haiku to map them to name|domain|url|industry|location|description|ignore.
// Returns Record<header, CanonicalField>. Falls back to "ignore" on any error
// (permissive-fallback convention from relevance-filter.ts:93-97).
```

Schema: `z.object({ mappings: z.array(z.object({ header: z.string(), field: z.enum([...CANONICAL, "ignore"]) })) })`; prompt wraps headers+samples with `wrapUntrusted`; `trackUsage({service:"claude", operation:"csv-header-mapper", …, estimateClaudeCostFromUsage("haiku", usage)})`. Test with a mocked `ai.generateObject` (`vi.mock("ai")`): known aliases pass through without an LLM call (COLUMN_MAP first), only unknowns hit the mock, hallucinated headers dropped.

**Step 6:** Commit: `feat(csv): shared company CSV parser with LLM header fallback`

---

### Task 4: List API routes (TDD on the dedup/ownership core)

**Files:**

- Create: `src/app/api/target-lists/route.ts` (POST create + GET list-mine)
- Create: `src/app/api/target-lists/[id]/accounts/route.ts` (POST append batch)
- Create: `src/lib/services/target-lists.ts` (the logic, testable)
- Test: `src/__tests__/target-lists-service.test.ts`

**Service (the testable core):**

```ts
// src/lib/services/target-lists.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { findOrCreateOrganization } from "@/lib/services/knowledge-base";
import type { TargetAccountRow } from "@/lib/types/target-list";

export const MAX_ROWS_PER_REQUEST = 500; // mirror import-limits.ts

/**
 * Resolve rows to organizations (domain-deduped globally) and insert
 * target_accounts. Dedup within the list is by organization_id via the
 * unique constraint — on-conflict-do-nothing, counted as skipped.
 * Chunks of 10 like import-csv (route.ts:164-179).
 */
export async function appendAccountsToList(
  supabase: SupabaseClient,
  listId: string,
  rows: TargetAccountRow[],
): Promise<{ imported: number; skipped: number; failed: number }> { … }
```

Implementation notes for the executor: `findOrCreateOrganization` builds its own RLS client internally — call it as-is (the route is Clerk-authed); pass `source: "target_list"`. Insert `target_accounts` rows with `raw: {name, domain, …, ...extra}`; use `.upsert(..., { onConflict: "list_id,organization_id", ignoreDuplicates: true })` and count skips via returned rows vs input. After each batch, `update target_account_lists set row_count = row_count + imported` (read-modify-write is fine under one owner).

**Routes:** copy `import-csv/route.ts`'s skeleton exactly: `getSupabaseAndUser()` → 401; zod-parse body; 413 over `MAX_ROWS_PER_REQUEST`; ownership re-check (`list.user_id !== user.id → 403`) on the accounts route; PostHog `target_list_created` / `target_list_accounts_imported` events mirroring `csv_import_completed` (import-csv:181-192). `POST /api/target-lists` body: `{ name, original_filename? }` → returns the list row. No `withAction` (no LLM spend here).

**Tests (fakeSupabase):** append dedups within batch by resolved org; upsert carries `onConflict: "list_id,organization_id"`; row_count updated; 413 shape.

Commit: `feat(target-lists): create/append API with org resolution`

---

### Task 4b: Import people from contact-per-row files (TDD)

**Files:**

- Modify: `src/lib/services/target-lists.ts` (extend `appendAccountsToList`)
- Test: extend `src/__tests__/target-lists-service.test.ts`

When rows carry `person`, after resolving the org:

- `findOrCreatePerson` (knowledge-base.ts — dedup by linkedin_url, fallback name+org) with `organization_id`, `title`, `source: "target_list"`.
- Email: store on the person as the data-quality schema expects for a user-provided address — **`unchecked` verification status** (imported emails are free suggestions; Hunter proves at send). Executor: read `supabase/migrations/20260801000000_contact_data_quality.sql` and `src/lib/services/affiliation.ts` first and record affiliation provenance the same way the CSV/import path is expected to (`evidence: "csv_import"`-equivalent) — copy the convention, don't invent one.
- Return shape gains `peopleImported`. Multiple rows for one company must produce one org + N people (test this).
- NOT linked to any campaign yet — `linkTargetListToCampaign` (Task 6) additionally upserts `campaign_people` for imported people whose org is being linked (status `pending`, same ignore-duplicates pattern).

Tests: contact-per-row batch → 1 org, 3 people, dedup by linkedin_url on re-import; companies-only rows skip people entirely; link tool upserts campaign_people.

Commit: `feat(target-lists): import contacts from contact-per-row files`

---

### Task 5: Extract `company-enrichment` service from the enrich-company route

**Files:**

- Create: `src/lib/services/company-enrichment.ts`
- Modify: `src/app/api/enrich-company/route.ts` (becomes a thin wrapper)

Mechanical move, no behavior change — SMALLER than originally scoped: contact-finding already lives in `src/lib/services/contact-discovery.ts` (`findContactsForOrganization`, client-parameterized, added by the data-quality work). From `enrich-company/route.ts` move only:

- `enrichOrganization(...)` (route.ts:200) plus `getActiveSignalSlugs` (:26) and the `SIGNAL_SLUG_*` constants; fold in the thin `findContactsForCompany` wrapper (:165) — it just loads ICP titles and calls `findContactsForOrganization`.
- Every moved function takes an explicit `SupabaseClient` (they currently call `createClient()` internally — that breaks under the QStash admin client) and returns plain data, not `Response.json` (the route wraps).
- New exported entry point:

```ts
export async function enrichAndFindContacts(
  supabase: SupabaseClient, // RLS client from the route, admin from QStash
  organizationId: string,
  campaignId: string | null,
): Promise<{ enriched: boolean; contactsFound: number; errors: string[] }>;
```

Critical invariants to preserve (verify against the current file while moving): the 7-day `isRecentlyEnriched` skip still runs contact-finding; `withAction("Enrich company: …")` stays at the ROUTE level (and the QStash route adds its own) so cost attribution is unchanged; every internal `trackUsage` keeps its operation names. The route keeps its auth, link-id-vs-org-id resolution (:110-140), and response shape, then delegates.

Gate: `pnpm test && pnpm typecheck` green (no unit tests target the route internals today; this is a compile-and-suite gate). Commit: `refactor(enrich): extract enrichAndFindContacts service`

---

### Task 6: List agent tools (TDD)

**Files:**

- Create: `src/lib/tools/target-list-tools.ts`
- Modify: `src/lib/tools/index.ts` (register: `getTargetLists`, `getTargetList`, `linkTargetListToCampaign`, `prioritizeTargetAccounts` [Task 7], `enrichTargetAccounts` [Task 8])
- Test: `src/__tests__/target-list-tools.test.ts`

Three tools in this task (all `createClient()` RLS, zod inputs, description text that tells the model when to use them):

- `getTargetLists()` — lists mine, newest first, with row_count.
- `getTargetList({ listId })` — list meta + first 25 accounts (org name/domain + enrichment_status) + counts: total, enriched, enrich-queued. This is what the agent quotes progress from.
- `linkTargetListToCampaign({ listId, campaignId })` — loads all `target_accounts.organization_id` for the list (ownership via RLS), bulk-upserts `campaign_organizations` rows `{campaign_id, organization_id}` with `onConflict: "campaign_id,organization_id", ignoreDuplicates: true` in chunks of 500. Returns `{ linked, alreadyLinked }`. Do NOT loop `linkOrganizationToCampaign` per-row (N round-trips; audited phantom-membership caveat is fine here — creating `discovered/0` memberships is exactly the intent, they get scored next).

Tests: link upsert carries the right onConflict; idempotent second call reports alreadyLinked; getTargetList count shape.

Commit: `feat(agent): target list tools — get, link to campaign`

---

### Task 7: `prioritizeTargetAccounts` — scorer service + tool (TDD)

**Files:**

- Create: `src/lib/services/target-account-scorer.ts`
- Modify: `src/lib/tools/target-list-tools.ts`
- Test: `src/__tests__/target-account-scorer.test.ts`

**Service** — clone `department-classifier.ts` structurally (CHUNK_SIZE 25, id-keyed schema, drop hallucinated ids) and `refresh-scores/route.ts:139-176` for the rubric shape:

```ts
export async function scoreTargetAccounts(input: {
  campaign: { id: string; name: string; icp: CampaignIcp; offering: unknown };
  accounts: Array<{
    organizationId: string;
    name: string;
    domain: string | null;
    industry: string | null;
    location: string | null;
    raw: Record<string, string>;
  }>;
  userId: string;
}): Promise<Array<{ organizationId: string; score: number; reason: string }>>;
```

- `MODELS.STRUCTURED` (sonnet), `providerOptions.anthropic.cacheControl: {type:"ephemeral"}` on the rubric block, `llmTimeout()` abort signal.
- Prompt: ICP + offering (trusted) above; account rows via `wrapUntrusted` below; explicit bands mirroring the system-prompt rubric — 8-10 strong ICP fit, 6-7 plausible, ≤5 weak; "score from the base data given; do not invent facts; reason ≤ 140 chars".
- `trackUsage({service:"claude", operation:"prioritize-target-accounts", …, campaign_id, user_id})` per chunk.

**Tool** `prioritizeTargetAccounts({ listId, campaignId, topFraction = 0.1 })`:

1. **Hard gate:** load campaign; if `!campaign.icp?.targetTitles?.length` → return `{ error: "This campaign has no ICP yet. Interview the user (who do they want to reach? what are they selling?) and call saveCampaign first." }` — mirror the `needsVoice` gate wording style.
2. Require the list linked (count `campaign_organizations` for the list's orgs; if none, tell the model to call `linkTargetListToCampaign`).
3. Score ONLY accounts not already scored (`relevance_score = 0 or null`) so re-runs are cheap; write per-org: `campaign_organizations.relevance_score, score_reason, status: score >= 6 ? "qualified" : "disqualified"` (existing rubric).
4. Return `{ scored, topSlice: [{organizationId, name, score, reason}...ceil(total*topFraction)], estimatedEnrichCostUsd: slice.length * 0.08, note }` — the agent presents this and asks for approval; the tool description says so explicitly ("NEVER call enrichTargetAccounts without the user approving the quoted cost").

Tests: no-ICP gate returns error without any LLM call; chunking (26 accounts → 2 calls with mocked `generateObject`); writes keyed by organizationId; hallucinated org ids from the model are dropped; already-scored rows excluded.

Commit: `feat(agent): prioritize target accounts against campaign ICP`

---

### Task 8: Enrichment tranche — tool + QStash chain route (TDD on the pure picker)

**Files:**

- Create: `src/app/api/target-lists/process/route.ts`
- Modify: `src/lib/tools/target-list-tools.ts` (add `enrichTargetAccounts`)
- Modify: `src/proxy.ts` (add `"/api/target-lists/process(.*)"` to public routes — explicit path, not a wildcard prefix)
- Test: `src/__tests__/target-list-process.test.ts`

**Tool** `enrichTargetAccounts({ listId, campaignId, organizationIds, skipContactFinding = false })`:

- `skipContactFinding` is for accounts whose imported contacts already match the ICP — the agent decides per tranche (it can split accounts across two calls). The process route passes it through to skip `findContactsForOrganization` and only run company enrichment.

- RLS-verify the list is mine and orgs belong to it; stamp `enrich_requested_at = now()` on those `target_accounts`; publish ONE QStash message `{ listId, campaignId, userId }` to `getBaseUrl() + "/api/target-lists/process"`; return `{ queued: n, note: "Enrichment runs in the background (~1 min/company). Ask me for progress." }`.
- If QStash env is missing (`getQStashClient` throws), return a clear error naming the integration — don't fall back to inline enrichment.

**Route** (QStash-signed, admin client, `maxDuration = 120`, `runtime` default node):

```ts
const BATCH_PER_INVOCATION = 2;

export async function POST(request: Request) {
  let payload; // verifyQStashSignature<{listId; campaignId; userId}> — 401 on throw, 400 on null
  const supabase = getAdminClient();
  const work = await pickEnrichBatch(supabase, payload.listId, BATCH_PER_INVOCATION);
  for (const account of work) {
    try {
      await withAction(`Enrich target account: ${account.orgName}`, () =>
        enrichAndFindContacts(supabase, account.organizationId, payload.campaignId));
    } catch (err) {
      console.error(`[target-lists/process] enrich failed for org ${account.organizationId}:`, err);
      // org enrichment_status stays 'pending'/'failed'; do not retry here —
      // clear enrich_requested_at so the chain can't loop on a poison row
      await supabase.from("target_accounts").update({ enrich_requested_at: null })
        .eq("list_id", payload.listId).eq("organization_id", account.organizationId);
    }
  }
  const remaining = await countRemaining(supabase, payload.listId);
  if (remaining > 0) {
    await getQStashClient().publishJSON({ url: …same route…, body: payload });
  }
  return NextResponse.json({ processed: work.length, remaining });
}
```

`pickEnrichBatch` (exported, pure-ish, unit-tested with fakeSupabase): `target_accounts` where `list_id`, `enrich_requested_at not null`, joined org `enrichment_status = 'pending'`, oldest `enrich_requested_at` first, limit N. Note the join filter means already-enriched orgs (shared pool) drain instantly without spend — desired. `countRemaining` = same filters, count only.

Tests: picker query shape (filters + limit); poison-row clears `enrich_requested_at`; re-publish only when remaining > 0 (mock QStash client); 401 pathway via mocked `verifyQStashSignature`.

Commit: `feat(target-lists): background enrichment chain via QStash`

---

### Task 9: Chat upload intercept

**Files:**

- Modify: `src/app/chat/[id]/page.tsx:137-140` (replace `onCsvUpload`)
- Modify: `src/components/chat/chat-input.tsx:66-82` (add a 5 MB size guard + toast; keep `readAsText`)

New `onCsvUpload`: parse with `parseCSV` + `mapColumns` from `@/lib/csv/company-csv`; if unmapped headers exist, POST them to the header-mapper via the accounts payload (server maps; client stays dumb — put unmapped columns in `extra` and let the server run header-mapper once per import when `extra` keys look canonical-ish; simplest: server-side in `appendAccountsToList` when `rows[0].extra` present). Create list (`POST /api/target-lists` with filename), append in 500-row batches with a progress toast (`sonner`), then:

```ts
sendMessage(
  {
    text: `I've uploaded a target account list "${fileName}" — ${imported} companies imported (${skipped} duplicates skipped), list ID ${listId}. Please help me work this list.`,
  },
  requestOptions,
);
```

Failure paths: partial batch failure → still send the message with accurate counts + "some rows failed"; total failure → toast, no message. No test file (client glue); covered by manual E2E.

Commit: `feat(chat): CSV upload creates a target list instead of pasting into context`

---

### Task 10: System prompt — the target-list pipeline

**Files:**

- Modify: `src/lib/system-prompt.ts` (new subsection near the pipeline block at :90-101)

Add (adjust wording to the file's voice):

```
### Target account lists
When the user uploads a target account list (you'll see "list ID ..."):
1. If no campaign exists or the campaign has no ICP/offering: interview the
   user first — who do they want to reach (titles/personas)? what are they
   selling? Keep it to 2-3 questions, then saveCampaign.
2. linkTargetListToCampaign, then prioritizeTargetAccounts. Present the top
   slice with scores and the quoted enrichment cost, and ASK before enriching.
3. On approval, enrichTargetAccounts. It runs in the background — check
   progress with getTargetList when asked; don't poll in a loop.
4. After enrichment: contacts were auto-found for qualified accounts. Apply
   the coverage check (below) before drafting outreach.
5. If the upload included contacts: compare imported titles to the ICP before
   enriching. Skip contact-finding (skipContactFinding: true) for accounts
   whose imported contacts already match — tell the user what that saves.
   Apply the coverage check where imported contacts look thin.
6. "Do more" = prioritize/enrich the next slice. Never enrich the whole list
   unprompted.
```

Gate: `pnpm test src/__tests__/email-base-prompt.test.ts` (prompt-length budget test) still green — if the budget trips, tighten wording, don't raise the budget.

Commit: `feat(prompt): target-account-list pipeline guidance`

---

### Task 11: Full sweep + manual E2E

1. `pnpm typecheck && pnpm lint && pnpm test` — all green.
2. Manual E2E (`pnpm dev`): drop a real messy CSV (odd headers, quoted commas, dupes) into chat → list receipt message; agent interviews → saveCampaign; prioritize → top-slice + cost quote; approve → QStash chain enriches (watch `target_accounts`/`organizations` rows); `getTargetList` progress mid-run; contacts appear on qualified accounts; draft one email end-to-end.
3. Ops note for PR body: QStash must be configured; the process route is self-chaining (no schedule needed).

Commit: `docs: target-lists plan as built` + push + PR.
