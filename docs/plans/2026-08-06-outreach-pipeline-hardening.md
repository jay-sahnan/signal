# Outreach Pipeline Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 186 verified findings (25 from the targeted review + 161 from the full line-by-line sweep) as a sequenced series of small PRs, then run the one-time prod data repairs the bugs have already caused.

**Architecture:** Findings cluster around shared mutable state: five status state machines (`sequence_enrollments.status`, `email_drafts.status/review_status`, `campaign_people.outreach_status`, `sent_emails.status`, `enrichment_status`), the jobs table consumed by Vercel crons, and prompt contracts fed to the composer. Each cluster below is one PR that fixes every finding touching its state, in dependency order. Cross-cutting mechanical sweeps (error surfacing, apiFetch) land last so they never conflict with state-specific PRs.

**Tech Stack:** Next.js App Router, Supabase (PostgREST + RLS), Clerk, Vercel AI SDK (`generateObject`/`streamText`), Vercel cron jobs, vitest + testing-library.

**Companion doc:** `2026-08-06-outreach-hardening-findings.md` holds the full 161-finding inventory (summary, failure scenario, verified evidence, exact file:line for every item). Finding references below like `F:outreach-sender.ts:645` resolve there; `K1`-`K25` are the earlier targeted-review findings, catalogued at the end of this file.

---

## Ground rules (read before every PR)

1. **One fresh PR per cluster.** Jay merges PRs within minutes; never push follow-up commits to an open PR: open a new one.
2. **Deploy order for the two migration-bearing clusters:** deploy code FIRST, then run the manual `supabase db push` against prod (migrate.yaml secrets are unset; prod migrations are always manual). Crons go dead if a migration lands before the code that tolerates it. Only PR-7 (claim_jobs RPC) and possibly PR-15 (orgs_delete RLS) carry migrations; everything else is code-only.
3. **Prod data repairs run against remote Supabase** (Jay tests against production). Each repair in the runbook names the code fix that must be LIVE first: running a repair early lets un-fixed code re-corrupt the rows.
4. **Lint:** no em dashes in any string literal (tool descriptions, errors, toasts): use colons. Every `generateObject` schema wraps in `apiSafeSchema` and bounded Zod.
5. **TDD:** every task = failing test first, then the fix, then `npx vitest run <file>` green, then commit. Run `npx tsc --noEmit` and `npm run lint` before each PR.
6. **Owner decisions that constrain fixes:** lazy email verification stays (discovery stores free `unchecked` suggestions; Hunter spends only in claimAndSendDraft). Signals are agent actions end-to-end, not alerts: fixes must preserve full-pipeline behavior.

---

## Wave 0: live-harm and security (ship this week, in this order)

### PR-1: stop emailing people who replied (reply/bounce pipeline)

**Findings:** K3, K20, F:email-tracking.ts:68, F:outreach-process.ts:598, F:email-classify.ts:90, F:reply-backfill.ts:110, F:email-test.ts:90
**Files:** `src/lib/services/outreach-sender.ts`, `src/lib/services/email-tracking.ts`, `src/lib/jobs/executors/email-classify.ts`, `src/lib/jobs/executors/email-track.ts`, `src/lib/jobs/executors/reply-backfill.ts`
**Gates repairs:** 3, 7

#### Task 1.1: claimAndSendDraft must never downgrade a terminal outreach_status

**Step 1: failing test** in `src/__tests__/outreach-sender-status.test.ts`: mock supabase; seed `campaign_people.outreach_status='replied'`; run the post-send status write; assert the update is conditional (uses `.not("outreach_status", "in", ...)` / filtered update) and a `replied` row stays `replied`.

**Step 2: run** `npx vitest run src/__tests__/outreach-sender-status.test.ts` (FAIL: unconditional update).

**Step 3: implement** at `outreach-sender.ts:597-602`: make the write monotonic:

```ts
// "sent" may only overwrite pre-send states. A reply or bounce recorded
// between draft and send must survive the send bookkeeping: downgrading
// replied -> sent is what kept follow-ups going to live conversations.
await supabase
  .from("campaign_people")
  .update({ outreach_status: "sent" })
  .eq("id", draft.campaign_people_id)
  .not(
    "outreach_status",
    "in",
    '("replied","bounced","complained","unsubscribed")',
  );
```

**Step 4:** test green. **Step 5:** commit `fix(sender): never downgrade replied/bounced outreach_status on send`.

#### Task 1.2: send-now and sendBulkEmails refuse recipients who replied

Failing test first: `/api/outreach/send-now` returns 409 `blocker:"replied"` when `campaign_people.outreach_status='replied'`; same guard in `sendBulkEmails` and the agent `sendEmail` tool. Implement by loading `outreach_status` alongside the existing checks. Commit separately.

#### Task 1.3: email-tracking writes campaign_people before sent_emails stamp

`F:email-tracking.ts:68`: the monotonic ladder compares against `sent_emails.status` and stamps it BEFORE `campaign_people` is updated; a crash between the two writes loses the reply forever (re-polls see the stamped row and skip). Reorder: write `campaign_people.outreach_status` first, stamp `sent_emails` last. Test: simulate failure after first write; a re-run must retry the second.

#### Task 1.4: email-classify upserts suppression before stamping intent

`F:email-classify.ts:90`: intent is stamped on `email_replies` first; if the `outreach_suppressions` upsert then fails, the row leaves the scan window and the suppression is lost forever (compliance risk). Reorder suppress-first; stamp intent only after the upsert succeeds. Test both orders.

#### Task 1.5: surface the swallowed errors in this pipeline

K20 (`email-track.ts:76`) and `F:reply-backfill.ts:110`: distinguish query-error from empty; log and `failJob` instead of reporting a clean run. Test: error result -> job marked failed with reason.

### PR-2: stop duplicate sends from email-cleanup (deliverability)

**Findings:** F:email-cleanup.ts:42, K5 (advance half), F:outreach-sender.ts:645
**Files:** `src/lib/jobs/executors/email-cleanup.ts`, `src/lib/services/outreach-sender.ts`
**Gates repairs:** 2, 5

- `email-cleanup.ts:42` resets a stuck `queued` draft to `draft` even when a `sent_emails` row proves the email was delivered: the next cron re-sends a real email to a real prospect. Failing test: queued draft + existing sent_emails row -> cleanup must mark `sent`, not `draft`.
- K5 completion: when cleanup marks a draft `sent`, also advance the enrollment (`current_step`, `next_send_at`) and set `campaign_people.outreach_status='sent'`, reusing `advanceEnrollmentAfterSend`. Test: cleaned-up enrollment sends step 2 on the next followups run instead of erroring forever.
- `F:outreach-sender.ts:645`: `advanceEnrollmentAfterSend` must distinguish "no next step" (complete the enrollment) from "step query failed" (leave for retry); today both silently complete.

### PR-3: cross-tenant prompt injection via community signals + SSRF pin

**Findings:** F:signals/page.tsx:65,82,138,157, F:campaign-signals-popover.tsx:50, F:signals.ts:17, F:safe-fetch.ts:230
**Files:** `src/app/signals/page.tsx`, `src/lib/signals.ts`, `src/components/signals/campaign-signals-popover.tsx`, `src/lib/safe-fetch.ts`

- Community-authored signal text flows into the agent's system prompt un-fenced, and the agent holds send tools: a hostile public signal is a prompt-injection channel. Fence every non-own-signal string through `wrapUntrusted` before it reaches `getActiveSignals`/`openAgentWith`; gate the Edit path to `created_by = user`. Tests: fenced output contains the untrusted wrapper; foreign signal edit 403s.
- `safe-fetch.ts:230`: `assertPublicUrl` resolves DNS then fetches by hostname: a rebinding attacker passes the check and the fetch hits an internal IP. Pin the resolved IP via a custom `lookup` on the fetch agent. Test with a mock resolver that flips answers between calls.

### PR-4: review-page edits must not destroy links; retarget must not silently fail

**Findings:** F:review/page.tsx:373, F:review/page.tsx:32, F:companies-list.tsx:485
**Gates repair:** 17

- Subject-only edits currently rewrite `body_html` through the lossy `htmlToPlain -> plainToHtml` round trip, stripping every `<a href>` from emails that then get sent (the composer legitimately emits anchors). Failing test: draft with anchor, subject-only edit -> `body_html` update payload must omit body fields (only write what changed). Body edits still round-trip (documented lossy behavior for actual body changes: acceptable, the user saw the plain text they edited).
- `companies-list.tsx:485` email retarget swallows its update error: surface it (toast + keep dialog open).

---

## Wave 1: the sequence-enrollment state machine (biggest cluster, one PR)

### PR-5: enrollments always reach a send or a terminal state

**Findings:** K2, K4, K23, F:sequence-tools.ts:163, F:outreach-process.ts:544, F:outreach-process.ts:93, F:outreach-sender.ts:743, F:email-tools.ts:1017, F:ready-to-send-hero.tsx:49, plus the cluster's remaining items (see appendix cluster "Sequence enrollment send state machine")
**Files:** `src/lib/tools/sequence-tools.ts`, `src/lib/jobs/executors/outreach-process.ts`, `src/lib/services/outreach-sender.ts`, `src/lib/tools/email-tools.ts`, `src/components/outreach/ready-to-send-hero.tsx`, `src/app/api/outreach/send-now/route.ts`
**Gates repairs:** 1, 2, 4, 6
**Internal order matters:** server-side guards (tasks 5.1-5.4) before UI changes (5.6-5.7).

#### Task 5.1: sends respect next_send_at

Neither `sendApprovedDraft` nor `/api/outreach/send-now` checks `enrollment.next_send_at`; the ready-to-send hero's sequential "Send all" can deliver step 2 seconds after step 1 (F:ready-to-send-hero.tsx:49). Failing test: enrollment advanced to step 2 with `next_send_at` in the future -> send-now returns 409 `blocker:"not_due"`; sendApprovedDraft refuses unless explicitly overridden (`{ignoreSchedule:true}` for the user's explicit single-draft "Send now", which is an intentional human override).

#### Task 5.2: signal-triggered sequences wait for the signal

`F:sequence-tools.ts:163` + `F:outreach-process.ts:93`: signal-triggered sequences pre-enroll as `waiting`, and the followups approved-waiting sweep sends on approval even though the trigger signal never fired. Enroll signal-triggered contacts as `queued`; only `handleSignalTrigger` promotes `queued -> waiting/active`. The sweep keeps rescuing `waiting`. Test: approved draft on a `queued` enrollment of a signal sequence does NOT send; after signal fire it does.

#### Task 5.3: plain sequences actually send (K2)

With 5.2's semantics settled: `createSequence` without a trigger signal enrolls as `waiting` (not `queued`), so the followups sweep picks approved drafts up. Failing test: non-signal sequence -> enrollment status `waiting` -> approved step-1 draft sends on next followups run.

#### Task 5.4: followups scales past 50 enrollments

`F:outreach-process.ts:544`: unordered global `.limit(50)` on the waiting sweep silently starves enrollments once >50 wait (and mixes tenants). Order by `updated_at` ascending, page through the full set, and scope the approved-draft join per batch. Test: 60 waiting enrollments, the approved one at position 55 still sends.

#### Task 5.5: draft lifecycle closes its loops

- K4: `draftEmailsForSequence` gets an existing-draft guard per (enrollment, step) matching `pickAndDraft`'s. Re-run drafts only missing steps.
- `F:email-tools.ts:1017`: `discardDraft` on a sequence draft must also either regenerate, skip the step, or exit the enrollment (choose: mark enrollment `completed` with a `discarded` note when it was the current step and no replacement exists; the agent can re-enroll deliberately). Test each path.
- `F:outreach-sender.ts:743` `draftIsCurrentStep` fails open on query error: fail closed.

#### Task 5.6: K23 dedupe (step1/totalSteps fetched per pick) folds in here as a pure refactor with existing tests.

#### Task 5.7: hero ordering

Order the hero's send loop by step_number per enrollment (not global `created_at DESC`) so "Send all" can never submit a later step before its predecessor in one pass (belt to 5.1's braces).

---

## Wave 2: give every draft a send path

### PR-6: ad-hoc drafts send after approval (K1) + kanban truth (K11)

**Findings:** K1, F:outreach/page.tsx:310, K11, F:outreach/page.tsx:139
**Files:** `src/app/api/outreach/send-now/route.ts`, `src/lib/services/outreach-sender.ts`, `src/app/outreach/page.tsx`, `src/components/outreach/outreach-drafts-panel.tsx`, `src/app/outreach/review/page.tsx`, `src/lib/outreach/status.ts`, `src/components/outreach/signal-kanban.tsx`

**Contract decision (made):** extend `/api/outreach/send-now` to accept enrollment-less drafts: resolve ownership through `campaign_people -> campaigns.user_id` instead of the enrollment join, skip step/schedule checks (no sequence: nothing to pace), send via the same transport + daily-cap path, mark the draft `sent`. This gives approved ad-hoc drafts the same one-click send the review page and hero already render for sequence drafts.

Tasks: failing route test (approved ad-hoc draft -> 200, sends, respects daily cap; pending draft still 409); `classifyDraft` returns `ready` (not `blocked`) for approved ad-hoc drafts with an inbox; review page shows Send now for ad-hoc drafts (`enrollment_current_step` gate becomes sequence-only); panel's blocked group keeps only genuinely blocked drafts (no inbox). K11: after this, `ready` is a real state; fix `resolveDbEnrollmentStatus`/kanban so the "Ready to send" column is fed (or remove the column if product prefers: default = feed it). Progress counts at `outreach/page.tsx:139` follow.

---

## Wave 3: tracking and signal execution tell the truth

### PR-7: jobs queue durability (carries the ONLY required migration)

**Findings:** K9, F:tracking/[trackingConfigId]/run/route.ts:55, F:services/jobs.ts:101, F:posthog-server.ts:22
**Deploy order:** code first (tolerant of old + new RPC), THEN manual `supabase db push`.

- Await every `enqueueJob` (K9 and the run-route sibling); check `completeJob`/`failJob` errors (`jobs.ts:101`); await posthog flush in serverless handlers.
- Migration: `claim_jobs` RPC same-batch singleton dedupe (two identical singleton jobs claimable in one batch today). Code must work against both RPC versions before push.

### PR-8: signal executor correctness

**Findings:** K8, K16, F:executor.ts:175, 187, 274, 288, 404, 415, F:tracking-run.ts:105, F:tracking-dispatch.ts:43 (+2 more in appendix cluster "Tracking & signal execution")
**Gates repairs:** 8, 9
**Internal order:** make `signal_results` READERS tolerant of both output shapes before touching the writer; fix tenant scoping (`executor.ts:404`: baselines queried without user scoping under the admin client) before trusting any baseline.

Key fixes: map `ctx.name/domain` into tool args (`executor.ts:175`: the builtin google-reviews signal has NEVER run: `companyName` missing fails validation on every tick); thread `ctx.useAdmin` into `runRecipe` (`executor.ts:274`: cron runs query history as anon -> every run reports "first observed" -> intent evaluator sees a fabricated total-change diff: an llm-context lie); K8 snapshot-insert error handling; tracking-dispatch re-dispatch dedupe. K16 rides along (llmTimeout + trackUsage on extract_json).

### PR-9: tracking UI reads (appendix cluster "Tracking UI", 8 findings, independent, mechanical)

---

## Wave 4: prompts stop lying to the model

### PR-10: voice swipe (ONE PR, strict internal coupling)

**Findings:** K6, K12, F:swipe-recipient.ts:122, 45, F:voice-swipe.tsx:209, F:swipe-prompts.ts:459, F:swipe-service.ts:367, F:voice-run-context.tsx:248 (+2, see appendix)
**Coupling:** `swipe-recipient.ts:122` filters on `campaign_people.status`, a column dropped in migration 20260420000000, so the query errors, the error is swallowed, and the real-recipient path NEVER activates: every "real recipient" batch today is silently an invented persona. Fixing that query ALONE would activate a path whose prompt still tells the model to ground drafts in "the invented persona's situation and signals" (K6): fabrication about real people. The query fix and the prompt fixes (K6, K12, persona-label truthfulness in voice-swipe.tsx:209) must land in the same PR.

Tests: real-recipient query uses `outreach_status`; batch system prompt for a real recipient contains the no-fabrication block and NOT the invented-persona grounding line; schema round-trip keeps the persona invariant per path.

### PR-11: compose contract + cost attribution

**Findings:** K10, K18, K19, F:regenerate/route.ts:180, F:sequence-tools.ts:282, F:email-learnings.ts:91, F:compose.ts:67, F:classify-departments/route.ts:83, F:sender-research.ts:222, F:cost-tracker.ts:195 (+4, appendix clusters "Compose prompt contract" and "Cost tracking")
**Internal order:** add the Opus pricing tier to cost-tracker FIRST, then wire `composeEmail` tracking (K18), or Opus rows land unpriced. Fix both `unknown@example.com` sites together (K10 + regenerate): pass `work_email ?? personal_email`. Attribution: every `withAction` gets its userId.

---

## Wave 5: chat persistence stops eating data

### PR-12: chat load/save/trim

**Findings:** K21, F:chat/[id]/page.tsx:203 (high: a transient loadChat error renders an existing chat as empty and the next send OVERWRITES the stored history), F:chat-history.ts:74, F:chat/route.ts:73 (high: trim can orphan a tool_result -> Anthropic 400 -> chat bricked deterministically), F:chat/route.ts:168 (title clobber)
**Internal order:** loadChat error-distinction first (stops active data destruction): `loadChat` returns `{ok:false}` on query error vs `{ok:true, chat:null}` on genuinely-new; the page renders an error state and REFUSES to save until a load succeeded. Then the trimmer: after computing the cut, drop any leading `role:'tool'` messages (and their orphaned pairs) so the suffix always starts on a user/assistant boundary; property test with synthetic tool-heavy histories. Then title: `saveChat` only sets title on insert (or when current title is the auto-generated prefix), never clobbering the summarize title.

---

## Wave 6: discovery, identity, enrichment (five parallel-safe PRs)

- **PR-13 affiliation & discovery integrity** (appendix cluster, 12 findings incl. K25): gates repairs 12, 15. Do not regress the known namesake-enrichment bug (adjacent, tracked separately in memory).
- **PR-14 email discovery waterfall** (6 findings): preserve lazy-verification owner decision.
- **PR-15 org identity & merge** (8 findings): merge-delete fix; prefer admin-client delete over an RLS migration; if RLS migration chosen, code-first-then-push. Gates repair 14. Includes `domain-resolver.ts:99` (high: site-builder apexes like `business.site` accepted as company domains: every future contact at that "domain" mis-verifies).
- **PR-16 enrichment lifecycle** (8 findings): stale `in_progress` recovery ships before repair 11. Includes `claim-reconciler.ts:41` (high: empty careers scrape marks real hiring claims contradicted) which gates repair 10.
- **PR-17 GitHub tools** (5 findings incl. the high stub-overwrite at `github-tools.ts:91`): mergeEnrichmentData deep-merges the `github` key; gates repair 13.

---

## Wave 7: remaining product surfaces (parallel-safe, mechanical)

- **PR-18 dashboard & campaign metrics** (K22 + 4: incl. the ascending-order+limit truncation hiding recent days): define the status bucket set once, share it.
- **PR-19 email settings & transport** (4 findings): GET fail-safe protects `gmail_connected_at` warmup clock.
- **PR-20 sender profile & facts** (7 findings): gates repair 16.
- **PR-21 activity feed pagination** (2 findings).
- **PR-22 learning loop atomicity** (2 findings): gates repair 18; no migration needed, but remember the outcome-feedback-loop deploy rule if that changes.
- **PR-23 YC/search tools** (K17 + 3).
- **PR-24 misc UI + shared constants** (12 findings incl. K13, K15): import `AFFILIATION_SEND_THRESHOLD` from `services/affiliation`; single `formatRelative`.

## Wave 8: cross-cutting sweeps (LAST, so they never touch a file twice)

- **PR-25 apiFetch hygiene** (K14 + 3): replace every raw `fetch("/api/...")` with `apiFetch`; includes the cost-center crash (F:cost-center.tsx:165: 401 JSON body stored as CostData -> settings page crashes to the error boundary; also check `res.ok`).
- **PR-26 error-surfacing helper** (K7, K21-class, 10 findings): one shared `unwrap(res)` helper that throws on `.error` + a standard error state distinct from empty state; apply mechanically across the appendix cluster list. This is the repo-wide immune response to the class that hid your eight drafts.

---

## Prod data-repair runbook (remote Supabase, manual, in this order)

Each repair names its gating PR. Run via SQL against prod (service role); wrap each in a transaction with a SELECT-first dry run; record row counts before/after.

| #   | Repair                                                                                                                                     | Gated by                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 1   | `sequence_enrollments` stuck `queued` from non-signal createSequence: promote to `waiting`                                                 | PR-5 (send guards live, or resumed rows burst-send) |
| 2   | Enrollments pinned by cleanup (draft `sent`, step never advanced): advance/complete + sync `outreach_status`                               | PR-2, PR-5                                          |
| 3   | `campaign_people` downgraded `replied -> sent`: restore from `sent_emails`/`email_replies`                                                 | PR-1                                                |
| 4   | Duplicate drafts per (enrollment, step): keep newest, discard rest                                                                         | PR-5                                                |
| 5   | **URGENT** drafts wrongly reset `queued -> draft` despite `sent_emails` row: re-mark `sent` BEFORE next send window (duplicate-send risk)  | PR-2 (run immediately after deploy)                 |
| 6   | Enrollments stranded by discardDraft: regenerate or complete                                                                               | PR-5                                                |
| 7   | Lost suppressions: rescan classified `email_replies` (unsubscribe any-confidence; not_interested >= 0.8) and upsert                        | PR-1                                                |
| 8   | Dedupe `tracking_changes` + duplicate pending tracking.run jobs                                                                            | PR-8                                                |
| 9   | Malformed/foreign-tenant `signal_results` baselines: purge; expect one benign baseline run per config                                      | PR-8                                                |
| 10  | Reset wrongly `contradicted` hiring claims to `unverified`                                                                                 | PR-16                                               |
| 11  | Reset stale `enrichment_status='in_progress'` to `pending`                                                                                 | PR-16                                               |
| 12  | Null `people.title='LinkedIn'` rows; re-classify departments                                                                               | PR-13                                               |
| 13  | Reset stub-overwritten GitHub profiles to `pending`; re-enrich                                                                             | PR-17                                               |
| 14  | Delete orphaned merged-org rows (zero referrers)                                                                                           | PR-15                                               |
| 15  | Audit `campaign_people` rows with no matching `campaign_organizations` link: unlink or relink                                              | PR-13                                               |
| 16  | Dedupe exact-duplicate `sender_facts`                                                                                                      | PR-20                                               |
| 17  | Resync `email_drafts.to_email` to `people.work_email` for pending drafts                                                                   | PR-4                                                |
| 18  | Force `outreach.learn` re-run per user to rebuild timing stats                                                                             | PR-22                                               |
| 19  | Re-run `/api/chat/summarize` per chat to restore clobbered titles (destroyed chat histories are unrecoverable: documented, not repairable) | PR-12                                               |
| 20  | `api_usage` NULL-user rows: not reconstructible; document that historical cost-center totals undercount                                    | none                                                |

---

## K1-K25 reference (targeted review, 2026-08-06)

K1 ad-hoc drafts unsendable (PR-6) · K2 queued enrollments dead (PR-5) · K3 replied downgrade (PR-1) · K4 duplicate drafts (PR-5) · K5 cleanup strands enrollment (PR-2) · K6 swipe fabrication prompt (PR-10) · K7 outreach dashboard swallows errors (PR-26) · K8 snapshot insert ignored (PR-8) · K9 fire-and-forget enqueue (PR-7) · K10 placeholder email in prompt (PR-11) · K11 kanban ready column (PR-6) · K12 persona schema (PR-10) · K13 relative-time copies (PR-24) · K14 raw fetch (PR-25) · K15 threshold mirror (PR-24) · K16 runner timeout/usage (PR-8) · K17 search-tools timeout (PR-23) · K18 opus cost tier (PR-11) · K19 withAction userId (PR-11) · K20 email-track swallow (PR-1) · K21 listChats swallow (PR-12) · K22 dashboard route errors (PR-18) · K23 step refetch (PR-5) · K24 sendBulk re-query (PR-24) · K25 O(n^2) loop (PR-13)

## Status tracking

Mark each PR here as it merges. Wave 0 first; within a wave, listed order. Already fixed pre-plan: ad-hoc review path (PR #75), step-1 breakup framing (PR #76).
