# Outreach Pipeline Hardening: Full Findings Inventory

> Companion to `2026-08-06-outreach-pipeline-hardening.md`. Generated from the
> full-codebase line-by-line sweep (26 reader agents over all 271 source files,
> adversarial verification per chunk): 161 findings kept, 5 refuted.
> K1-K25 from the earlier targeted review are catalogued in the main plan.

Severity: 14 high / 82 medium / 65 low. Verdicts: 152 CONFIRMED, 9 PLAUSIBLE.

## HIGH severity

### `src/app/api/chat/route.ts:73` [correctness]

trimMessages trims history at an arbitrary message boundary and can drop an assistant tool-call message while keeping its role:'tool' result message, producing a tool_result with no matching tool_use, which the Anthropic API rejects with a 400.

**Failure:** A long chat with heavy tool traffic (enrichment pipelines routinely produce multi-KB tool results) exceeds MAX_INPUT_CHARS=150000. The backwards walk stops between an assistant tool-call message and the following ToolModelMessage; the kept suffix begins with an orphaned tool-result. convertToModelMessages happily emits it, the Anthropic API returns 400 (unexpected tool_use_id), onError surfaces it as the error banner, and regenerate hits the identical 400 because the trim is deterministic. The chat is effectively bricked until the user types enough new text to move the boundary.

**Evidence:** src/app/api/chat/route.ts:73-78: the backwards walk breaks on `if (budget - size < 0) break;` with no role check, so the kept suffix can start with a `role:'tool'` ModelMessage whose assistant tool-call message was dropped. trimMessages runs on convertToModelMessages output (line 129) and the result goes straight to streamText (line 181) with no orphan repair; the trim is deterministic (pure function of message sizes), so regenerate reproduces the same orphaned tool_result and the same Anthropic 400.

### `src/app/chat/[id]/page.tsx:203` [swallowed-error] (related: K21)

loadChat failure is indistinguishable from a new chat: setInitialMessages(chat?.messages ?? []) renders an existing conversation as empty, and the next send permanently overwrites the stored history with only the new turn.

**Failure:** User opens /chat/<id> for a long-running chat during a transient network/DB blip. loadChat's .single() errors and returns null (chat-history.ts:74 folds error and not-found together), so the page renders an empty 'New chat'. User types a message; useChat state contains only that message. Both persistence paths clobber: client onFinish calls saveChat which upserts chats.messages with the 1-2 new messages (onConflict id), and the server /api/chat save persists the client-posted message array too. The prior conversation history is permanently destroyed with no error shown anywhere.

**Evidence:** chat-history.ts:74 `if (error || !data) return null;` folds a transient .single() error into the same null as not-found. src/app/chat/[id]/page.tsx:203 `setInitialMessages(chat?.messages ?? [])` then renders the chat as empty with no error state (the only alternative render is the `initialMessages === null` loading branch at :212). On the next send, both persistence paths overwrite: client onFinish (page.tsx:66-75) calls saveChat with `allMessages` from useChat state (seeded from the empty initialMessages), and saveChat (chat-history.ts:44-54) upserts `messages` wholesale with `onConflict: "id

### `src/app/outreach/review/page.tsx:373` [correctness]

A subject-only edit rewrites body_html through the lossy htmlToPlain/plainToHtml round-trip, silently destroying every hyperlink in the email body

**Failure:** Composer emits body_html with an anchor (skill.ts permits <a>). User tweaks only the subject on the review page and approves. The save gate is `if (!subjectChanged && !bodyChanged) return` but the update payload unconditionally includes body_html: plainToHtml(edit.bodyText), where edit.bodyText came from htmlToPlain which by documented design discards hrefs. The sent email's CTA ('book a time') is no longer a link, with zero indication to the user. Same defect in handleSendNow at line 561.

**Evidence:** src/app/outreach/review/page.tsx:366-377: gate is `if (!subjectChanged && !bodyChanged) return`, then the update unconditionally writes `body_html: plainToHtml(edit.bodyText)`; edit.bodyText = `d.body_text ?? htmlToPlain(d.body_html)` (line 365 / initialEdit line 97), and htmlToPlain discards hrefs by documented design (src/lib/email/html-to-plain.ts:67-72; line 86 confirms the composer may emit <a>). plainToHtml (line 32-38) emits only <p>/<br>, so a subject-only edit rewrites body_html with all anchors flattened to text. The sender emails body_html (src/lib/services/outreach-sender.ts:484 `h

### `src/components/outreach/ready-to-send-hero.tsx:49` [correctness] (related: K4)

Send all can deliver a follow-up step seconds after its predecessor: the sequential loop sends the current step, sendApprovedDraft advances enrollment.current_step, and a later-step draft appearing later in the iteration then passes send-now's step-match check; neither /api/outreach/send-now nor sendApprovedDraft checks enrollment.next_send_at (sender doc: 'Ignores enrollment.next_send_at'), and bypassSendWindow:true is set.

**Failure:** Enrollment at step 1 due, steps 1-3 pre-drafted and approved. Step 1's draft has the newest created_at (re-drafted after a rejection, or a K4 duplicate re-run; same-batch inserts can also tie), so page.tsx's created_at DESC ordering puts it before step 2 in the hero's drafts array. User clicks 'Send all': step 1 sends, enrollment advances to current_step=2 with next_send_at days out, then the loop reaches the step-2 draft, /api/outreach/send-now finds currentStep.id === draft.sequence_step_id, and the follow-up ('circling back since you didn't reply...') lands in the prospect's inbox seconds after the intro, outside the send window, unrecallable.

**Evidence:** Mechanism fully traced: ready-to-send-hero.tsx:49-69 awaits /api/outreach/send-now sequentially per draft; send-now/route.ts:90-96 re-reads the enrollment fresh each request, its only step guard is `currentStep.id !== draft.sequence_step_id` (route.ts:123), it never reads next_send_at, and it passes `bypassSendWindow: true` (route.ts:136-138). sendApprovedDraft explicitly 'Ignores enrollment.next_send_at' (outreach-sender.ts:771-772, and no check exists in the code) and on success awaits advanceEnrollmentAfterSend (line 819), which sets `current_step: nextStep, next_send_at: now+delay` (lines

### `src/components/settings/cost-center.tsx:165` [swallowed-error] (related: K14,K7,K22)

Costs fetch never checks res.ok, so a 401/500 JSON error body is stored as CostData and the render crashes iterating data.byService (undefined), taking the whole settings page to the root error boundary.

**Failure:** User leaves /settings open past Clerk session-cookie expiry (or the API 500s), then the component fetches /api/settings/costs with raw fetch (no Bearer refresh, unlike apiFetch). Route returns {error:"Unauthorized"} with 401; .then(r => r.json()) parses it, setData stores it. Render: data.totalCost is undefined so the empty-state guard (totalCost === 0 && ...) is false, main branch runs, `for (const s of data.byService)` throws TypeError: data.byService is not iterable. React unmounts to src/app/error.tsx: the entire settings page is replaced by an error screen instead of a re-auth prompt.

**Evidence:** src/components/settings/cost-center.tsx:164-168: `fetch(url, { cache: "no-store" }).then((r) => r.json()).then((d) => { ... setData(d) })` never checks r.ok. The route (src/app/api/settings/costs/route.ts:6-8) returns `Response.json({ error: "Unauthorized" }, { status: 401 })`, valid JSON, so the .catch at line 172 does not fire and `{error:"Unauthorized"}` is stored as CostData. Render guard at line 219 is `!data || (data.totalCost === 0 && data.byService.length === 0)`; with totalCost undefined the `=== 0` clause is false, so the main branch runs and line 232 `for (const s of data.byService)

### `src/lib/email-skills/swipe-recipient.ts:122` [correctness] (related: K6)

loadRecipientCandidates filters on campaign_people.status, a column dropped by the 20260420000000_drop_campaign_people_status migration (folded into 20260419000000_initial_schema.sql), so the query always errors and the swallowed error returns [] : the real-recipient swipe path can never activate.

**Failure:** User starts a voice run for a campaign full of real contacts. PostgREST rejects the select with 'column campaign_people.status does not exist'; line 124 `if (error || !data) return []` swallows it; pickRecipient gets [] and returns null; generateVoiceBatch falls through to INVENT_RECIPIENT. Every batch is written to a fabricated persona, the agent tells the user 'the recipient is a fictional persona', and the entire feat/swipe-real-recipients feature (PR #72) is silently dead in local and prod. No log, no error surfaces anywhere.

**Evidence:** supabase/migrations/20260419000000_initial_schema.sql:1248-1251 ('drop index if exists idx_campaign_people_status; alter table campaign_people drop column if exists status;', folded from 20260420000000_drop_campaign_people_status.sql) removes the column that src/lib/email-skills/swipe-recipient.ts:122 filters on ('.neq("status", "rejected")'). PostgREST 400s on a filter over an unknown column and line 124 'if (error || !data) return []' swallows it with no log. swipe-service.ts:201-209 then calls pickRecipient([]) which returns null (swipe-recipient.ts:40), so buildBatchSystem takes the INVENT

### `src/lib/jobs/executors/outreach-process.ts:544` [state-machine] (related: K2)

handleFollowups loads 'waiting' enrollments with a global unordered .limit(50), so once more than 50 waiting enrollments exist (across ALL users, admin client, no user scoping, no .order()), an approved step-1 draft can permanently miss the window and never send

**Failure:** pickAndDraft leaves every drafted-but-unreviewed contact at status='waiting'. After weeks of signal fires, >50 waiting rows accumulate (most pending review forever). The query returns an arbitrary 50 rows each run; the enrollment whose draft the user just approved sits outside that set every 15 minutes, so the approved email never sends and the UI shows it 'waiting' indefinitely. Worse, one tenant's 50+ stale waiting rows starve every other tenant's approved drafts. The fix path this code claims to provide ('without this, bulk-approved step-1 drafts never send') silently stops working at scale; the correct query would filter to enrollments that HAVE an approved draft (join/in) before limiting, or at least order by updated_at.

**Evidence:** outreach-process.ts:540-544: `.eq("status","waiting").limit(50)` has no .order(), no user scoping, and the approved-draft filter (lines 548-560) runs AFTER the limit, so an approved enrollment outside the arbitrary 50 is invisible to the cron. No code path ever transitions unreviewed 'waiting' enrollments to a terminal state (grep across src shows only pickAndDraft/sequence-tools write 'waiting'; draft rejection touches email_drafts only), so >50 stale rows accumulate. The only alternate send path, handleSignalTrigger lines 121-155, requires the same signal to fire again, so the 15-min followu

### `src/lib/services/claim-reconciler.ts:41` [correctness]

reconcileClaims treats a failed/empty careers scrape as ground truth: a non-null CareersScrape with jobs:[] marks every extracted hiring_role claim 'contradicted'.

**Failure:** hiring-scraper.ts:618 returns { careersUrl: null, jobs: [], totalJobs: 0 } when the browser path finds no careers link (and Stagehand can also extract 0 jobs from a JS-heavy page). Both callers (src/app/api/enrich-company/route.ts:446 and src/lib/tools/enrichment-tools.ts:1485) wrap any fulfilled value into non-null careers. reconcileClaims then runs careers.jobs.some(...) over an empty array, so every true hiring claim from news/search sources is marked 'contradicted'. system-prompt.ts:230 orders the model never to cite contradicted claims as timing signals, and company-detail.tsx:340 renders 'The live careers page says otherwise' when no careers page was ever read. Real hiring signals are suppressed for any company without a discoverable careers page. Note the callers themselves know careersUrl:null means 'no page': the direct hiringClaims block guards on careers?.careersUrl, but reconcileClaims does not.

**Evidence:** hiring-scraper.ts:610-618 returns { careersUrl: null, jobs: [], totalJobs: 0 } when no careers link is found; enrich-company/route.ts:446-453 and enrichment-tools.ts:1485-1492 wrap any fulfilled value into a non-null careers object; claim-reconciler.ts:41 gates on `if (opts.careers)` (object truthiness, not careersUrl), so matchesScrapedJob runs jobs.some() over [] and line 42-44 marks every hiring_role claim 'contradicted'. Consequences verified: system-prompt.ts:230 ('Never cite a contradicted... claim as a timing signal') and company-detail.tsx:340 ('The live careers page says otherwise.').

### `src/lib/services/domain-resolver.ts:99` [correctness]

usableDomain rejects directory domains but never checks isPlatformDomain, so the resolver can return a site-builder apex (e.g. business.site) as a company's own domain, and both resolver call paths skip the platform guard that the manual-URL path has.

**Failure:** A care home's Google Places websiteUri is https://cedarlodge.business.site. normalizeDomain collapses it to 'business.site' (per the PLATFORM_DOMAINS docstring in directory-domains.ts these apexes are not on the PSL private section), isDirectoryDomain doesn't match it, and the Places name-match uses displayName not the domain, so resolveOrganizationDomain returns domain='business.site'. In setCompanyWebsite (organization-website.ts:284-301) the args.resolve branch takes found.domain directly, bypassing the isPlatformDomain check at line 266 that only guards the manual-URL branch; the twin lookup on organizations.domain='business.site' then finds any other business already stored on that builder and mergeOrganizations repoints one company's people onto an unrelated company. The discoverCompanies path (search-tools.ts:664) likewise writes the resolved apex into findOrCreateOrganization, which dedupes by domain and files the second business's data onto the first. This is exactly the merge disaster the PLATFORM_DOMAINS comment documents, and small businesses on hosted builders are the stated target ICP.

**Evidence:** domain-resolver.ts:98-100: usableDomain rejects only `!domain || isDirectoryDomain(domain)`; isPlatformDomain is never imported. Verified with the repo's tldts that normalizeDomain (knowledge-base.ts:30, getDomain with allowPrivateDomains:true) collapses cedarlodge.business.site -> 'business.site' (also _.wordpress.com, _.squarespace.com, _.weebly.com, _.godaddysites.com, _.jimdosite.com, _.strikingly.com; the PSL-private ones like myshopify/wixsite/github.io stay intact). The Places branch matches displayName only (domain-resolver.ts:123-125), so the platform apex is returned as the company d

### `src/lib/signals/executor.ts:175` [correctness]

executeToolCall never maps ctx.name into tool args, so the Google Reviews builtin signal (tool_call getGoogleReviews, config {maxReviews:5}) always fails input validation: getGoogleReviews requires companyName, which neither the config nor the context mapping supplies.

**Failure:** User enables tracking with the builtin 'google-reviews' signal on any company. Every tracking cron run (and every chat testSignal run) builds args {maxReviews:5, organizationId, domain}, safeParse fails on missing required companyName, and the executor returns found:false 'invalid config for getGoogleReviews'. tracking-run snapshots the empty data {}, the hash never changes, and the timeline shows nothing forever. The signal is advertised in the catalog and in the system prompt but is silently dead on this execution path.

**Evidence:** src/lib/signals/executor.ts:175-185 builds args={...config} and maps only ctx.organizationId/ctx.domain (never ctx.name -> companyName); src/lib/tools/enrichment-tools.ts:2208-2210 makes companyName a required z.string(); seed 20260804000001_reseed_builtin_signals.sql:46 gives google-reviews execution_type 'tool_call', tool_key 'getGoogleReviews', config {maxReviews:5}. safeParse at executor.ts:207-219 fails on missing companyName and returns found:false 'invalid config for getGoogleReviews' with data:{}, so tracking-run.ts:89-102 snapshots an empty generic snapshot whose hash never changes.

### `src/lib/signals/executor.ts:274` [correctness]

executeBrowserScript drops ctx.useAdmin when calling runRecipe, so under the tracking cron the recipe's history step queries signal_results with the user-session server client, which is anon on the public /api/jobs route; RLS returns zero rows and the diff step always reports 'First observed value (no prior baseline)' with changed:true.

**Failure:** pricing-changes tracked via cron: every run the history step finds no baseline (anon RLS), so signalOutput.diff = {changed:true, from:null, description:'First observed value (no prior baseline).'}. tracking-run.ts:242-244 prefers this executorDiff over the snapshot structural diff, so any Stagehand extraction drift that changes the snapshot hash sends the intent evaluator a diff claiming the entire pricing table is brand-new. Intent like 'flag when they add an enterprise tier' fires falsely, readiness_tag is flipped to ready_to_contact, and an outreach.process job is enqueued (with auto_send possible), producing outreach on no real change.

**Evidence:** executor.ts:274 calls runRecipe({recipe, context}) without supabaseClient and drops ctx.useAdmin; runner.ts:32 falls back to createClient(). /api/jobs is a public route (src/proxy.ts:6) hit with CRON_SECRET only, so server.ts createClient has sessionId=null and sends no Authorization header (anon role). signal_results_select is 'FOR SELECT TO authenticated USING (true)' (20260419000000_initial_schema.sql:825), so the history step (runner.ts:158-167) returns {present:false,value:null}; diff.ts:8-15 then yields {changed:true, from:null, description:'First observed value (no prior baseline).'}. t

### `src/lib/tools/email-tools.ts:1017` [state-machine] (related: K4,K5)

discardDraft on a sequence draft permanently strands the enrollment: nothing regenerates the draft, skips the step, or exits the enrollment, so the rest of the sequence silently never sends.

**Failure:** User asks the agent to discard the draft for an enrollment's current step (drafts exist for every step from enrollment time, so this is easy). Draft becomes status='discarded'; enrollment stays 'active'/'waiting' at that step. Every 15-min followups run, sendApprovedDraft (outreach-sender.ts:790) queries .eq(status,'draft').single(), finds nothing, returns 'No approved draft ready for this step'; handleFollowups (outreach-process.ts:627) only logs and increments a failure counter. The only consumer of 'discarded' is email-cleanup's 7-day delete. The prospect never gets steps N..end, the enrollment never completes, and the cron reports the same failure forever.

**Evidence:** email-tools.ts:1011-1025 discards any status='draft' row with no sequence check. Recovery paths are absent: sendApprovedDraft (services/outreach-sender.ts:788-798) requires .eq('status','draft') and returns 'No approved draft ready for this step'; handleFollowups (jobs/executors/outreach-process.ts:627-637) only console.errors and counts the failure for 'active' enrollments, and for 'waiting' enrollments the filter at outreach-process.ts:548-560 (.eq('status','draft')) silently drops the enrollment with no log at all. Nothing regenerates: saveDraft is a plain insert, pickAndDraft's existing-dr

### `src/lib/tools/github-tools.ts:91` [correctness]

For an existing person, findOrCreateGitHubPerson replaces the whole enrichment_data.github object; a stargazers pass (no raw profile) overwrites a previously stored full profile + top_repos with a 6-field stub.

**Failure:** enrichGitHubProfiles saves rich github data (bio, company, followers, top_repos, languages) for user X. Later fetchGitHubStargazers on another repo includes X: the existing-person branch calls mergeEnrichmentData with github={username,profile_url,avatar_url,starred_repo,starred_at,fetched_at} and mergeEnrichmentData does merged['github']=value, wholesale-replacing the rich blob. All GitHub grounding for drafting is destroyed and fetched_at looks fresh, so nothing re-enriches.

**Evidence:** src/lib/tools/github-tools.ts:83-92 builds githubData with only {username, profile_url, avatar_url, starred_repo, starred_at, fetched_at} when profile.raw is absent (stargazer path passes no raw, line 270-277), and line 100 calls mergeEnrichmentData('people', existing.id, { github: githubData }). knowledge-base.ts:365-376 merges only at the top level ('merged[key] = value'), so the entire prior github blob (bio, followers, top_repos, languages from enrichGitHubProfiles' fullRaw at lines 430-435) is wholesale replaced by the 6-field stub. Dedup is by github_url (lines 76-80); both tools store t

### `src/lib/tools/sequence-tools.ts:163` [state-machine] (related: K2)

Signal-triggered sequences send on human approval, not on signal fire: createSequence pre-enrolls contacts as status 'waiting', and handleFollowups' approved-waiting sweep (outreach-process.ts:540-560) sends any 'waiting' enrollment that has an approved step-1 draft, with no check anywhere (sendApprovedDraft included) that the trigger signal ever fired.

**Failure:** User: createSequence(triggerSignalId=hiring-signal) -> enrollments status='waiting'; draftEmailsForSequence pre-drafts step 1 for every contact; tool message tells the user to approve at /outreach/review; user approves. The recurring {type:'followups'} job selects .eq(status,'waiting'), finds the approved draft, and sendApprovedDraft sends it on the next cron tick, days or weeks before the hiring signal fires. The product's core promise ('email them WHEN the signal fires') is silently voided for every pre-enrolled signal sequence: the 'waiting for signal' state is indistinguishable from pickAndDraft's post-fire 'waiting pending review' state.

**Evidence:** Full path traced with no signal gate anywhere. sequence-tools.ts:163 `status: triggerSignalId ? "waiting" : "queued"` pre-enrolls as 'waiting'. draftEmailsForSequence saves step-1 drafts via saveDraft (save.ts:94 review_status 'pending', :81 status 'draft'); the review page approves with `.update({ review_status: "approved" })` leaving status 'draft' (src/app/outreach/review/page.tsx:575 and :399). handleFollowups (outreach-process.ts:540-544) selects `.eq("status", "waiting")` with NO filter on sequence or trigger signal, then (547-560) keeps enrollments whose email_drafts row has review_stat

## MEDIUM severity

### `src/app/api/dashboard/route.ts:74` [correctness] (related: K22)

Time-series query orders outreach_events ascending with limit(10000), so when the window holds more than 10000 events the OLDEST rows are kept and the most recent days silently vanish from the chart; with range=all the chart is permanently frozen at the first 10000 events ever.

**Failure:** A busy install accumulates >10000 outreach_events in 30 days. GET /api/dashboard?range=30d returns a timeSeries whose latest days are missing entirely (ascending order + limit keeps the head, truncates the tail). The dashboard chart shows activity dying off even though sends/replies are happening today. Should fetch descending and reverse.

**Evidence:** src/app/api/dashboard/route.ts:69-80: both branches use `.order("created_at", { ascending: true }).limit(10000)` on outreach_events — the limit is applied after the ascending sort, so with >10000 rows in the window the oldest 10000 are kept and the newest days are truncated from timeSeries; with range=all the chart is pinned to the first 10000 events ever.

### `src/app/api/refresh-scores/route.ts:221` [swallowed-error]

The batch of campaign_people score updates is `await Promise.all(updates)` on supabase query builders, which never reject; per-row .error is unread and LLM-hallucinated link ids no-op silently, yet the route responds `scored: N`.

**Failure:** User clicks refresh scores; the model returns 25 score rows but the updates fail (transient DB error) or the model returns ids not in the contact list (id is a free-form z.string() the model echoes back). Zero rows are written to campaign_people, but the route returns 200 with scored: 25 and the UI reports success while the list still shows stale or missing priority_score/score_reason.

**Evidence:** src/app/api/refresh-scores/route.ts:214-221: `const updates = result.object.scores.map((s) => supabase.from("campaign_people").update({...}).eq("id", s.id)); await Promise.all(updates);` — per-row .error never read, and postgrest builders never reject. The id is free-form from the LLM (schema z.string() at :148, never validated against enrichedLinks link ids), and .eq matching zero rows is not even an error. :223-226 then returns `scored: result.object.scores.length` unconditionally, so both transient update failures and hallucinated ids report success.

### `src/app/api/settings/costs/route.ts:78` [swallowed-error] (related: K7,K22)

None of the five api_usage query .error fields (totalRes, byServiceRes, byOperationRes, dailyRes, recentRes) are ever read; every aggregation runs on `data ?? []`, so a failed query renders as $0 spend / empty tables.

**Failure:** Any transient Supabase failure (or the Clerk role-claim regression that makes RLS silently deny) returns error on the queries; the route still responds 200 with totalCost=0, byService=[], recent=[], and the cost dashboard shows the user has spent nothing, masking real spend and the failure itself.

**Evidence:** src/app/api/settings/costs/route.ts:61-75 destructures totalRes/byServiceRes/byOperationRes/dailyRes/recentRes; `.error` appears nowhere in the file. Every aggregation uses the failure-masking form: `(totalRes.data ?? []).reduce(...)` (:78), `byServiceRes.data ?? []` (:89), `byOperationRes.data ?? []` (:106), `dailyRes.data ?? []` (:139), `recentRes.count ?? 0` (:164), `recentRes.data ?? []` (:173). Supabase postgrest builders resolve with {data:null,error} rather than throwing, so Promise.all succeeds and the route returns 200 with totalCost=0 and empty arrays on any query failure.

### `src/app/api/settings/email/route.ts:20` [swallowed-error] (related: K7,K22)

GET swallows the user_settings select error and returns is_configured:false defaults, defeating the tenant-hardening migration's explicit fail-safe and inviting a warmup-clock reset.

**Failure:** 20260804000000_tenant_policy_hardening.sql enumerates column grants and documents the fail-safe as 'a column added later... surfaces as a visible PostgREST error'. This route destructures only {data}, so that exact error (or any transient failure, or the Clerk missing-role-claim case from prod) renders as 'Gmail not connected' in Settings. The user re-enters credentials to 'reconnect'; the line-87 existing-row read (also error-swallowed, same RLS client) fails the same way, so connectedAt resets to now(), restarting the getEffectiveDailyLimit warmup ramp and silently cutting the account's daily send capacity.

**Evidence:** src/app/api/settings/email/route.ts:20-26 destructures only `{ data: settings }` from the user_settings select; on any error settings is null, so :44 returns `is_configured: !!settings?.gmail_address` = false plus default settings, indistinguishable from 'never connected'. The tenant-hardening migration (20260804000000:182-193) replaced the table grant with an explicit column list and documents that a mismatch 'surfaces as a visible PostgREST error' — this route converts exactly that error into the not-connected default. The warmup chain is also real: in connect_gmail, :87-91 destructures only

### `src/app/api/tracking/[trackingConfigId]/run/route.ts:55` [race] (related: K8,K9)

The route's claimed singleton safety is false for same-batch claims: claim_jobs only excludes pending jobs whose key matches an already-RUNNING row, so two pending tracking-run jobs with the same singletonKey get claimed and run concurrently.

**Failure:** User double-clicks 'Run now'; two jobs with singleton_key 'tracking-run:<id>' insert as pending (no unique index on pending keys). At the next claim_jobs tick, the ranked CTE (20260801000003_job_queue.sql:82) checks not-exists against status='running' rows only; both pending duplicates pass and the single UPDATE sets both to running in one statement. Two tracking.run executors race on the same config, both diff against the same last snapshot, both detect the same change: duplicate timeline rows, doubled LLM spend, and duplicate outreach.process enqueues. The same hole applies to every singleton key, including mailbox serialization.

**Evidence:** 20260801000003_job_queue.sql:82-86: the ranked CTE's guard is `not exists (select 1 from jobs r where r.status = 'running' and r.singleton_key = j.singleton_key)` — it only checks RUNNING rows, and both duplicate jobs are pending, so both pass against the statement snapshot; both land in `picked` (same-user ranks 1 and 2, under per_user_cap=5) and the single UPDATE at :94-106 sets both to running atomically. Nothing prevents duplicate pending keys: enqueueJob (src/lib/services/jobs.ts:65-78) is a plain insert, and the only singleton index (:33-34 idx_jobs_running_singleton) is non-unique and p

### `src/app/campaigns/[id]/page.tsx:107` [correctness] (related: K7)

Any campaignRes error on the 3s/30s poll is rendered as 'Campaign not found', replacing a fully loaded campaign page with an error screen mid-session.

**Failure:** Campaign page is loaded and polling every 3s while the agent streams (heaviest DB-write period). One poll's campaigns .single() fails transiently (network blip, DB under load, expired token before refresh). fetchData sets error='Campaign not found' and the render branch `if (error || !campaign)` discards the entire loaded UI, showing 'Campaign not found' for a real campaign until a later poll succeeds. The subError branch at line 115 has the same page-wipe behavior. A transient failure should keep showing the last good data, not claim the campaign does not exist.

**Evidence:** src/app/campaigns/[id]/page.tsx:107-111: `if (campaignRes.error) { setError("Campaign not found"); setLoading(false); return; }` runs on every fetchData invocation, and fetchData is polled by `setInterval(fetchData, isStreaming ? 3000 : 30000)` at :295. Nothing distinguishes initial load from a poll: any transient campaigns .single() error sets the error state, and the render branch at :371 `if (error || !campaign)` replaces the entire loaded page with the 'Campaign not found' message (:374-377). The subError branch at :115-120 has the same page-wipe (`setError(\`Failed to load campaign data..

### `src/app/campaigns/page.tsx:39` [swallowed-error] (related: K7,K21,K22)

Campaigns list query destructures only {data}; any error renders as the 'No campaigns yet' empty state.

**Failure:** The campaigns select fails (transient network error, or RLS resolving to anon per the shipped Clerk role-claim bug, which returns empty without error anyway). setCampaigns(data ?? []) shows 'No campaigns yet. Start one from the chat or the Overview page.' to a user with live campaigns, with no error surfaced and no retry. Exact class as the dashboard/chat-list findings already logged.

**Evidence:** src/app/campaigns/page.tsx:39-42 destructures only `{ data }` from the campaigns select (error never read), :45 `setCampaigns(data ?? [])` maps any failure to an empty list, and the render at :96-99 shows 'No campaigns yet. Start one from the chat or the Overview page.' whenever `campaigns.length === 0`. There is no error state, no toast, and no retry on the read path (the delete handler at :64-68 does check its error, underscoring the read-path omission). A transient query failure is indistinguishable from a genuinely empty workspace.

### `src/app/companies/[id]/page.tsx:111` [swallowed-error] (related: K7,K22)

peopleRes and campaignsRes errors are never read: a failed people query renders the company as '0 people' with an empty org chart; the campaign_people status query at line 145 swallows its error the same way.

**Failure:** The people select (26 columns) fails: transient error, or a future column-grant miss under the tenant-hardening pattern. fetchCore only checks orgRes, so the page renders the org header with '0 people' and an empty OrgChart, and the user concludes contacts were lost. Similarly a failed campaignsRes hides the CampaignSelector options, and a failed outreach_status fetch (line 145, {data} only) shows every contacted person as 'not_contacted' in the chart and PersonDrawer.

**Evidence:** src/app/companies/[id]/page.tsx:104-108: fetchCore checks only `orgRes.error || !orgRes.data`; peopleRes.error and campaignsRes.error are never read. On a failed people query, :111 `setPeople((peopleRes.data ?? []) as PersonRow[])` renders the company header with an empty people array (empty OrgChart, '0 people'), and :113-122 likewise renders campaignsRes errors as an empty CampaignSelector. The campaign_people status fetch at :145-148 destructures only `{ data }`; on error the loop at :151-153 builds an empty map, so :171 `statusByPerson.get(p.id) ?? null` yields null outreach_status for eve

### `src/app/outreach/page.tsx:139` [correctness] (related: K11)

Sequence progress counts classify only waiting/queued/active/replied, so enrollments that finish the sequence (status 'completed', written by advanceEnrollmentAfterSend in outreach-sender.ts:648) drop out of sent/waiting/replied while still counting in enrolled: a finished sequence renders '0 replied, 0 sent, 0 waiting, N total'.

**Failure:** A 20-person sequence runs to completion without replies. Each enrollment moves active -> completed after its last step. The SequenceProgressBar in sequence-list.tsx progressively empties: 'sent' declines back toward 0 as contacts complete, and the finished sequence shows an all-empty bar with '20 total', looking like the outreach never went out. Completed contacts also vanish from the kanban (query at line 85 fetches only the four live statuses), so there is no UI record they were ever emailed.

**Evidence:** src/app/outreach/page.tsx:138-141: `prev.enrolled++` unconditionally, then only `waiting|queued -> waiting`, `active -> sent`, `replied -> replied`; status 'completed' increments nothing but enrolled. 'completed' is really written: src/lib/services/outreach-sender.ts:645-650, `if (!nextStepRow) { update({ status: "completed" ... }) }` in advanceEnrollmentAfterSend. The kanban query at page.tsx:85 is `.in("status", ["waiting", "queued", "active", "replied"])`, so completed enrollments also vanish from the cards. src/components/outreach/sequence-progress-bar.tsx:27-31 renders `{replied} replied

### `src/app/outreach/page.tsx:310` [state-machine] (related: K1,K7)

Empty-state gate (sequences.length === 0 && activity.length === 0) ignores drafts, hiding pending ad-hoc drafts behind 'No outreach sequences yet'

**Failure:** A new user asks the agent to draft a one-off email: an email_drafts row exists with status='draft', review_status='pending', sequence_id null, and no sequence or activity exists yet. The Outreach page renders only the 'No outreach sequences yet' dashed box; ReadyToSendHero and OutreachTabs (which contain the drafts panel and the path to /outreach/review) never mount, so the pending draft is invisible everywhere except by typing /outreach/review manually. Compounds K1's dead end for ad-hoc drafts.

**Evidence:** src/app/outreach/page.tsx:310: empty-state condition is `sequences.length === 0 && activity.length === 0`; `drafts` is not consulted even though the drafts query (lines 88-101, `.in("status", ["draft"])`) fetches the pending ad-hoc draft. The activity feed cannot rescue it: /api/outreach/activity's pending source requires `.eq("review_status", "approved")` (src/app/api/outreach/activity/route.ts:125) and the sent source reads sent_emails, so a review_status='pending' draft yields activity=[]. ReadyToSendHero and OutreachTabs (lines 319-333) only mount in the else branch, so the pending draft i

### `src/app/outreach/review/page.tsx:32` [correctness]

plainToHtml does not HTML-escape text, so `<` and `&` in the edited body (including entities htmlToPlain just decoded) are written raw into body_html

**Failure:** Draft body_html contains `we cut latency to &lt;10ms` (or the user types `<10ms` in the textarea). htmlToPlain decodes it to `<10ms`; any body edit re-serialises via plainToHtml with only `\n` replacement, producing `<p>we cut latency to <10ms</p>`. HTML email clients parse `<10ms` as a tag open and swallow text from `<` to the next `>` (potentially the closing </p>), so the recipient sees the sentence truncated. Asymmetric round-trip: decode on read, no encode on write.

**Evidence:** src/app/outreach/review/page.tsx:37: plainToHtml does only `p.replace(/\n/g, "<br>")` with no HTML escaping, while htmlToPlain decodes &lt;/&amp; (src/lib/email/html-to-plain.ts:16-27), so any body edit writes raw `<` and `&` into body_html, which is what gets emailed (outreach-sender.ts:484). The asymmetric round-trip is definite. One caveat: the specific `<10ms` example is tokenized as literal text by spec-compliant HTML parsers (`<` + digit is not a tag open), so truncation there is client-dependent; but `<` followed by a letter is swallowed by any client, and the app's own stripTags (html-

### `src/app/page.tsx:97` [swallowed-error] (related: K22)

After a successful first load, a failed range-change refetch is silently discarded: stale data renders under the new range label with no error surfaced

**Failure:** Dashboard loads 30d data. User clicks 90d; the /api/dashboard refetch fails (network blip, expired session 401). setError runs but the error UI is gated behind `if (!data)`, which is false, so the page keeps rendering the old 30d totals and timeSeries while OutreachChart receives range='90d' and labels the stale 30d series as 90d. No toast, no retry affordance, wrong numbers presented as the requested range.

**Evidence:** src/app/page.tsx:58-73: on refetch failure `setError` runs but `setData` is never called, so `data` keeps the previous range's payload; the skeleton is gated `if (loading && !data)` (line 84) and the error UI is gated `if (!data)` (line 97), both false after a successful first load, and no other render path reads `error` (no toast). `range` was already set to the new value by handleRangeChange (line 80-82) before the fetch, so OutreachChart (lines 130-134) receives range='90d' with the stale 30d timeSeries and totals.

### `src/app/profile/[id]/page.tsx:60` [swallowed-error] (related: K7)

Profile load never reads the query error: any Supabase failure on the user_profile select (data null) is rendered as the 'Profile not found' terminal state.

**Failure:** Prod RLS/auth failure (the logged Clerk role-claim failure mode maps the session to anon and returns an error/empty result) or a transient network error makes every existing profile URL render 'Profile not found' with no retry or error message; the user concludes their profile was deleted.

**Evidence:** profile/[id]/page.tsx:60-70: `const { data } = await supabase.from('user_profile').select('*').eq('id', params.id).maybeSingle();` — the error field is never destructured, and `if (!data) { setNotFound(true); ... }` treats a query failure (error set, data null) identically to a genuinely missing row, rendering the terminal 'Profile not found' state (lines 156-162) with no retry or error message.

### `src/app/profile/page.tsx:33` [swallowed-error] (related: K7)

fetchProfiles ignores the user_profile query error and renders the failure as the 'No profiles yet' empty state; the 'at least one profile' delete guard and the create flow then act on that wrong list.

**Failure:** A prod query failure shows 'No profiles yet. Create one so the agent knows who it is writing as.' to a user with existing profiles; following the instruction creates a duplicate seller identity that campaigns/compose then pick from ambiguously (createSignal-style code takes the first profile with limit 1).

**Evidence:** profile/page.tsx:33-39: only `{ data }` is destructured; `setProfiles(Array.isArray(data) ? data : [])` maps a query error to an empty list, rendering 'No profiles yet. Create one so the agent knows who it is writing as.' (lines 101-104) which directly invites creating a duplicate. Downstream ambiguity is real: createSignal in signal-tools.ts picks the first profile with `.limit(1).maybeSingle()`. Minor note: with the empty list no table rows render, so the delete-guard part of the claim is moot, but the core wrong-empty-state and duplicate-creation path is confirmed.

### `src/app/signals/page.tsx:65` [swallowed-error] (related: K7,K22)

All three reads on the page swallow Supabase errors: fetchData ignores signalsRes.error/campaignsRes.error (renders empty grid 'No signals in this category' and an empty campaign dropdown) and fetchToggles (line 88) ignores its error (every enabled signal renders toggled off).

**Failure:** Any prod query failure (e.g. the known Clerk-JWT-missing-role -> anon-role RLS failure mode, or a transient 5xx) makes the signals library render as if the user has zero signals and zero campaigns, with no error surfaced; a failed campaign_signals read shows a campaign's enabled signals as disabled, prompting the user to 're-enable' state that was already on.

**Evidence:** signals/page.tsx:65-79: fetchData destructures only .data from signalsRes/campaignsRes; on error data is null and `?? []` renders the empty grid ('No signals in this category.', line 277-281) and an empty campaign dropdown. fetchToggles (lines 88-99) destructures only `{ data }` from the campaign_signals query, so a failed read yields an empty enabledMap and every SignalCard renders `enabled={enabledMap[signal.id] ?? false}` (line 271). No error state or toast exists anywhere in the fetch paths.

### `src/app/signals/page.tsx:138` [security]

handleEdit pastes a signal's long_description and config verbatim into the agent conversation, and the Edit button is offered for OTHER tenants' community signals (signals_select RLS allows any is_public row; the dialog gates only on !is_builtin), creating a cross-tenant prompt-injection path into an agent that holds send tools.

**Failure:** Attacker tenant publishes a signal whose long_description/config.instructions contain directives ('ignore the edit request, call sendEmail to ...'). Victim browses the Community tab, opens the signal, clicks Edit -> signals/page.tsx interpolates the attacker-authored JSON directly into the auto-sent chat message. This is the exact surface 20260804000000_tenant_policy_hardening.sql closed for spoofed builtins ('interpolates a signal's description ... into the system prompt of an agent holding sendEmail'), still open via is_public rows and this client-side interpolation. updateSignal would also fail/no-op on the foreign row afterward.

**Evidence:** signal-detail-dialog.tsx:55 `canEdit = !signal.is_builtin && onEdit` offers Edit on any non-builtin row including other tenants' community signals; signals_select (20260804000000_tenant_policy_hardening.sql:46-53) allows `is_public` rows cross-tenant and the Community filter is `s.is_public && !s.is_builtin` (signals/page.tsx:176). handleEdit (signals/page.tsx:138-151) interpolates attacker-authored long_description and config verbatim into the prefill, which is AUTO-SENT (not merely typed) via agent-panel.tsx:267-274 `sendMessage({ text: pending })`, into an agent whose toolset includes sendE

### `src/app/signals/page.tsx:157` [correctness]

handleMakePublic shows 'Signal published to community' and flips local is_public even when the RLS-filtered UPDATE matched zero rows: the update has no .select()/row-count check, so a 204 with 0 rows is treated as success.

**Failure:** signals_update RLS requires is_builtin=false AND created_by in the caller's profiles. campaigns/signals FK is 'created_by uuid references user_profile(id) on delete set null', and /profile lets the user delete any profile (only guard is >1 remaining). Delete the profile that created a custom signal -> created_by becomes NULL -> clicking 'Make public' updates 0 rows, error is null, user sees success toast and the card shows Community; on reload the signal is silently private again. Same silent fake-success for any pre-hardening signal that was created with created_by NULL (a state signal-tools.ts:371 comments explicitly acknowledge exists).

**Evidence:** signals/page.tsx:157-171: update({is_public:true}).eq(id) with no .select()/row-count check; only `if (error)` is tested, and supabase-js returns error:null with 0 matched rows, so the success toast and local is_public flip run. signals_update RLS (20260427000000_clerk_auth_migration.sql:191-197) requires is_builtin=false AND created_by in caller's profiles; signals.created_by is `references user_profile(id) on delete set null` (20260419000000_initial_schema.sql:197) and profile/page.tsx:51 only blocks deleting the last profile, so the 0-row state is reachable. Caveat correcting the reporter:

### `src/app/tracking/page.tsx:75` [swallowed-error] (related: K7,K22)

tracking_configs query error is folded into the empty state ('!configs' -> setRows([])), and orgLinksRes/latestChangesRes errors (lines 113-114) are never read, so failures render as 'No tracking configured for this campaign' or as rows silently missing readiness tags and latest changes.

**Failure:** A prod RLS/auth/network failure on the tracking_configs select shows the dashed 'No tracking configured' empty state for a campaign that has active tracking; a failure on only the campaign_organizations or tracking_changes query renders every row with readinessTag null and no latest change, and the ready/monitoring counters show 0, with no error anywhere.

**Evidence:** tracking/page.tsx:67-78: only `{ data: configs }` is destructured and `if (!mountedRef.current || !configs) { setRows([]); return; }` folds a query error (data null) into the empty-rows state, which renders the dashed 'No tracking configured for this campaign' block (lines 288-296). Lines 95-114: orgLinksRes.error/latestChangesRes.error are never read; on failure orgLinks/latestChanges are null, `?? []` leaves readinessMap/changeMap empty, so rows render with readinessTag null and no latest change, and readyCount/monitoringCount (lines 186-197) compute 0.

### `src/components/agent-panel.tsx:221` [race] _(plausible)_

notifyVoiceTurnDone() runs even when the turn ended as a server pause (data-turn-paused) with an auto-continue already queued, so the deck flashes a retryable 'came back without drafts' error while the continuation is still going to deliver them.

**Failure:** A voice batch turn burns its step/time budget before emitting data-voice-drafts (persona pick plus generation is multi-step). The chat route emits data-turn-paused (src/app/api/chat/route.ts:218) and ends the stream; onFinish sets up the auto-continue but then calls notifyVoiceTurnDone unconditionally, which clears pending and sets 'The agent came back without drafts. Try again.' (voice-run-context.tsx:295). The user clicks retry, requestMoreDrafts passes its pendingRef guard (pending was just cleared) and sends a second 'Write the next batch' message while the continuation turn is in flight; both turns emit data-voice-drafts with mode 'append', so the queue receives two batches of near-duplicate drafts and every duplicate swipe skews the derived rules.

**Evidence:** The code path is real: src/app/api/chat/route.ts:216-224 writes data-turn-paused when finishReason==='tool-calls' (stopWhen at :189: stepCountIs(40) or 600s deadline, :41); agent-panel.tsx:212-221 schedules the auto-continue via setContinueTick then calls notifyVoiceTurnDone() unconditionally; voice-run-context.tsx:295-304 clears pending and sets 'The agent came back without drafts. Try again.' when pending==='drafts'; requestMoreDrafts's only guard is `if (pendingRef.current) return;` (voice-run-context.tsx:191), so a user retry during the continuation sends a second batch request and both ap

### `src/components/campaign/campaign-stats.tsx:18` [correctness] (related: K22)

Contacted count and reply-rate denominator omit 'bounced' (and 'complained'), so bounced contacts vanish from stats and the reply rate is inflated, disagreeing with the dashboard which was already fixed for exactly this

**Failure:** Send to 10 contacts, 2 bounce (email-track.ts calls applyInboundStatus which writes campaign_people.outreach_status='bounced'), 1 replies. This card shows Contacted 8 (should be 10) and Reply rate 1/8=13%, while /api/dashboard shows 10 contacted and 10% because dashboard/route.ts:52 deliberately includes 'bounced' and 'complained' with a comment ('A send that bounced still left. Excluding it shrank the denominator...'). Same stale predicate is also duplicated at src/app/campaigns/[id]/page.tsx:241 and :337 for the activity counter, so a bounce even decrements the apparent contacted set there.

**Evidence:** campaign-stats.tsx:18-23 counts only sent|opened|replied, while dashboard/route.ts:52-58 includes 'bounced' and 'complained' with the quoted denominator comment. The bounced status genuinely lands in campaign_people: email-tracking.ts:73-76 (applyInboundStatus) runs `.from("campaign_people").update({ outreach_status: newStatus })` and STATUS_PRIORITY (line 50) gives bounced priority 6 > sent's 2, so sent->bounced applies. Same stale predicate duplicated at campaigns/[id]/page.tsx:241-243 and 334-340 (replyRate useMemo). Minor correction: the activity counter at page.tsx:248 only increments (`i

### `src/components/campaign/companies-list.tsx:210` [swallowed-error] (related: K7)

enrichCompanyHandler awaits res.json() before checking res.ok, so a non-JSON error response throws past the toast into a catch that only console.errors; the failure is invisible

**Failure:** Company enrich hits a Vercel gateway 502/504 (HTML body) or any non-JSON error: `await res.json()` throws SyntaxError, the toast.error branch at line 212 never runs, catch at line 220 logs to console only. Spinner stops, nothing on screen, user clicks Enrich again and pays for another run. The sibling handlers enrichContact (line 191) and findEmailForContact (line 310) have the same silent catch: a thrown apiFetch/network error produces no toast at all, unlike findContactsHandler and findEmailsForCompany which do toast in catch.

**Evidence:** companies-list.tsx:210 `const data = await res.json();` executes before the `if (!res.ok)` at line 211, with no .catch(); api-fetch.ts:78-81 returns the Response unchanged and toasts only on status 401, so a 502/504 HTML body makes res.json() throw SyntaxError past the toast into the catch at lines 220-221, which is only `console.error("[enrich-company] Failed:", err)` — no user-visible error, spinner cleared in finally. Sibling claim also accurate: enrichContact's catch (191-192) and findEmailForContact's catch (310-311) only console.error, while findContactsHandler (282-284) and findEmailsFo

### `src/components/campaign/contact-detail.tsx:165` [state-machine] (related: K5)

enrichment_status='in_progress' is a dead-end state: the in_progress branch renders a spinner with no retry path, and nothing server-side ever recovers a stale in_progress row.

**Failure:** person-enrichment.ts:55 writes people.enrichment_status='in_progress', then awaits LinkedIn/X/Exa calls; the terminal status is only written at the end (mergeEnrichmentData, line 208). If any pushed promise rejects unhandled (Promise.all at line 203 rethrows past the 'failed' write) or the Vercel function times out/freezes mid-run, the person stays 'in_progress' forever. ContactDetail then shows 'Enriching this contact...' with an infinite spinner and never offers onRetry (retry only renders for 'pending'/'failed'); the sparkle enrich button in the contacts tables is likewise gated to pending/failed, so the user has no UI path to re-enrich the contact, and no cron resets stale in_progress rows.

**Evidence:** Dead-end traced: contact-detail.tsx:165-179 renders `if (contact.enrichment_status === "in_progress")` with only a Loader2 spinner and no onRetry (retry renders only in the pending/failed/no-data branches); the sparkle enrich button is gated to `enrichment_status === "pending" || === "failed"` in both contacts-table.tsx:201-202 and the live table companies-list.tsx:1082-1083, and person-drawer.tsx passes onRetry to ContactDetail which never surfaces it for in_progress. No server recovery: vercel.json's only cron is /api/jobs/tick and grep finds no in_progress handling in src/app/api/jobs. Stuc

### `src/components/campaign/profile-selector.tsx:28` [swallowed-error] (related: K7)

user_profile load discards the Supabase .error and renders failure as 'no profiles', making the whole selector silently disappear (component returns null when profiles.length===0).

**Failure:** Any query failure, including the known Clerk-session-token-missing-role-claim mode where RLS to-authenticated silently returns zero rows, yields data=null; profiles becomes [] and the component returns null at line 54. The user sees no selector, no toast, no console log: a campaign with a linked profile shows nothing (the link is invisible and cannot be changed or cleared), and a user who owns profiles cannot link one. Indistinguishable from 'user has no profiles'.

**Evidence:** profile-selector.tsx:28-32: `const { data } = await supabase.from("user_profile").select("*")...; setProfiles((data as UserProfile[]) ?? []);` — the .error field is never destructured, logged, or toasted. Line 54: `if (profiles.length === 0) return null;`. On any query failure data is null, profiles becomes [], and the component returns null with zero user-visible signal; identical rendering to a genuinely profile-less user. The RLS/role-claim failure mode returns zero rows without even an error, hitting the same null return. The campaign's linked profile becomes invisible and unchangeable sin

### `src/components/company/add-person-dialog.tsx:53` [swallowed-error] (related: K14)

Orphan search uses raw fetch (not apiFetch) against the auth-protected GET /api/people/orphans, and any failure (401 from an aged Clerk cookie, 500) is caught, logged, and rendered as an empty result list.

**Failure:** Jay opens the Add-person dialog in a tab that has been open past the Clerk \_\_session cookie lifetime (his normal prod workflow): the route's getSupabaseAndUser returns null, the 401 is thrown, caught at line 57, and setResults([]) renders 'No unassigned people in your knowledge base.' The user concludes there are no orphans when the request simply wasn't authenticated; apiFetch one line away in the same file (line 80) would have attached a fresh Bearer token.

**Evidence:** src/components/company/add-person-dialog.tsx:53 uses raw `fetch(url)` against GET /api/people/orphans; line 54 throws on !res.ok; the catch (lines 57-59) only console.errors and does setResults([]); with results empty and query empty the UI renders 'No unassigned people in your knowledge base.' (lines 135-139). The route is auth-protected: src/app/api/people/orphans/route.ts:14-17 returns 401 when getSupabaseAndUser() (Clerk auth(), src/lib/supabase/server.ts:227) yields null. The same file already imports and uses apiFetch for the add path (line 16, line 80), and apiFetch's own docstring (src

### `src/components/company/embedded-org-chart.tsx:62` [correctness] (related: K14)

Three of the file's five API calls use raw fetch instead of apiFetch: the Refresh-org classify POST (line 62) and both from-company DELETEs (lines 153, 192), while the sibling reclassify PATCH in the same file correctly uses apiFetch.

**Failure:** In a long-open tab whose Clerk cookie has expired, 'Refresh org' and both Remove-from-company paths hit auth-protected routes cookie-only and 401; the user sees 'HTTP 401'/'Unauthorized' toasts and the remove/classify never happens, even though the session is perfectly refreshable (getToken would mint a token, as the PATCH on line 125 proves). Same class as the shipped K14 bug.

**Evidence:** src/components/company/embedded-org-chart.tsx: raw `fetch` at line 62 (POST /api/companies/[id]/classify-departments), line 153 (DELETE from-company in onPersonRemove), and line 192 (DELETE from-company in PersonDrawer onRemove), while the reclassify PATCH at line 125 uses apiFetch (imported line 12). Both target routes 401 without auth: src/app/api/companies/[id]/classify-departments/route.ts:20-23 and src/app/api/people/[id]/from-company/route.ts:40-42 return {error:'Unauthorized'},401 when getSupabaseAndUser() is null. In a stale-cookie tab the raw fetches carry no Bearer token, so the user

### `src/components/company/org-chart.tsx:299` [correctness]

ReactFlow gets controlled `nodes` with no `onNodesChange` and no `defaultNodes`, so @reactflow/core triggerNodeChanges discards every position and selection change (it only applies them when hasDefaultNodes is true): dragged person cards never move on screen and the `selected` ring styling can never render.

**Failure:** User drags a person card to another (tier, dept) cell to reclassify them: the card stays frozen under the original cell while the invisible drag-item position moves with the cursor. On release onNodeDragStop still fires with the drag-item position (getEventHandlerParams reads dragItems, not the store), so the PATCH lands against whatever cell the cursor happened to be over with zero visual feedback; the card then teleports after the parent refetch, or, if the user gave up mid-drag believing drag was broken, they have silently reclassified the person to a cell they never saw the card enter. Verified in node_modules/@reactflow/core 11.11.4: triggerNodeChanges applies position changes to nodeInternals only when hasDefaultNodes, else it only calls the (absent) onNodesChange.

**Evidence:** src/components/company/org-chart.tsx:298-301 passes controlled `nodes` to <ReactFlow> with no onNodesChange and no defaultNodes anywhere in the props (lines 298-342). In the installed @reactflow/core 11.11.4 (node*modules/.pnpm/@reactflow+core@11.11.4*\*/node_modules/@reactflow/core/dist/esm/index.mjs): initialState `hasDefaultNodes: false` (line 3778), only setDefaultNodesAndEdges (line 3840, driven by the defaultNodes prop) ever sets it true, and `triggerNodeChanges` (lines 3920-3930) applies position/selection changes to the store only inside `if (hasDefaultNodes)`, otherwise it only calls t

### `src/components/email-skills/learnings-section.tsx:75` [swallowed-error] (related: K7,K21,K22)

load() bails silently on !res.ok (`if (!res.ok || !mountedRef.current) return;`) with no toast, no error state, and no logging, so an API failure renders the section as the 'Nothing yet' empty state.

**Failure:** GET /api/learnings returns 500 (any of its three queries erroring returns firstError) or 401: loading flips false in finally, learnings stays [], and the page asserts 'Nothing yet. Learnings appear once there are enough sends...' to a user who has active learnings and suppressions in the DB. A suppressed address looks un-suppressed. Same failure-as-empty class as K7/K21/K22.

**Evidence:** src/components/email-skills/learnings-section.tsx:75 `if (!res.ok || !mountedRef.current) return;` exits load() with no toast, no error state, no logging; the finally (line 84) still flips loading to false, so with learnings [] the component renders 'Nothing yet. Learnings appear once there are enough sends...' (lines 165-170) and the Suppressed section is hidden entirely (line 346 `suppressions.length > 0 &&`). The route really can return non-ok: src/app/api/learnings/route.ts:13-15 returns 401 unauthenticated, and lines 38-41 return 500 with firstError when any of the three parallel queries

### `src/components/outreach/activity-detail.tsx:63` [swallowed-error]

The detail fetch never checks res.ok: a 404/500 JSON body {error: ...} is stored as DetailPayload with state 'idle', and the render then dereferences data.sent.to_email on undefined, throwing a TypeError that trips the route error boundary and replaces the whole /outreach page.

**Failure:** User expands an activity row whose sent_emails row is RLS-denied or since deleted (route returns 404 {error:'Not found'}), or the query transiently fails (500 {error:'Could not load message'}). setData({error}) runs, state becomes 'idle', render reaches data.sent.to_email -> 'Cannot read properties of undefined', and src/app/error.tsx swallows the entire outreach dashboard instead of showing 'Could not load this message' in the one row.

**Evidence:** apiFetch returns the Response unchanged including non-2xx (api-fetch.ts:78-81, doc lines 67-68). activity-detail.tsx:62-68 does `.then((r) => r.json()).then((payload) => { setData(payload); setState("idle"); })` with no res.ok check. The route returns JSON error bodies: 401 `{error:"Unauthorized"}` ([id]/route.ts:43), 500 `{error:"Could not load message"}` (line 60), 404 `{error:"Not found"}` for RLS-hidden/deleted rows (lines 63-65). The render guard `if (state === "failed" || !data)` (activity-detail.tsx:115) passes because `{error:...}` is truthy, then line 127 `data.sent.to_email` derefere

### `src/components/outreach/outreach-drafts-panel.tsx:85` [correctness]

classifyDraft judges 'past the scheduled delay' using the enrollment-level next_send_at that page.tsx stamps onto every step's draft (page.tsx:233 reads sequence_enrollments.next_send_at, which describes only the current step), so every approved later-step draft of a due enrollment classifies 'ready'.

**Failure:** A 3-step enrollment reaches step 1's due time with all steps approved: the hero announces '3 emails ready to send' when only one is due; every 'Send all' run then produces '2 belong to a later step' toasts (and, with the ordering in the previous finding, real premature sends). The 'N drafts in flight' framing and confirm dialog ('This sends all 3 emails from your mailbox now') promise sends that mostly 409.

**Evidence:** page.tsx:233 stamps the enrollment-level value onto every draft: `next_send_at: enrollment?.next_send_at ?? null` (from the sequence_enrollments embed at page.tsx:93). classifyDraft (outreach-drafts-panel.tsx:83-88) returns 'ready' for any approved+draft row with an inbox and enrollment whose next_send_at is null or past, with no step comparison, so all pre-drafted later steps of a due enrollment classify 'ready'. The hero receives `drafts.filter((d) => classifyDraft(d) === "ready")` (page.tsx:320) and announces 'N emails ready to send' (hero:95) with the confirm dialog promising to send all N

### `src/components/signals/campaign-signals-popover.tsx:50` [swallowed-error] (related: K7)

fetchSignalsData ignores signalsRes.error and togglesRes.error; a failed query renders as 'No signals defined.' or as every toggle switched off.

**Failure:** signals query fails (network blip, or the Clerk-session role-claim RLS failure that silently returns nothing) -> signalsRes.error set, data null-coalesced to [] -> popover confidently shows 'No signals defined.' and the trigger badge shows 0/0, even though the user's 11 built-in signals exist. If only the campaign_signals query fails, all switches render unchecked, misrepresenting which signals are armed for the campaign.

**Evidence:** src/components/signals/campaign-signals-popover.tsx:43 (`for (const row of togglesRes.data ?? [])`) and line 50 (`signals: (signalsRes.data as Signal[]) ?? []`) never inspect signalsRes.error or togglesRes.error; supabase-js returns `{ data: null, error }` on failure without throwing, so the null-coalesce silently converts an error into empty results. With signals=[] the popover hits the `signals.length === 0` branch at lines 143-146 rendering 'No signals defined.', and the trigger badge (lines 121-125) shows `0/0` because `data` is the truthy `{signals: [], enabled: {}}`. If only the campaign

### `src/components/tracking/tracking-table.tsx:65` [swallowed-error] (related: K7)

Both tracking_changes queries (ExpandableSignalRow line 65, ExpandableCompanyRow line 218) destructure only { data } and never read .error, so a failed query renders as 'No changes recorded yet.'

**Failure:** Clerk session token missing the role claim (or any RLS/network failure) makes the client-side supabase select return { data: null, error }; setChanges([]) runs, loading spinner clears, and the expanded row shows 'No changes recorded yet.' for a config that has months of recorded changes. User concludes tracking found nothing.

**Evidence:** tracking-table.tsx:65 and :218 both destructure only { data } from the tracking_changes select; .error never read. On failure data=null, lines 71/226 `(data as TrackingChange[]) ?? []` set empty state, and tracking-timeline.tsx:11-15 renders 'No changes recorded yet.' for changes.length===0. Contrast: the update at lines 82-87 does check error and toasts. Project memory documents the exact Clerk-role-claim RLS failure that returns { data: null, error } silently.

### `src/components/tracking/tracking-table.tsx:335` [correctness]

By-company 'Latest Changes' aggregation compares row.latestChangeDate against group.lastRunAt (which the same iteration just overwrote) instead of a tracked latest change date, so an older change can win over a newer one.

**Failure:** Company has two configs: config A (change dated Aug 1) processed first sets group.latestChangeDescription = A's text and group.lastRunAt = Aug 6. Config B has a newer change (Aug 5), but Aug 5 > Aug 6 is false, so B's newer description is discarded and the company row shows the stale Aug 1 change. CompanyGroup has no latestChangeDate field at all, so the comparison can never be correct.

**Evidence:** tracking-table.tsx:331-336: guard is `row.latestChangeDate > (group.lastRunAt ?? "")`, comparing a change date to a run date that lines 325-330 may have just overwritten in the same iteration. CompanyGroup (lines 36-44) has no latestChangeDate field, so no correct comparison is possible; the first row processed wins via !group.latestChangeDescription and later rows' newer changes lose whenever their change date < group max lastRunAt (change dates are <= run dates, so this is the normal case).

### `src/lib/email-composition/compose.ts:67` [correctness] (related: K18)

cacheControl in call-level providerOptions maps to the API's top-level cache_control, which auto-places the breakpoint on the LAST cacheable block (the per-contact user prompt), so the cache is keyed to content that varies on every fan-out call and the stable Opus system prompt is never actually served from cache.

**Failure:** draftEmailsForSequence fans out N contacts through composeEmail. Each request's cache breakpoint lands after the varying per-contact prompt (verified in node_modules/@ai-sdk/anthropic/dist/index.mjs:3138, which emits top-level cache_control), so no request's prefix matches a prior entry: cache_read_input_tokens stays 0 and every call pays full Opus input price PLUS the 1.25x cache-write premium on the large system prompt (voice profile + fact bank + learnings). The comment's claimed 'prompt cache hits on all but the first call' never happens; the parameter makes the batch strictly more expensive than no caching. Fix is a cache_control breakpoint on the system prompt (message-level providerOptions), not the call-level option.

**Evidence:** compose.ts:64-67 sets cacheControl in call-level providerOptions.anthropic. The installed @ai-sdk/anthropic (dist/index.mjs ~3139) emits it as the API's top-level parameter: `...(anthropicOptions?.cacheControl) && { cache_control: anthropicOptions.cacheControl }`. Per Anthropic's documented semantics, top-level cache_control auto-places the single breakpoint on the LAST cacheable block; render order is tools -> system -> messages, so the breakpoint lands after the per-contact user prompt (buildComposeUserPrompt, which skill.ts:135-138 itself notes 'varies per contact'), not after the stable sy

### `src/lib/jobs/executors/email-classify.ts:90` [swallowed-error]

Intent is stamped on the reply row before the suppression upsert, so a failed outreach_suppressions upsert is permanently lost: the row leaves the scan window (intent no longer null) and no path ever retries the suppression.

**Failure:** A prospect replies 'unsubscribe'. The intent update at line 67 succeeds; the suppression upsert at line 90 fails once (transient network error / pool exhaustion). The error is logged and the loop continues, the job completes successfully. The next run's scan predicate `is("intent", null)` skips the row forever, so the opt-out never reaches outreach_suppressions and claimAndSendDraft keeps sending follow-ups to someone who explicitly unsubscribed: a compliance and deliverability risk. Fix is to upsert the suppression before (or atomically with) stamping intent.

**Evidence:** src/lib/jobs/executors/email-classify.ts:40 scan predicate '.is("intent", null)'; intent stamped at lines 67-75 BEFORE the outreach_suppressions upsert at 90-110; on failure lines 111-117 log and 'continue', and the job returns success. shouldSuppress/suppressionReason are imported only here (grep over src), so no other path derives suppressions from classified replies: once intent is non-null the row never re-enters the scan window and the opt-out is permanently lost. claimAndSendDraft's gate (outreach-sender.ts:226-249) reads outreach_suppressions only, so follow-ups keep sending.

### `src/lib/jobs/executors/email-cleanup.ts:42` [swallowed-error] (related: K5)

The sent_emails lookup error is never read; on query failure sentRows is undefined, sentIds is empty, and every stranded queued draft is misclassified as never-sent and reset to status='draft', re-arming already-sent emails for a duplicate send.

**Failure:** A send process died after SMTP accept + sent_emails insert, leaving the draft 'queued' >24h (exactly the population this recovery exists for). On the next daily cleanup the sent_emails select at line 42 fails transiently; the code takes `sentRows ?? []`, computes wasSent=[] and neverSent=all, and updates the truly-sent draft back to status 'draft'. Its review_status is still 'approved', so the enrollment send path re-claims it and the prospect receives the same email twice. The stuck/select errors at lines 34 and 42 are both unread, so the job still reports clean success.

**Evidence:** src/lib/jobs/executors/email-cleanup.ts:42-45 destructures only { data: sentRows } from the sent_emails select (error unread), line 46 'new Set((sentRows ?? []).map(...))'. On a query failure sentIds is empty, so line 49 puts every stuck id in neverSent and lines 60-66 update them to status 'draft'. The stuck query at line 34 is likewise error-blind, and the function returns clean counts. outreach-sender.ts:405-411 atomically claims any draft with '.eq("status", "draft")' and no check for an existing sent_emails row before sending (grep shows no duplicate guard), so a truly-sent draft reset to

### `src/lib/jobs/executors/outreach-process.ts:93` [swallowed-error] (related: K7)

handleSignalTrigger (and pickAndDraft) never read .error on any query: sequences, people, campaign_people, enrollments, campaign, org reads that fail are indistinguishable from empty, so a signal fire silently does nothing and the job completes successfully

**Failure:** The sequences select at line 93 fails (proxy hiccup, RLS misconfig, URL-too-long on the .in('person_id', ...) list at line 140 for a large org). data is null, error unread, function returns {sent:0, reason:'no matching sequences'} or 'no enrollments': the job row shows success, no retry fires (the error never throws so maxAttempts is irrelevant), and the outreach the tracking verdict promised evaporates with zero log evidence. Same pattern on ~8 queries in this file.

**Evidence:** outreach-process.ts: the sequences select at line 93 and ~10 more reads (people 129, enrollments 146, signal 184, people 192, cpRows 202, suppressions 232, campaign 293, org 314, step1 377, existingDraft 391) destructure only { data }, never .error; only the enrollment insert at 357-369 checks error. A failed read makes data null and the function returns {sent:0, reason:'no matching sequences'} (100-102) or 'no enrollments' (148-149) as a clean success — no throw, so job-queue maxAttempts/retry never engages.

### `src/lib/jobs/executors/outreach-process.ts:598` [swallowed-error] (related: K3)

In handleFollowups, a failed campaign_people read defaults outreach_status to 'sent', bypassing the replied/bounced stop checks and sending a follow-up anyway

**Failure:** The .single() on campaign_people errors transiently (cp null, error never read). outreachStatus falls back to 'sent', so the 'replied' short-circuit at line 601 and the bounced/complained check at 611 are skipped, and checkCondition('no_reply','sent') passes: the cron sends the next-step follow-up to a contact who already replied or bounced. Compounds K3, which already downgrades 'replied' at send time.

**Evidence:** outreach-process.ts:592-598: `const { data: cp } = ...single(); const outreachStatus = cp?.outreach_status ?? "sent";` — error unread, fallback 'sent' skips the replied stop (line 601) and bounced/complained stop (line 611), and checkCondition('no_reply','sent') is true (line 655), so sendApprovedDraft runs. Verified outreach-sender.ts has no outreach_status re-check (gates are suppression list at 227, canSendTo verification at 370; it unconditionally writes outreach_status:'sent' at 600), so a replied contact with a pre-approved next-step draft gets the follow-up.

### `src/lib/jobs/executors/tracking-dispatch.ts:43` [swallowed-error] (related: K8)

next_run_at advance never checks .error: if the update fails, the config is re-dispatched every 15 minutes forever, duplicating signal executions, snapshots, LLM spend, and risking double outreach enqueues

**Failure:** enqueueJob succeeds, then the tracking_configs update fails (result entirely discarded, contradicting the header comment 'a config is never double-dispatched'). The next dispatch tick 15 minutes later sees next_run_at still <= now and enqueues another tracking.run. If the failure persists (e.g. bad column after a migration drift), a weekly-cadence config runs 96x/day: duplicate tracking_snapshots and Exa/LLM cost, and two runs racing the same prev snapshot can both see the diff and both enqueue outreach.process.

**Evidence:** tracking-dispatch.ts:43-46: the next_run_at update's result is entirely discarded (not even destructured), while the select at line 18 does check error — so a failed update (supabase-js returns {error}, never throws) leaves next_run_at <= now and the next 15-min recurring dispatch re-enqueues tracking.run for the same config. The enqueue at line 30 is a one-shot payload job not covered by the recurring-per-type dedupe index (per reply-backfill.ts:38-41), so duplicate runs, snapshots, and LLM spend follow; header comment 'never double-dispatched' (lines 8-10) is only true if this unchecked upda

### `src/lib/jobs/executors/tracking-run.ts:105` [swallowed-error] (related: K8)

prev-snapshot query error is ignored: a transient read failure makes prevSnapshot null, the run inserts the CURRENT snapshot and returns 'baseline', permanently swallowing whatever change actually happened

**Failure:** Company adds 5 roles between runs. On the next tracking.run the tracking_snapshots select fails transiently (data null, error unread). hasChanged=true, the new snapshot (with the 5 roles) is inserted, then prevData null routes to the baseline early-return. The following run diffs against this new snapshot and sees no change. The threshold crossing is never detected, no tracking_changes row, no intent evaluation, no outreach: the exact event the user configured tracking for is silently lost forever, and the job reports clean success.

**Evidence:** tracking-run.ts:105-113: `const { data: prevSnapshots } = await ...` never reads .error; on a failed read prevSnapshot=null, hasChanged=true (line 113), the CURRENT snapshot is inserted at line 116, then `if (!prevData)` at line 151 returns {changed:false, baseline:true}. The next run diffs against the post-change snapshot and sees no delta, so the change never produces a tracking_changes row or intent evaluation, and withAction completes as job success.

### `src/lib/safe-fetch.ts:230` [security]

DNS rebinding TOCTOU: assertPublicUrl vets resolved addresses but fetch() re-resolves the hostname itself; the vetted IPs are never pinned.

**Failure:** assertPublicUrl calls resolveHost and checks every address, then safeFetch calls fetch(target) which performs its own independent DNS lookup (undici -> getaddrinfo, uncached on default macOS/Linux). An attacker-controlled domain with TTL 0 answers a public IP to the guard's lookup and 169.254.169.254 (or 127.0.0.1:54321, the operator's own Supabase) to fetch's lookup. The URL arrives via CSV import/agent/Exa/scraped links (the file's stated threat model), and the fetched body is returned in API responses and persisted into enrichment_data: exactly the bypass the header comment says check #2 exists to stop. Fix requires pinning: connect to the vetted IP (custom lookup/Agent) rather than re-resolving.

**Evidence:** safe-fetch.ts:226 vets via assertPublicUrl, which resolves with node:dns lookup and checks every address (lines 148-165), but line 230 then calls fetch(target) with the hostname URL: undici performs its own independent DNS resolution and the vetted IPs are never pinned (no custom dispatcher, Agent, or lookup override anywhere in the file; the connection is never made to the checked address). A TTL-0 attacker domain answering a public IP to the guard's lookup and 169.254.169.254/127.0.0.1 to fetch's lookup bypasses check #2, and the redirect re-vetting (line 251) has the identical gap per hop.

### `src/lib/services/chat-history.ts:74` [swallowed-error] (related: K21)

loadChat folds query errors into null; the chat page renders an empty thread and the next save upserts over the real history, destroying it.

**Failure:** loadChat returns null on any error (line 74), indistinguishable from 'chat does not exist'. src/app/chat/[id]/page.tsx:201 then does setInitialMessages(chat?.messages ?? []), rendering the user's existing chat as empty. useChat starts from [], and on the next message onFinish calls saveChat with allMessages = only the new turn; saveChat upserts messages wholesale on id conflict, permanently overwriting the stored history with the single new exchange. A transient DB/network error at load time plus one user message equals silent loss of the whole conversation.

**Evidence:** chat-history.ts:74 `if (error || !data) return null` makes a query error indistinguishable from a missing chat. chat/[id]/page.tsx:203 does setInitialMessages(chat?.messages ?? []), so the thread renders empty and useChat initialises from [] (page.tsx:64). On the next turn, both saves overwrite: the client onFinish (page.tsx:66-75) passes allMessages = the empty-started state plus the new turn, and the server save (api/chat/route.ts:165-175) uses originalMessages: uiMessages posted by that same client. saveChat (chat-history.ts:44-54) upserts the messages column wholesale on id conflict, so th

### `src/lib/services/claim-reconciler.ts:13` [correctness]

matchesScrapedJob bidirectional-substring match is too strict; its own docstring example fails, producing false 'contradicted' on live roles.

**Failure:** Docstring claims 'Hiring: Growth Director' matches 'Growth Director (Remote)', but neither lowercase string contains the other, so some() returns false. Extractor statements are full sentences ('Acme is hiring a Head of Growth') while scraped titles carry decoration ('Head of Growth (Remote)', 'Sr. Head of Growth'); whenever both sides carry extra text, a role that IS on the live careers page gets status 'contradicted', excluded from scoring per system-prompt.ts:230 and shown struck-through in the company detail UI.

**Evidence:** claim-reconciler.ts:13-18 is a pure function: s='hiring: growth director', t='growth director (remote)'; s.includes(t)=false and t.includes(s)=false, so the docstring's own example (line 12) returns false and the claim is marked 'contradicted' at lines 42-44. Extractor statements are full sentences per claim-extractor.ts:80 ('One factual sentence about the company'), and scraped titles carry decoration (location appended, e.g. route.ts:469 shows the '(Location)' pattern), so both sides routinely carry extra text and bidirectional full-containment fails for live roles.

### `src/lib/services/contact-discovery.ts:238` [swallowed-error] (related: K7)

orgPeople and campaign_people dedup queries swallow .error; a failed query empties the dedup set and re-bills the entire known roster.

**Failure:** Both `const { data: orgPeople } = await supabase.from('people')...` (line 238) and the campaign_people query (line 262) never read .error. On a transient failure or RLS misconfiguration (the Clerk role-claim failure mode this repo has hit before returns nothing), existingUrls is empty and alreadyLinkedTotal is 0: every already-attached contact is re-fetched from Exa, re-judged by the LLM, re-billed, and reported to the agent as newly found, while alreadyLinked=[] tells it nobody is on file: exactly the double-billing loop the comment at line 229 says this dedup exists to prevent, silently reintroduced by any query error.

**Evidence:** contact-discovery.ts:238-241 (`const { data: orgPeople } = await supabase.from('people')...`) and lines 261-272 (campaign_people query) destructure only data, never .error. On a failed query data is null, so `orgPeople ?? []` yields an empty existingUrls set and alreadyLinkedTotal 0; every already-attached contact then fails the dedup checks at lines 292 and 410 and is re-fetched from Exa, re-judged via filterContactsByCompany, and returned as newly found with alreadyLinked=[]: precisely the double-billing loop the comment at lines 229-237 says this dedup prevents. The trigger is any query err

### `src/lib/services/contact-discovery.ts:326` [correctness]

A person whose affiliation attach was refused because they are filed under a DIFFERENT company is still campaign-linked and returned as a contact of this company.

**Failure:** Phase 1 (line 326) calls linkPersonToCampaign unconditionally, before even reading the recordAffiliation result; phase 2 (line 543) links on any non-detach verdict regardless of write.written. Scenario: a person the user entered at OtherCo (user_entered 1.0) appears on the target company's stale team page; recordAffiliation refuses the team_page 0.9 cross-org move ('not_stronger_than_existing'), yet they are inserted into campaign_people for this campaign and pushed into contacts as 'unchanged'. canDraftFor passes for them (organization_id=OtherCo, confidence 1.0 >= 0.6), so campaign drafting/sending paths that iterate campaign_people will email a person confirmed to work elsewhere a pitch about the wrong company. Phase 2's own comment (line 539) states linking would 'act on the judgement the database just refused' but only applies that to detaches.

**Evidence:** Phase 1: contact-discovery.ts:326 `if (campaignId) await linkPersonToCampaign(...)` runs unconditionally regardless of the recordAffiliation result at line 311; phase 2: line 543 `if (campaignId && !detaching)` links even when write.written is false (notAtJudgedOrg is only set on detaching writes, affiliation.ts:208-214, never on a cross-org attach refusal via case 4 at affiliation.ts:265-278). findOrCreatePerson deliberately does not move organization_id (knowledge-base.ts:207-216), so the person stays filed at OtherCo yet is campaign-linked and pushed into contacts as 'unchanged' (lines 332-

### `src/lib/services/contact-discovery.ts:495` [state-machine]

Freshly discovered rejected/former-employee candidates never get employer_mismatch/former_employee evidence or affiliation_detached_from recorded; the re-attach guard never arms.

**Failure:** For verdict rejected/former_employee, findOrCreatePerson (line 481) creates a NEW person with organization_id null (attachTo=null), then recordAffiliation is called with organizationId:null, detachedFrom:organizationId. affiliation.ts:208's scope check sees person.organization_id (null) !== detachedFrom and refuses with notAtJudgedOrg, so affiliation_detached_from, employer_mismatch source and the judge's employerSeen evidence are never written for any newly created wrong-company person. Consequence: the case-2a guard in affiliation.ts:232 (which exists to stop re-filing someone under 'the same wrong company') is inert for these rows: a later searchPeople search_stamp write (0.2, case 2b: any positive weight attaches a nowhere-attached person) files them at the exact company the judge just rejected, restarting the loop the detached_from column was built to terminate. The user is meanwhile told they were 'detached' (departedCount/rejectedAsWrongCompany incremented).

**Evidence:** contact-discovery.ts:464 sets attachTo=null for rejected/former_employee; findOrCreatePerson (line 481, knowledge-base.ts:262+) inserts a fresh person with organization_id null and no affiliation columns; recordAffiliation's scope check (affiliation.ts:208: person.organization_id !== detachedFrom, i.e. null !== orgId) refuses with notAtJudgedOrg before anything is written, so affiliation_detached_from, the employer_mismatch source and the judge's evidence never land. contact-discovery.ts:519-523 still increments rejectedAsWrongCompany/departedCount, and affiliationNotes (line 151-154) tells th

### `src/lib/services/contact-filter.ts:163` [correctness]

When sitemap.xml exists but zero URLs match the team keywords, urlsToTry is empty and the common-path fallback (/team, /about, ...) is never tried, so findPeopleOnDomain returns [] for sites that do have team pages; sitemap-index files guarantee this.

**Failure:** A WordPress site (very common in the small-business target ICP) serves sitemap.xml as a sitemap INDEX whose <loc> entries are sub-sitemap files like wp-sitemap-posts-page-1.xml. fetchSitemapUrls returns those (the loc regex doesn't distinguish indexes from URL sets), none contain '/team' or '/about' as a path segment, urlsToTry filters to [], toFetch is empty, and the function returns [] even though https://domain/about-us exists and lists the staff. The fallback guess-list at line 175 only runs when the sitemap fetch itself fails, so exactly the sites with a well-formed sitemap index silently yield no team-page contacts and contact-discovery loses its cheapest, highest-precision source.

**Evidence:** contact-filter.ts:163-181: when `sitemapUrls.length > 0`, urlsToTry is the keyword-filtered list and the common-path fallback (['/team','/about','/about-us','/people']) lives exclusively in the `else` (no-sitemap) branch. With a sitemap-index response, fetchSitemapUrls' loc regex (:134-138) returns sub-sitemap filenames (e.g. wp-sitemap-posts-page-1.xml) that match no `/${kw}` keyword, so urlsToTry=[], toFetch=[] (:184), Promise.allSettled([]) yields nothing, scrapedContent stays empty, and the function returns [] at :208 without ever trying /about-us. Reachability of the index case is real: s

### `src/lib/services/contact-selector.ts:119` [correctness]

validPicks is neither clamped to maxPicks nor deduplicated by personId; the only enforcement of 'pick up to N contacts' is a sentence in the prompt.

**Failure:** outreach-process.ts:282 calls selectContactsForSignal with maxPicks = clamp(payload.maxContacts ?? 1, 1, 5). If the model returns 4 picks when maxPicks=1 (nothing in the schema bounds the array), all 4 survive the candidateIds filter and outreach-process drafts an email for every pick; with payload.autoSend set, 4 people get emailed off one signal when the user configured 1. The per-(enrollment,step) draft guard in outreach-process only catches exact duplicate personIds, not over-count of distinct people. Fix is one line: validPicks.slice(0, maxPicks) plus a seen-set.

**Evidence:** contact-selector.ts:47-49: verdictSchema.picks is an unbounded z.array(pickSchema). contact-selector.ts:118-123: validPicks admits every pick passing `candidateIds.has(p.personId)` with no slice to maxPicks and no per-personId dedup; maxPicks appears only in the prompt sentence at :108 ('Pick up to ${maxPicks} contact(s)'). Caller outreach-process.ts:282-287 passes maxPicks = Math.min(Math.max(payload.maxContacts ?? 1, 1), 5), then :333 `for (const pick of picks)` drafts for every returned pick per sequence, with autoSend queueing each draft at :481. Nothing between the untrusted model output

### `src/lib/services/data-quality.ts:83` [swallowed-error] (related: K7,K22)

Both audit queries destructure only { data } and discard .error, so a failed organizations or people query yields an empty list and the audit reports a clean bill of health with zero findings.

**Failure:** RLS misconfiguration or a transient Supabase error makes the organizations select fail (e.g. the known Clerk role-claim issue mapping the session to anon): orgs is null, orgList=[], every check runs over empty data, and runDataQualityAudit returns findings=[], counts {organizations:0, people:0} with no truncated flag. The agent tool at enrichment-tools.ts:2274 then tells the user their data has no quality problems, which is precisely the failure mode this read-only audit exists to prevent. Same class as K7/K22.

**Evidence:** data-quality.ts:83-93: both queries destructure only `{ data: orgs }` / `{ data: people }`; `.error` is never read. :95-96 `orgList = orgs ?? []` converts a failed query (supabase-js returns {data: null, error}) into an empty scan; every check iterates empty lists, and the truncated flag (:264-267) stays unset because 0 < MAX_ROWS, so the return is findings=[], counts {organizations:0, people:0}. The tool at enrichment-tools.ts:2272-2279 returns that clean report to the agent verbatim. Caveat on the cited example: an RLS/anon-role misconfiguration returns zero rows WITHOUT an error (RLS filter

### `src/lib/services/email-tracking.ts:68` [swallowed-error] (related: K3,K7)

applyInboundStatus ignores .error on both status updates and its write order makes a campaign_people failure permanent: sent_emails is updated first, so if the campaign_people update fails, the next tracking poll (email-track.ts:71 filters status in sent/delivered/opened) excludes the row forever and outreach_status is never retried.

**Failure:** Reply arrives; sent_emails.status becomes 'replied' but the campaign_people update hits a transient Supabase error that is never read. Function still returns true (updated++ counted) and fires the email_replied PostHog event. Every subsequent 10-min poll skips the row because its status is now 'replied', so campaign_people.outreach_status stays 'sent' permanently and the follow-up cron keeps emailing a person who already answered: same user impact as K3, via a different path.

**Evidence:** src/lib/services/email-tracking.ts:68-76: both `await supabase.from("sent_emails").update(...)` and `await supabase.from("campaign_people").update({ outreach_status: newStatus })` discard their result objects entirely (supabase-js returns {error} rather than throwing, so the try/catch around applyInboundStatus in email-track.ts:191-195 never fires), then the function unconditionally fires the PostHog event (lines 95-106) and returns true. Permanence traced: src/lib/jobs/executors/email-track.ts:71 selects only `.in("status", ["sent", "delivered", "opened"])`, so once sent_emails.status='replie

### `src/lib/services/google-places-service.ts:122` [correctness]

Domain cross-check detects that the matched Place's website is a different company but explicitly proceeds anyway, returning found=true with the wrong business's rating and reviews; the getGoogleReviews tool (enrichment-tools.ts:2233) then merges them into the org's enrichment_data and its schema falsely advertises domain as 'cross-verification'.

**Failure:** Agent enriches 'Apex' (apex.io); Places text search returns 'Apex Gym' with websiteUri apexgym.com. Mismatch is only console.logged '(proceeding anyway)', result.found=true, and the gym's 4.8 rating plus five member reviews are stored under the target org and offered to drafting as 'customer sentiment and outreach hooks': the outbound email cites reviews of an unrelated namesake business. Same namesake-merge class as the known enrichment bug.

**Evidence:** src/lib/services/google-places-service.ts:122-125: `if (placeHost !== targetHost) { console.log("[GooglePlaces] Domain mismatch: ... (proceeding anyway)") }` — the mismatch has no effect on control flow; execution falls through to the `return { found: true, ... }` at line 154 with the mismatched place's rating/reviews. Consumer: src/lib/tools/enrichment-tools.ts:2233-2242 does `if (result.found) { await mergeEnrichmentData("organizations", input.organizationId, { googleReviews: { rating, reviewCount, topReviews, ... } }) }` with no domain re-check, and the input schema at line 2218 describes d

### `src/lib/services/knowledge-base.ts:235` [correctness]

findOrCreatePerson's name+org fallback matches by normalized name only and ignores a conflicting linkedin_url on the matched row, so two different same-named people at one company collapse into one person record.

**Failure:** Existing row: 'John Smith' at Acme with linkedin_url A. Discovery finds a second John Smith at Acme with linkedin_url B; the LinkedIn dedup at line 189 misses (B != A), the fallback at line 235 matches on stripDiacritics(name) alone and returns row A as if it were person B. B's title/emails are merged into A only where A had blanks, and every downstream step (enrichment, affiliation, outreach) now treats A's email and B's discovery context as one human: outreach cites the wrong person's evidence. The fallback should at minimum refuse to match when both sides carry different linkedin_urls.

**Evidence:** knowledge-base.ts:234-237: the fallback matches solely on stripDiacritics(name).toLowerCase() among rows at the organization; the only linkedin_url handling on the matched row is :241-242 `if (normalizedLinkedin && !match.linkedin_url) updates.linkedin_url = ...`, so when the match already carries a different linkedin_url the conflict is silently ignored and the row is returned as the incoming person (:256), merging B's title/emails into A's blanks (:243-250). The LinkedIn dedup at :188-193 misses because it queries eq(linkedin_url, B). No guard refuses the match on conflicting URLs.

### `src/lib/services/knowledge-base.ts:355` [swallowed-error] (related: K7)

mergeEnrichmentData ignores both the read error and the write error: a failed enrichment_data read makes the 'additive' merge destructive (existing keys silently replaced by only the new payload), and a failed update leaves the record stuck at enrichment_status='in_progress' while the enrichment job reports clean success.

**Failure:** Person already has enrichment_data.linkedin (10 posts, profile). A later enrichment run's read at line 355 fails transiently (PostgREST/network error is never checked; existing=null so existingData={}), the update at line 378 then writes merged = only the new keys: the stored LinkedIn posts and prior errors array are permanently dropped, and drafting prompts lose that ground truth. Conversely if the final update fails, the Apify/Exa spend is paid, callers (person-enrichment.ts sets enrichment_status='in_progress' first) leave the row pinned 'in_progress' forever, and nothing logs or retries.

**Evidence:** knowledge-base.ts:355-359 destructures only `data` from the enrichment_data read; on any PostgREST/network error existing is undefined, existingData = {} (:361-362), and the 'additive' merge (:365-376) reduces to just newData, which the update at :378-386 writes over the stored JSON, dropping prior linkedin posts and the errors array. The update's error is also never read (no destructuring at all), and person-enrichment.ts:55 sets enrichment_status='in_progress' with mergeEnrichmentData (:208) as the only path that clears it, so a lost final write leaves the row 'in_progress' with no log or re

### `src/lib/services/organization-website.ts:167` [correctness]

mergeOrganizations can never delete the old org: the orgs_delete RLS policy (20260804000000) requires a campaign_organizations link from the caller's campaign to the row, but the merge moves or deletes every such link to toId before attempting the delete, so the DELETE always matches 0 rows and deletedOld is always false.

**Failure:** User fills in a website that collides with an existing org. mergeOrganizations repoints all of the caller's campaign_organizations rows off fromId (lines 91-102), computes remaining=0, then runs the delete with the user-scoped client; the orgs_delete policy's EXISTS(campaign_organizations co JOIN campaigns c WHERE co.organization_id=fromId AND c.user_id=caller) is now false, delete returns [], deletedOld=false. Every merge on every install leaves an orphaned domain-less duplicate org and shows the self-contradictory message 'The old entry was kept: 0 row(s) still point at it.' This is the same silent no-op the migration comment claims it fixed.

**Evidence:** organization-website.ts:91-102 deletes or repoints every campaign_organizations row for fromId (and camp_orgs_select, 20260427000000_clerk_auth_migration.sql:248-249, guarantees `ours` is exactly the caller's link set) before the delete at :165-169 runs with the same user-scoped client (route.ts:18/45 uses getSupabaseAndUser; enrichment-tools.ts:1690/1698 uses toolSession). The orgs_delete policy (20260804000000_tenant_policy_hardening.sql:107-116) requires EXISTS(campaign_organizations co JOIN campaigns c ... co.organization_id = organizations.id AND c.user_id = requesting_user_id()), which i

### `src/lib/services/outreach-sender.ts:645` [swallowed-error] (related: K5)

advanceEnrollmentAfterSend cannot distinguish 'no next step' from a failed sequence_steps query: .single()'s error is never read, and a null nextStepRow from a transient error marks the enrollment status='completed', permanently truncating the sequence.

**Failure:** Enrollment is on step 1 of a 3-step sequence. Step 1 sends successfully via sendApprovedDraft, then the sequence_steps lookup for step 2 hits a transient PostgREST/network error (or an RLS denial). data is null, error is ignored, and the enrollment is written status='completed'. Steps 2 and 3 (already drafted and possibly approved) never send, the prospect silently never gets follow-ups, and nothing surfaces the failure: the enrollment looks legitimately finished in the UI and no cron revisits completed enrollments.

**Evidence:** src/lib/services/outreach-sender.ts:638-651: `const { data: nextStepRow } = await supabase.from("sequence_steps")...single();` — the error field is never destructured, and no `throwOnError` is configured anywhere in the repo (grep confirms), so supabase-js resolves a failed query as {data: null, error} without throwing. Line 645 `if (!nextStepRow)` then writes `status: "completed"` (lines 646-650), permanently completing the enrollment on any transient query error. The function is invoked after every successful sequence send: sendApprovedDraft line 819 and sendDraftAndAdvance -> advanceEnrollm

### `src/lib/services/outreach-sender.ts:743` [swallowed-error]

draftIsCurrentStep fails open: any error on the enrollment or step lookup (maybeSingle error is never read, data comes back null) returns { current: true }, disabling the out-of-order-send guard it exists to enforce.

**Failure:** The agent's sendEmail/sendBulkEmails tools (email-tools.ts:929, 1097) call draftIsCurrentStep before sending a sequence draft. A transient DB error during the sequence_enrollments fetch makes enrollment null, so the function returns current:true and the send proceeds for a step-3 approved draft while the enrollment is still waiting on step 1: the prospect receives the breakup/follow-up email before the intro email it references. The function's own doc comment names exactly this as the harm it prevents.

**Evidence:** src/lib/services/outreach-sender.ts:731-761: both lookups use `const { data } = ...maybeSingle()` with the error never read, and both null branches fail open — line 743 `if (!enrollment) return { current: true };` and line 752 `if (!step) return { current: true };`. A transient PostgREST error makes data null (supabase-js does not throw; no throwOnError in repo), so the function returns current:true and the send proceeds. Callers confirmed: src/lib/tools/email-tools.ts:929 and :1097 call draftIsCurrentStep as the out-of-order-send gate before sending sequence drafts, and the function's own doc

### `src/lib/services/real-spend.ts:31` [correctness]

fetchAnthropicSpend sends bucket_width=1h to /v1/organizations/cost_report, but the Cost API supports daily granularity only ('1d' is the sole accepted value per the Admin API reference), so every short-window request fails and returns null.

**Failure:** User opens the cost dashboard with the 24h period selected. windowMs <= 36h picks bucketWidth='1h'; the cost_report request is rejected (res.ok false), fetchAnthropicSpend logs and returns null, and the dashboard silently falls back to the local '(est)' figure for Claude spend on every 24h view, even with a valid ANTHROPIC_ADMIN_KEY configured. Real billed spend is only ever shown for 7d/30d windows. (Secondary: limit=365 also exceeds the documented 31-bucket max for 1d granularity on the usage endpoint family, so even the 1d path may be rejected.)

**Evidence:** src/lib/services/real-spend.ts:31 `const bucketWidth = windowMs <= 36 * 3_600_000 ? "1h" : "1d"` and line 42 sets it on /v1/organizations/cost_report. The Admin API reference for GET /v1/organizations/cost_report documents `bucket_width: optional "1d"` with "1d" as the sole enum value (fetched from platform.claude.com API reference) — 1h granularity exists only on the usage_report endpoints, not cost_report. On rejection, lines 56-61 log and return null, and fetchRealSpend (line 272) passes the null through, so every 24h-window view falls back to the local '(est)' figure even with a valid ANTH

### `src/lib/services/sender-research.ts:168` [llm-context]

For shared-platform URLs (linkedin.com, x.com) the Exa search takes 3 results restricted only by domain, so results 2-3 can be strangers' profiles, yet the prompt asserts all sources are 'their own profile URLs'

**Failure:** profile.linkedin_url = linkedin.com/in/jane-doe; hostOf gives 'linkedin.com' and exa.search(url, {numResults: 3, includeDomains: ['linkedin.com']}) returns the target profile plus two other best-matching linkedin.com pages, which for a common name are namesakes or unrelated people. All three are concatenated as 'Source material scraped from their own profile URLs', so the extractor is told (falsely) that stranger content is the sender's own, and stranger facts ('background: 15 years at Oracle') land in sender_facts via the research-facts route and get woven into the user's outreach emails as claims about themselves. Same namesake mechanism as the known prospect-enrichment bug, on the sender side.

**Evidence:** src/lib/services/sender-research.ts:168-172 `exa.search(url, { includeText: true, numResults: 3, includeDomains: [host] })` restricts only by hostname; lines 173-177 concatenate ALL returned results with no check that a result's URL is the profile URL, and line 206 asserts 'Source material scraped from their own profile URLs'. For linkedin.com/x.com, exactly one page on the domain is the sender's profile, so any 2nd/3rd result is necessarily a different page -- for shared platforms, typically another person's profile/post. Downstream, the extracted facts are inserted into sender_facts (src/app

### `src/lib/services/yc-scraper.ts:110` [correctness]

Directory scroll loop 'while (stableRounds < 2)' has no iteration cap or deadline, so broad/empty filters scroll the entire YC directory on a billed Browserbase session until the serverless function is killed

**Failure:** The agent tool (search-tools.ts:833) passes all filters through optionally; with only a query or isHiring filter the YC directory infinite-scrolls thousands of company cards. Each pass costs ~1.5s+ and stableRounds resets on every count increase, so the loop runs for many minutes on a billed session. On Vercel the route hits maxDuration and the process is frozen/killed mid-loop; the finally block (releaseSession) never runs, leaking the Browserbase concurrency slot: the exact stall mode the releaseSession comment says previously made all later sessions.create queue forever.

**Evidence:** src/lib/services/yc-scraper.ts:110 `while (stableRounds < 2)` has no iteration counter and no deadline; each pass waits 1500ms (line 112) and stableRounds resets to 0 on every count increase (line 133). The session is created before the loop (line 82) and billed by duration (line 443). Reachable: search-tools.ts:728-770 makes every filter optional (searchYCCompanies), and a cache miss (first-ever call, or uncached batch/industry) calls scrapeYCCompanies directly (line 833). Broad/empty filters load the full ~thousands-company directory, so the loop runs unbounded minutes on a billed session; t

### `src/lib/services/yc-scraper.ts:315` [correctness] _(plausible)_

isHiring selector '[href*="jobs"], [href*="careers"], [class*="hiring"]' matches YC's site-wide nav/footer links, marking essentially every company as hiring

**Failure:** The querySelector runs against the whole document of the YC company page, which carries YC's global chrome including the 'Startup Jobs' link (href containing /jobs) on every page; the same evaluate block's excludedDomains list (workatastartup.com, startupschool.org) confirms these global links are present in the DOM. So isHiring evaluates true for nearly all companies regardless of actual hiring status, and only the catch-fallback path ever produces isHiring:false. Users/agents filtering YC results by hiring status get a uniformly-true field, corrupting ICP timing decisions built on it.

**Evidence:** src/lib/services/yc-scraper.ts:314-317: `const isHiring = !!document.querySelector('[href*="jobs"], [href*="careers"], [class*="hiring"]') || /currently hiring/i.test(bodyText);` runs against the entire document with no scoping to a company-specific section, and the excludedDomains list in the same evaluate (lines 273-284, including workatastartup.com and startupschool.org) shows the author expects YC global-chrome links in the DOM. If YC's site-wide nav/footer carries any href containing 'jobs' or 'careers' (e.g. the Startup Jobs / Careers links) the field is uniformly true, with isHiring:fal

### `src/lib/signals.ts:17` [swallowed-error] (related: K7,K21,K22)

getActiveSignals swallows the Supabase error and returns [], so a DB failure silently strips the enabled-signals section from the chat system prompt

**Failure:** Transient Supabase error (or Clerk-token/RLS mapping failure, a known failure mode in this repo) makes the campaign_signals query fail; getActiveSignals returns [] with no log. buildSystemPrompt (system-prompt.ts:344 gates on signals.length > 0) then renders the prompt with no signals block, and the prompt elsewhere instructs 'Only run enrichment corresponding to enabled signals'. The agent behaves as if the campaign has zero signals configured: it skips signal-driven enrichment or re-asks the user to enable signals that are already enabled, with nothing anywhere indicating a load failure.

**Evidence:** src/lib/signals.ts:17 `if (error || !data) return [];` swallows the Supabase error with no log. src/app/api/chat/route.ts:153 `const signals = campaignId ? await getActiveSignals(campaignId) : null;` feeds it to buildSystemPrompt, and src/lib/system-prompt.ts:344 `if (options?.signals && options.signals.length > 0)` drops the whole signals block on [], while line 370 says 'Only run enrichment corresponding to enabled signals' and line 375 'If a signal is not listed here, do not run its corresponding enrichment.' A failed query is indistinguishable from zero enabled signals; nothing anywhere re

### `src/lib/signals/executor.ts:187` [state-machine]

The enrichContact guard requires args.contactId, but ExecuteSignalContext has no person field and tracking-run never passes config.person_id, so person-level tracking configs for the Social Engagement builtin (tool_call enrichContact) can never execute.

**Failure:** User creates a person-level tracking config (tracking_configs.person_id set) on the builtin 'social-engagement' signal. Every cron run, executeToolCall sees no contactId and returns found:false with 'Use this signal with contact-level tracking, not company-level', even though the config IS contact-level. The tracking config runs forever, always produces nothing, and no UI or code path can ever make it work: a dead-end state.

**Evidence:** Seed reseed_builtin_signals.sql:62: social-engagement is 'tool_call','enrichContact','{"focus":"social_activity"}' (no contactId). enrichContact requires contactId uuid (enrichment-tools.ts:826-831). ExecuteSignalContext (executor.ts:15-22) has no person/contact field and tracking-run.ts:65-71 passes only organizationId/domain/name/campaignId/useAdmin, never config.person_id (which exists: used at tracking-run.ts:127 and 297-303). The guard at executor.ts:187-196 therefore always returns found:false 'Use this signal with contact-level tracking, not company-level' even for person-level configs,

### `src/lib/signals/executor.ts:288` [correctness]

Generic browser_script path scrapes https://{domain} (homepage), preferring ctx.domain over config.url, and config.instructions are only pasted into the summary string, never used to navigate, so the Terms & Conditions Changes builtin monitors the homepage instead of the terms/privacy page it promises to watch.

**Failure:** User tracks 'terms-conditions-changes' (browser_script, config.instructions = 'Navigate to the terms and conditions or privacy policy page...'). Executor calls extractWebContent on https://acme.com, not /terms: a real ToS update is invisible unless the homepage happens to change, while routine homepage copy edits produce snapshot-hash changes that wake the intent evaluator. The signal's description and evidence URL (homepage) misrepresent what was checked.

**Evidence:** RECIPES contains only pricing-changes (recipes/index.ts:15-17), so getRecipe('terms-conditions-changes') throws and executeBrowserScript falls to the generic path. executor.ts:288-290: targetUrl = ctx.domain ? `https://${ctx.domain}` : config.url, and the seed config (reseed_builtin_signals.sql:66) has only 'instructions', no url; ctx.domain always wins under tracking. instructions are used only in the summary string (executor.ts:329-330) and evidence cites the homepage URL (executor.ts:332-334), so the signal monitors the homepage, never the terms/privacy page.

### `src/lib/signals/executor.ts:366` [swallowed-error]

executeHiringActivity under the tracking cron persists via scrapeHiringData -> mergeEnrichmentData, which uses the user-session Supabase client (anon on /api/jobs) and never reads query errors, so organizations.enrichment_data.hiring is silently never updated by tracking runs.

**Failure:** Hiring Activity signal runs on cron: the scrape succeeds and the tracking timeline shows fresh jobs (snapshot built from the returned result), but mergeEnrichmentData's select returns nothing under anon RLS and its update matches 0 rows with no error checked. enrichment_data.hiring and the verified hiring_role claims go stale while tracking appears healthy; the chat agent, instructed that 'hiring facts come only from the careers scrape stored in enrichment_data.hiring', then reports outdated or missing hiring data despite runs happening every week.

**Evidence:** executor.ts:352-366 executeHiringActivity -> scrapeHiringData -> saveHiring -> mergeEnrichmentData (hiring-scraper.ts:154). mergeEnrichmentData (knowledge-base.ts:352) uses the session createClient(), destructures only {data} from the select (lines 355-359, error ignored) and never reads the update result (lines 378-386). orgs_select/orgs_update are 'TO authenticated' (initial_schema.sql:805-807), and the cron job route has no Clerk session (proxy.ts:6 public + server.ts getToken -> null -> anon), so the select returns null and the update matches 0 rows with no error surfaced. tracking-run.ts:

### `src/lib/signals/executor.ts:404` [security]

Admin-client diffAgainstPrevious filters signal_results only by signal_id + organization_id with no campaign/user scoping; builtin signals are shared rows and organizations are globally unique by domain, so the baseline can be another tenant's signal_results row (same missing campaign scoping in runner.ts:158 history step).

**Failure:** Tenant A and tenant B both track acme.com with the builtin funding-news signal. B's tracking cron run (useAdmin:true) picks A's most recent signal_results row as 'previous', so A's stored result data would flow into B's diff.from/description and tracking timeline, and B's genuine first run would not be treated as a baseline. Currently latent only because the output-shape bug (executor.ts:415) makes the read resolve undefined; fixing that bug alone makes this a live cross-tenant read.

**Evidence:** executor.ts:404-411 queries signal_results with only .eq('signal_id') and .eq('organization_id') on getAdminClient() (RLS bypassed); runner.ts:158-165 has the identical two filters. Organizations are a shared pool with a global unique index on domain (initial_schema.sql:389 idx_organizations_domain) and builtin signals are single global seeded rows, so two tenants tracking the same domain share both keys; tracking-run.ts:123-131 writes campaign_id but no reader filters on it, so tenant B's cron read returns tenant A's latest row. As the finding itself states, actual data flow is currently mask

### `src/lib/signals/executor.ts:415` [correctness]

signal_results.output shape mismatch: tracking-run.ts:129 writes output = signalOutput.data (data-only), but diffAgainstPrevious reads prev.output.data and the pricing recipe's history step reads path 'data.tiers': both expect the full SignalOutput shape, so no writer ever produces what the readers consume and the baseline never resolves.

**Failure:** Exa-search signal tracked via cron: run N writes output={query,resultCount,results}; run N+1's diffAgainstPrevious reads prev.output.data -> undefined -> returns null, so exa signals never get an executor diff (only the coarser snapshot fallback). For the pricing recipe, even if the history query used the admin client, resolvePath(output,'data.tiers') on output={tiers:[...]} returns undefined, so the diff is always 'First observed value' and pricing changes are never actually diffed against the prior tiers.

**Evidence:** tracking-run.ts:73 and :129 write output = signalOutput.data (data-only). Reader 1: executor.ts:415 reads (prev.output).data, but exa data is {query,resultCount,results} (executor.ts:115-124) with no 'data' key, so diffAgainstPrevious returns null every run. Reader 2: pricing-changes.ts:48 history path 'data.tiers' vs dataPath 'scrape.extracted' which stores {tiers:[...]}; resolvePath({tiers},'data.tiers') -> undefined (paths.ts:1-20), so the diff step always sees a null baseline. The only other writers (enrichment-tools.ts:2254-2260 raw Places result; github-tools.ts:320-331 projection) are a

### `src/lib/tools/email-tools.ts:588` [race]

recordNegatives does a read-modify-write of people.enrichment_data from a snapshot taken at the top of findEmailForPerson, overwriting the whole jsonb and clobbering anything written concurrently.

**Failure:** Bulk find-email with verify (or revalidate) runs for a person while a person-enrichment job (or a second findEmail call) merges new enrichment_data. The snapshot at line 136 predates the Exa search plus up to 3 provider verifications (multi-second window); the update at line 588 writes {...staleBase, rejectedEmails}, silently discarding the enrichment written in between. Reverse interleaving instead drops rejectedEmails, so the next revalidate pays the verifier again for known-dead addresses.

**Evidence:** Snapshot taken at email-tools.ts:136-142 (select includes enrichment_data); recordNegatives (email-tools.ts:585-596) writes enrichment_data: {...base, rejectedEmails} — a full-column overwrite from that snapshot — after the Exa search plus up to MAX_VERIFICATIONS_PER_PERSON=3 provider calls (email-provider.ts:86), a multi-second window. The concurrent writer exists and is itself read-modify-write: mergeEnrichmentData (knowledge-base.ts:355-386), called from person-enrichment.ts and github-tools.ts:100, so either interleaving loses one side's write with no guard. Minor scenario correction: bulk

### `src/lib/tools/email-tools.ts:750` [swallowed-error] (related: K7,K22)

findEmails ignores the .error of the affiliation-confidence query; on failure rows is null, every contact defaults to confidence 0 and the whole batch is 'skipped' with a fabricated business explanation.

**Failure:** Transient Supabase/PostgREST failure (or the Clerk role-claim regression mapping the session to anon) makes the people select error. confidence map is empty, so all 25 ids fall below AFFILIATION_SEND_THRESHOLD and land in skipped; the summary asserts '25 skipped: not confirmed to work at this company, so a company-domain guess would be misleading', which the agent relays to the user as a confident (false) data-quality verdict instead of an error. Nothing is logged.

**Evidence:** email-tools.ts:750-753 destructures only {data: rows}; the query error is never read. On failure (or an anon-role session returning zero rows) the confidence map is empty and line 776 '(confidence.get(personId) ?? 0) < AFFILIATION_SEND_THRESHOLD' (0.6, affiliation.ts:82) sends every id to skipped, producing the fabricated summary at email-tools.ts:801-809 ('not confirmed to work at this company...'). No console.error anywhere on the path.

### `src/lib/tools/email-tools.ts:1014` [correctness]

discardDraft returns success without checking whether any row matched: the update is filtered on status='draft', so an already-queued/sent or nonexistent draft yields error=null and the tool claims 'discarded'.

**Failure:** Cron claims a due draft (status='draft' -> 'queued') seconds before the user tells the agent to discard it. The UPDATE matches 0 rows, error is null, tool returns {draftId, status:'discarded'}; the agent tells the user the email will not be sent, and it sends anyway. Same false success for a wrong/foreign draftId (RLS filters it to 0 rows).

**Evidence:** email-tools.ts:1014-1024: update filtered on .eq('id', draftId).eq('status','draft') with no .select()/row check; a 0-row match (nonexistent id, RLS-hidden, or already queued/sent) leaves error null and the tool returns {draftId, status:'discarded'}. The race is real: claimAndSendDraft flips status to 'queued' (outreach-sender.ts:405-411) before sending. The codebase's own pattern for detecting 0-row conditional updates is autoApproveDraft (email-composition/save.ts:126-133), which discardDraft does not follow.

### `src/lib/tools/enrichment-tools.ts:550` [state-machine] (related: K5)

people.enrichment_status='in_progress' has no recovery path: it is set before the scrape chain, and if the serverless run dies (chat turn aborted, function frozen/timed out; enrichContacts has no per-contact withTimeout unlike enrichCompanies) nothing anywhere resets it.

**Failure:** Vercel kills the chat function mid-LinkedIn-scrape after line 548's update but before mergeEnrichmentData at line 709. The person is left at enrichment_status='in_progress' indefinitely; contact-detail.tsx:165 and person-node.tsx:61 render a permanent 'In Progress' state, review/page.tsx treats it as active. No cron, UI action, or timeout advances it; only a manual re-enrich clears it (and if last_enriched_at is under 7 days from a prior run, isRecentlyEnriched skips the re-enrich too, returning status 'enriched' while the row still says in_progress).

**Evidence:** enrichment-tools.ts:548-551 sets people.enrichment_status='in_progress' before the scrape chain; the only writes that ever leave that state are the same run's mergeEnrichmentData (line 709 -> knowledge-base.ts:382) or a later successful re-enrich; grep over src/ and supabase/ shows no cron, job, or UI path that resets a stale in_progress (person-enrichment.ts:194 sets 'failed' only in its own catch, which a killed process never runs). enrichContacts maps ids straight to enrichContactById with no per-contact withTimeout (lines 884-886), unlike enrichCompanies (1617-1621), so a hung scrape rides

### `src/lib/tools/enrichment-tools.ts:1408` [race]

Hiring-scrape timeout orphan races the outer mergeEnrichmentData: withTimeout only races and never cancels, so a scrape that exceeds HIRING_SCRAPE_TIMEOUT_MS keeps running and later calls saveHiring -> mergeEnrichmentData, whose read-modify-write can clobber (or be clobbered by) enrichCompanyById's own merge at line 1525.

**Failure:** Stagehand careers scrape passes 90s; allSettled records rejection and enrichCompanyById proceeds through extractClaims (~10-30s of LLM time) and merges searches+claims at line 1525. The orphaned scrape finishes moments earlier/later: if its merge reads enrichment_data before the outer write and writes after, the run's entire searches/claims payload is silently overwritten with the pre-run snapshot plus hiring; in the opposite interleaving the hiring data is lost. Same lost-update window exists for PER_COMPANY_TIMEOUT_MS orphans in enrichCompanies re-running the same org. Agent is told the enrichment succeeded either way.

**Evidence:** src/lib/utils/timeout.ts:15-29: withTimeout is a bare Promise.race, no AbortSignal, so the losing scrape keeps running. src/lib/tools/enrichment-tools.ts:1407-1413 wraps tryScrapeHiringData in it (HIRING_SCRAPE_TIMEOUT_MS=90s, hiring-scraper.ts:54). The orphaned scrape still persists: hiring-scraper.ts:106/121 (and browser-tier at 611/637) call saveHiring -> mergeEnrichmentData (hiring-scraper.ts:149-157). mergeEnrichmentData (knowledge-base.ts:346-387) is an unlocked read-modify-write of the whole enrichment_data JSON (SELECT at 355-359, full-object UPDATE at 378-386), so its write replaces t

### `src/lib/tools/enrichment-tools.ts:2027` [correctness]

deleteCompanies assumes all link IDs belong to one campaign (campaignId = links[0].campaign_id) and swallows the links-select error, so cross-campaign batches unlink people from the wrong campaign and a failed select silently skips people-unlinking entirely.

**Failure:** Agent passes link IDs spanning two of the caller's campaigns: people at campaign B's orgs are deleted from campaign A's campaign_people (wrong campaign loses contacts) while campaign B keeps orphaned contacts whose company link is gone. Separately, a transient error on the links select (error never read) makes links null: the org links are still deleted but every campaign_people row survives, leaving contacts in the campaign attached to companies the campaign no longer has, and the tool still returns deleted: N. Also delete on line 2046 reports success even when RLS filtered all rows to zero.

**Evidence:** enrichment-tools.ts:2021-2024: `const { data: links } = await supabase.from("campaign_organizations").select("organization_id, campaign_id").in("id", input.companyIds)` — error never destructured; on a failed select, links is null, the whole people-unlink block (2026-2044) is skipped, yet the org-link delete at 2046-2049 still runs and the tool returns `deleted: input.companyIds.length` (2053-2056). Line 2027: `const campaignId = links[0].campaign_id` with orgIds pooled from all links (2028), then campaign_people delete filters .eq("campaign_id", campaignId) (2041) — so for link IDs spanning t

### `src/lib/tools/enrichment-tools.ts:2114` [swallowed-error]

scoreCompany, scoreContact and updateCompanyStatus report success when their UPDATE matched zero rows: Supabase returns no error for a 0-row update, and the tools never check affected rows.

**Failure:** The file's own comments state agents routinely confuse ID kinds (person_id vs campaign_people.id, organization_id vs campaign_organizations.id). Agent calls scoreContact with a person_id: the .eq on campaign_people.id matches nothing (or RLS hides another user's row), no error is returned, and the tool replies {contactId, score, reason} as if stored. The score is never persisted, the contact stays unranked in priority ordering, and the agent moves on believing prioritization is done.

**Evidence:** scoreCompany (enrichment-tools.ts:2114-2130), scoreContact (2152-2168) and updateCompanyStatus (2183-2197) all run .update().eq()/.in() with no .select(), check only `error`, and return the echoed input as success. A 0-row UPDATE returns error:null in supabase-js, so nothing distinguishes 'stored' from 'matched nothing'. Both misses are reachable: the file itself documents agents passing the wrong ID kind (lines 489-492: 'Agents routinely pass the campaign_people link ID here instead of the person ID'), and RLS silently filters rows to zero: camp_people_update / camp_orgs_update policies (supa

### `src/lib/tools/github-tools.ts:100` [state-machine]

Existing-person path calls mergeEnrichmentData with default status, stamping enrichment_status='enriched' and last_enriched_at=now even when only a stargazer stub (no real profile) was merged.

**Failure:** Person created by fetchGitHubStargazers gets enrichment_status='pending' (correct, no full profile). A second stargazers fetch of a different repo hits the existing branch: mergeEnrichmentData defaults status='enriched' and sets last_enriched_at. /api/enrich/bulk (isRecentlyEnriched, 7-day window) then skips them and UI shows 'enriched' while the row holds only username/avatar/starred_repo; the person is never actually enriched.

**Evidence:** github-tools.ts:100 calls mergeEnrichmentData with no status argument; knowledge-base.ts:350 defaults status='enriched', and lines 378-386 unconditionally set enrichment_status: status and last_enriched_at when status==='enriched'. A stargazer-created person gets enrichment_status='pending', last_enriched_at=null (github-tools.ts:133-134, hasFullProfile=false); a second stargazers fetch hits the existing branch and stamps 'enriched'+now. isRecentlyEnriched (knowledge-base.ts:417-428) falls back to last_enriched_at and returns true within 7 days, and src/app/api/enrich/bulk/route.ts:99 uses it

### `src/lib/tools/github-tools.ts:222` [correctness]

Stargazer pagination undercounts when the last page is partial: pagesNeeded=ceil(count/100) but the newest page holds totalStars%100 entries, so the loop's lower bound stops before enough pages are read.

**Failure:** Repo with 150 stars, count=100: accessiblePages=2, pagesNeeded=1, loop bound Math.max(1, 2-1+1)=2, so only page 2 (50 stargazers) is fetched and the loop exits with 50 results despite stargazers.length < count and page 1 existing. Tool reports fetched:50 for a 100 request; in the worst case (totalStars%100==1) a count=100 request returns 1 stargazer.

**Evidence:** github-tools.ts:208-212: accessiblePages=ceil(totalStars/100), pagesNeeded=ceil(count/100); loop at 222-227 runs while page >= Math.max(1, accessiblePages - pagesNeeded + 1). For totalStars=150, count=100: accessiblePages=2, pagesNeeded=1, lower bound=2; page 2 returns 150%100=50 entries, then page-- makes page=1 which fails '1 >= 2' and the loop exits with 50 of 100 requested even though page 1 exists. Worst case totalStars=101 returns 1 stargazer for count=100. The lower bound assumes every fetched page is full, but the newest (highest-numbered) page is partial.

### `src/lib/tools/github-tools.ts:391` [llm-context]

enrichGitHubProfiles requests /users/{username}/repos?sort=stars, but the GitHub repos endpoint has no 'stars' sort (only created/updated/pushed/full_name), so it silently returns the first 10 repos alphabetically, not top repos.

**Failure:** A prospect with 80 repos whose flagship 20k-star project starts with 'z': the API ignores sort=stars, returns 10 alphabetically-first repos (often forks/toy projects), the tool stores them as top_repos and derives languages/topics from them, and the tool output tells the model these are their 'top public repositories'. Drafts personalize on trivial repos and miss the person's actual notable work.

**Evidence:** github-tools.ts:391 requests `/users/${username}/repos?sort=stars&direction=desc&per_page=10&type=owner`. The GitHub REST 'List repositories for a user' endpoint's documented sort enum is only created|updated|pushed|full_name (default full_name); 'stars' is a search-API sort, not a repos-list sort. So the code as written can never receive star-ranked repos: either the invalid value is ignored (full_name ordering, first 10 alphabetical repos stored as top_repos at lines 406-419 and presented as 'top public repositories' per the tool description at line 345) or the request fails and repos is emp

### `src/lib/tools/learning-tools.ts:186` [swallowed-error] (related: K7,K20,K21,K22)

getOutreachPerformance ignores the email_replies query error, so a failed replies fetch is reported as 0 replies and 0% reply rate everywhere.

**Failure:** email_replies query fails (JWT/RLS hiccup, PostgREST error) in any chunk: `{ data: replies }` never reads .error, replies defaults to [], every send gets intent=null, and computeAggregates reports 0% reply rate by hour/step/signal. The agent then confidently tells the user 'no replies in the window, nothing is converting': a fabricated conclusion from a swallowed failure. Same for the sequences/signals lookup at line 211 (signal breakdown silently empty).

**Evidence:** src/lib/tools/learning-tools.ts:186-189: `const { data: replies } = await supabase.from('email_replies')...in('sent_email_id', ids)` never reads .error, and line 190 iterates `replies ?? []`, so a failed query leaves intentBySend/bounced empty; every outcome gets intent: null (line 241) and computeAggregates (line 246) reports 0 replies / 0% reply rate with no error surfaced. Contrast with the sends query, which does check sendsError (lines 174-176). Same pattern at lines 211-214 for the sequences/signals lookup: `const { data: seqs }` with `seqs ?? []`, so a failed lookup silently empties the

### `src/lib/tools/profile-tools.ts:56` [swallowed-error]

updateUserProfile with a profileId that matches no visible row (deleted, mistyped, or another user's) updates 0 rows yet returns action:'updated', and the follow-up select's error is discarded.

**Failure:** Agent passes a stale profileId from an earlier conversation: the RLS-scoped update matches 0 rows with no error, the .single() re-select fails but its error is ignored (`{ data: profile }`), and the tool returns { profile: undefined, action: 'updated', updated: [...] }. The model reports the profile updated; drafts keep using the old offering_summary and the user's correction silently never lands.

**Evidence:** src/lib/tools/profile-tools.ts:55-68: the update (lines 56-59) uses .eq('id', profileId) with no .select() and no row-count check, so an update matching 0 visible rows (stale/foreign id under RLS) returns error=null and passes the throw at line 60. The re-select at lines 62-66 uses .single(), which errors when no row is visible, but only `{ data: profile }` is destructured, discarding the error; line 68 then returns { profile: undefined, action: 'updated', updated: Object.keys(fields) }, falsely reporting success.

### `src/lib/tools/search-tools.ts:791` [correctness]

searchYCCompanies cache path filters only by batch and industry, ignoring region, teamSize, isHiring, and query, and any nonzero cache hit short-circuits the scrape and auto-links the non-matching rows to the campaign.

**Failure:** User previously ran a broad 'Winter 2025' scrape (orgs cached with source='yc_directory'). They now ask for 'Winter 2025 fintech companies in Europe that are hiring, AI infrastructure': the cache query matches all cached W25 rows regardless of region/hiring/query, returns up to maxResults of them, links every one to the campaign via linkOrganizationToCampaign, and reports them as matches. Also, a single cached row for a batch suppresses scraping entirely, so a request for 30 companies can return 1 with no indication more exist.

**Evidence:** src/lib/tools/search-tools.ts:776-791: the cache query filters only source='yc_directory', optional batch (enrichment_data->yc->>batch), and optional industry ilike; input.region, teamSize, isHiring, and query are used only in the scrape call at lines 833-843. Lines 794-828: any cachedOrgs.length > 0 returns early with source:'cache', and when campaignId is set every cached org not already linked is passed to linkOrganizationToCampaign (lines 806-811). So a prior broad batch scrape satisfies a later region/hiring/keyword-filtered request with non-matching rows, and a single cached row for the

### `src/lib/tools/sequence-tools.ts:282` [llm-context]

draftSequenceEmails instructions unconditionally tell the drafting agent 'The final step is a polite breakup', so for a 1-step sequence the only email (first contact) is framed as a breakup.

**Failure:** User creates a 1-step sequence and the agent uses the still-registered draftSequenceEmails path: the instructions say step 1 is the cold email AND the final step is a breakup; both describe the same step, and the model writes 'I'll stop reaching out' to someone never contacted. The sibling tool draftEmailsForSequence explicitly fixed this exact failure (line 502: isFinal only when totalSteps > 1, with a comment saying the breakup-on-first-contact bug shipped), but this tool kept the old framing and both are exported in tools/index.ts.

**Evidence:** sequence-tools.ts:276-283: the instructions string is unconditional: "Step 1 is the initial cold email. Follow-ups reference the prior email and add urgency. The final step is a polite breakup." With steps.length === 1, step 1 is simultaneously 'initial cold email' and 'the final step', so the only email is framed as a breakup. The tool has no branch on step count. It remains registered and exported (src/lib/tools/index.ts:77 and :159). The sibling tool documents this exact failure shipped: sequence-tools.ts:499-502 "In a 1-step sequence the only email is first contact, and flagging it final m

### `src/lib/tools/sequence-tools.ts:380` [swallowed-error] (related: K7)

draftEmailsForSequence ignores the people-query .error; on failure personMap is empty and every enrollment is reported skipped with reason 'no email on contact'.

**Failure:** Transient DB error or RLS failure (e.g. the known Clerk role-claim issue) on the people select: data is null, error unread. The fan-out then hits 'if (!person || !hasEmail)' for all enrollments and returns drafted=0, skipped=N, reason 'no email on contact'. The agent confidently tells the user none of their contacts have email addresses: an infrastructure failure rendered as a false statement about their data.

**Evidence:** sequence-tools.ts:380-385: `const { data: people } = await supabase.from("people").select(...).in("id", personIds);` — .error is never read. On a query error data is null, so personMap (line 386) is empty; every enrollment then takes the branch at 456-464 `if (!person || !hasEmail)` and returns `skipped: true, reason: "no email on contact"` for every step. Result: drafted=0, skipped=N, and the message at 596 reads "Drafted 0 of N emails (N skipped, 0 failed)": a DB/RLS failure is deterministically reported as the contacts lacking email addresses. Nothing is logged.

### `src/lib/tools/tracking-tools.ts:226` [swallowed-error]

bulkCreateTracking's duplicate-check select ignores .error; on failure existingOrgIds is empty, the batch insert includes already-tracked orgs, and the unique index idx_tracking_configs_unique_org aborts the entire atomic insert.

**Failure:** Transient error on the tracking_configs dedupe select: existing=null is treated as 'nothing tracked yet'. toCreate then contains orgs that already have configs; the single insert hits the (campaign_id, organization_id, signal_id) unique index and the whole statement fails, so ZERO configs are created even for genuinely untracked orgs, and the user sees a cryptic 'Failed to bulk create tracking: duplicate key value violates unique constraint' instead of the created/skipped summary.

**Evidence:** tracking-tools.ts:226-234: `const { data: existing } = await supabase.from("tracking_configs").select("organization_id")...` — .error ignored; `existingOrgIds = new Set((existing || []).map(...))` treats a failed select as 'nothing tracked'. toCreate (241-257) then includes already-tracked orgs, and the single multi-row insert at 268-271 hits the partial unique index (supabase/migrations/20260419000000_initial_schema.sql:701-703: `create unique index idx_tracking_configs_unique_org on tracking_configs(campaign_id, organization_id, signal_id) where organization_id is not null` — every inserted

### `src/lib/utils.ts:14` [correctness]

parseLinkedInTitle treats the '| LinkedIn' site suffix as the person's job title, so search results shaped 'Jane Doe | LinkedIn' (profile with no visible headline) store title 'LinkedIn' on a real contact.

**Failure:** Exa returns a LinkedIn profile result titled 'Jane Doe | LinkedIn'. split(/\s[-|]\s/) yields ['Jane Doe','LinkedIn'] and parts[1] ('LinkedIn') becomes the title. Both callers (src/lib/services/contact-discovery.ts:415 and src/lib/tools/enrichment-tools.ts:212) only guard name==='Unknown', not the title, so the candidate is stored with title 'LinkedIn', which then feeds the company-affiliation judge as evidence and the composer as personalization ground truth: an email opens with a reference to their role as 'LinkedIn'. Same mechanism turns 'Jane Doe - Acme Corp | LinkedIn' titles into job title 'Acme Corp'.

**Evidence:** src/lib/utils.ts:14-17: `raw.split(/\s[-|]\s/)` then `title: parts[1]?.trim() || null` — 'Jane Doe | LinkedIn' yields title 'LinkedIn', and 'Jane Doe - Acme Corp | LinkedIn' yields 'Acme Corp'. No '| LinkedIn' suffix stripping exists anywhere in src (grepped). Both callers guard only the name: contact-discovery.ts:419 `if (!parsed.name || parsed.name === "Unknown") continue;` then stores `title: parsed.title` at :432; enrichment-tools.ts:213 `if (!name || name === "Unknown") continue;` then stores `title` at :227. The isProfile guards ensure these titles ARE LinkedIn profile page titles, whose

## LOW severity

### `src/app/api/chat/route.ts:168` [correctness]

Server-side saveChat in onFinish regenerates chats.title from the first user message on every turn, clobbering the LLM title written by /api/chat/summarize; the summary is only re-applied on tab-hide/unmount, so titles flip back to the raw first message mid-session and stay reverted if the session ends without a visibility event.

**Failure:** Turn 1 finishes, chat/[id]/page.tsx fires summarize and chats.title becomes a clean 6-10 word title. Turn 2 finishes: /api/chat onFinish calls saveChat which upserts title=generateTitle(first user message), reverting to the truncated raw prompt. If the browser is killed (crash, OS shutdown) before a visibilitychange/unmount fires, the reverted title is permanent, and each leave-event otherwise re-spends a Haiku call to restore what a turn just erased.

**Evidence:** src/app/api/chat/route.ts:166-174 calls saveChat in onFinish on every turn; src/lib/services/chat-history.ts:42-54 unconditionally sets `title: generateTitle(messages)` (first user message, truncated to 80 chars) in the upsert with no existing-title guard, clobbering the Haiku title written by summarize/route.ts:82. src/app/chat/[id]/page.tsx:79-108 only re-fires summarize on turn 1, visibilitychange→hidden, or unmount, so a session ending without those events (browser/OS kill) leaves the reverted title permanent.

### `src/app/api/companies/[id]/classify-departments/route.ts:83` [correctness] (related: K19)

withAction is called without the userId third argument, so all department-classification LLM spend is recorded unattributed, unlike sibling routes (find-more-people, find-contacts, enrich-company) which pass user.id.

**Failure:** User clicks classify departments; classifyPeople runs one or more Sonnet generateObject calls; trackUsage inside inherits action context with user_id undefined; api_usage rows land with no user attribution and the cost center shows the spend under nobody, same class as K19's tracking-run/person-enrichment omissions.

**Evidence:** src/app/api/companies/[id]/classify-departments/route.ts:83-86 calls `withAction(\`Classify departments: ${org.name}\`, () => classifyPeople(org.name, inputs))`with no third userId argument (signature at cost-tracker.ts:77-81). classifyPeople's trackUsage (department-classifier.ts:111-122) passes no user_id, and trackUsage falls back to`entry.user_id ?? ctx?.user_id ?? null` (cost-tracker.ts:208), so api_usage rows land with user_id NULL. Siblings pass user.id: find-contacts/route.ts:97, enrich-company/route.ts:517, find-more-people/route.ts:107.

### `src/app/api/companies/[id]/classify-departments/route.ts:112` [swallowed-error]

Per-person people.update errors in the classify loop are only console.error'd (line 105-110) and the route still returns classified: classifications.length, so failed writes are reported as successes.

**Failure:** LLM classifies 12 people, then the per-row updates fail (RLS/JWT expiry mid-request, constraint error): route returns {classified: 12}, ClassifyButton and EmbeddedOrgChart toast 'Classified 12 people.', but the chart still shows them Unclassified after refetch. Clicking again pays for the same LLM classification a second time. Found by tracing the two consumer components in this chunk (classify-button.tsx:33, embedded-org-chart.tsx:70).

**Evidence:** src/app/api/companies/[id]/classify-departments/route.ts:96-111: the per-person update loop catches nothing and only `console.error`s updErr (lines 105-110), then line 113 unconditionally returns `{ classified: classifications.length }` even if every write failed. Both consumers treat that count as writes committed: classify-button.tsx:33-39 and embedded-org-chart.tsx:70-77 toast 'Classified N people.' Since failed rows still have department NULL, the next click re-selects them (route lines 53-58 `.is('department', null)`) and pays for the same LLM classification again via withAction (lines 83

### `src/app/api/email/record-verified/route.ts:54` [swallowed-error] (related: K7)

The route returns {ok:true} unconditionally: recordVerifiedEmail's role-prefix skip, missing-person early return, and its final people.update (whose .error is never read in email-pattern.ts:411) all report success, so a user-confirmed email can be silently dropped.

**Failure:** User types a confirmed address for a contact; recordVerifiedEmail's people.update fails (transient PostgREST error or JWT hiccup) or the address is filtered; the route still answers ok:true. The page's own email_drafts update succeeded, so the UI shows the email as recorded, but people.work_email and the org's email_pattern never learn it: future pattern derivations and the send gate keep operating on the stale/unverified state with no signal that anything failed.

**Evidence:** src/app/api/email/record-verified/route.ts:54-60: `await recordVerifiedEmail(...)` is followed by unconditional `NextResponse.json({ ok: true })`. recordVerifiedEmail returns Promise<void> and silently returns on role-prefix addresses (email-pattern.ts:375-380), missing person (line 390), and weaker-source skip (line 408); its final people.update (lines 411-428) never destructures or checks `.error`. The role-prefix path alone is deterministic: a user typing e.g. info@acme.com gets ok:true while nothing is recorded and the org pattern never recomputes.

### `src/app/api/enrich-company/route.ts:106` [correctness]

When body.campaignId is omitted, the comment claims campaignId is derived from the campaign_organizations link, but link.campaign_id is fetched and never used: activeSlugs stays null (all four signal searches run, spending Exa/Places on signals the link's campaign disabled) and contact discovery is skipped entirely.

**Failure:** POST /api/enrich-company with only {companyId} (link id): ownership passes via the link's campaign, but getActiveSignalSlugs never runs for link.campaign_id, so a campaign that disabled funding-news/google-reviews still pays for those searches, and enrichOrganization receives campaignId=undefined so findContactsForCompany never runs even though the org demonstrably belongs to a campaign. The only current UI caller (companies-list.tsx) always sends campaignId, so this bites API/agent callers and any future caller relying on the documented derivation.

**Evidence:** src/app/api/enrich-company/route.ts: `campaign_id` is selected in the link query (line 116) but never referenced afterward; `activeSlugs` is computed only when body campaignId is present (lines 106-108: `campaignId ? await getActiveSignalSlugs(campaignId) : null`), and enrichOrganization receives the body campaignId (line 156), which gates findContactsForCompany at lines 219 and 489 (`if (campaignId)`). With only {companyId} posted, ownership passes via linkCampaign (lines 133-139) but all four signal searches run ungated and contact discovery is skipped, contradicting the comment at lines 88-

### `src/app/api/find-contacts/route.ts:58` [state-machine]

companyId (a campaign_organizations link id) is never checked to belong to the supplied campaignId (link.campaign_id is not even selected), the exact gap find-more-people explicitly closed; a mismatched pair writes campaign_people rows into a campaign that has no campaign_organizations row for that org.

**Failure:** A caller who owns campaigns A and B posts {companyId: <link id from campaign A>, campaignId: B}. Both pass their separate ownership checks, and findContactsForOrganization links the discovered people to campaign B while the org remains linked only to campaign A. Campaign B's UI groups people under its campaign_organizations, so these members are invisible dead-ends (the same failure mode the find-more-people comment documents: people found inside a campaign and quietly left out of it).

**Evidence:** src/app/api/find-contacts/route.ts:53-59 resolves the link with `.eq("id", companyId)` selecting only `organization_id, organization:organizations(...)` — campaign_id is never selected or compared to the body campaignId, whose ownership is checked independently (lines 34-45). findContactsForOrganization then writes `linkPersonToCampaign(person.id, campaignId)` (contact-discovery.ts:326, 544) into the mismatched campaign. find-more-people/route.ts:41-52 explicitly closes this exact gap by narrowing the ownership query with `.eq("campaign_id", campaignId)` and documents why ("Owning the campaign

### `src/app/api/outreach/activity/route.ts:218` [correctness]

nextCursor is the sent_at of the last (page-order) sent item, but page order is by `at` (newest reply time), so a replied old email can set the cursor far older than sent rows that were fetched but sliced off, permanently skipping them.

**Failure:** 50 sent rows fetched (newest by sent_at); the oldest of them received a reply yesterday, lifting its `at` to the top of the merged page while sent rows ranked 21-49 (no replies) fall below the slice(0, limit) cutoff. nextCursor becomes that oldest sent_at; the next request filters sent_at < cursor, so rows 21-49 are never returned on any page. Latent today: no UI caller passes `before`/nextCursor (outreach/page.tsx fetches unparameterized), but any future infinite-scroll consumer silently loses history.

**Evidence:** src/app/api/outreach/activity/route.ts: sent rows fetched newest-by-sent_at (:113-115, cursor filter `lt("sent_at", before)`); replied rows get `at: newest?.received_at ?? row.sent_at` (:160); merged page sorted by `at` (:209), sliced (:210); nextCursor = `page.filter((i) => i.sent_at).at(-1)?.sent_at` (:216-219). If the oldest fetched sent row's reply lifts its `at` above the slice cutoff while unreplied fetched rows (at = sent_at, older than the reply time but sent_at newer than the replied row's) fall below the cutoff, the cursor is that replied row's very old sent_at and the sliced-off row

### `src/app/api/outreach/regenerate/route.ts:180` [llm-context] _(plausible)_ (related: K10)

composeEmail receives the literal placeholder 'unknown@example.com' as the contact email when the person row has neither work_email nor personal_email, injecting a fake fact into the compose prompt.

**Failure:** A draft exists for a person whose email lives only on the draft row (draft.to_email) or whose person emails were cleared after drafting; regenerating passes unknown@example.com as the contact's email into the LLM prompt, which can leak into or skew the regenerated body while the draft still sends to the real to_email.

**Evidence:** The code path is real: src/app/api/outreach/regenerate/route.ts:177-180 `email: (person.work_email as string) ?? (person.personal_email as string) ?? "unknown@example.com"` (draft.to_email is not even selected at :42 nor used), and src/lib/email-composition/skill.ts renders it into the prompt: `RECIPIENT:\n- Name: ...\n- Email: ${input.contact.email}`. But the trigger state is not producible by any traced code path: the sole email_drafts insert site, src/lib/email-composition/save.ts:47-54, refuses to create a draft when `person.work_email ?? person.personal_email` is null ('No email address o

### `src/app/api/people/orphans/route.ts:32` [swallowed-error] (related: K7)

The ownedPersonIds query's .error is discarded; on failure allowedIds is empty and the route returns { people: [] }, rendering a DB failure as 'no unassigned people'.

**Failure:** campaign_people query fails (transient error or RLS misconfiguration); the 'Add person to company' picker shows zero matches with no error surfaced, so the user concludes the orphan they are looking for does not exist.

**Evidence:** src/app/api/people/orphans/route.ts:32-35: `const { data: ownedPersonIds } = await supabase.from("campaign_people").select(...)` — error field discarded. :37-41 builds allowedIds from `ownedPersonIds ?? []`, and :43-44 `if (allowedIds.size === 0) return Response.json({ people: [] })`. A failed query (null data, error set) is therefore rendered as an empty picker result with a 200, indistinguishable from 'no unassigned people'. Contrast :68-71 where the second query's error IS surfaced as a 500.

### `src/app/api/profile/research-facts/route.ts:62` [swallowed-error]

The dedupe baseline from loadSenderFacts is [] on a swallowed read error and is truncated to MAX_FACTS_IN_PROMPT, so re-running research re-inserts facts that already exist in sender_facts.

**Failure:** User clicks 'Research my profile' a second time while the sender_facts read transiently fails (loadSenderFacts logs a console.warn and returns []), or after the fact bank has grown past MAX_FACTS_IN_PROMPT: dedupeFacts sees an empty/truncated existing set, every researched fact survives, and duplicate rows are inserted into sender_facts, bloating the fact bank fed into every composed email.

**Evidence:** src/app/api/profile/research-facts/route.ts:62-63 uses `loadSenderFacts(supabase, profile.id)` as the dedupe baseline for `dedupeFacts(result.facts, existing)`. src/lib/sender-facts.ts:79-90: the query is `.limit(MAX_FACTS_IN_PROMPT)` (40, :25) and on error only does console.warn then `return (data ?? [])` — i.e. []. So a transient read failure (or a bank grown past 40) makes existing empty/truncated, every researched fact survives dedupe, and the insert at route :70-81 writes them; migration 20260805000000_sender_facts.sql defines no unique constraint on (profile_id, fact), so duplicate rows

### `src/app/api/settings/email/test/route.ts:169` [swallowed-error] (related: K20)

Both user_settings writes (test-send state at 169, verdict at 256) ignore their errors, unlike every write in the sibling settings route; a failed write silently loses the test record after the SMTP send already happened.

**Failure:** POST action=send delivers the real test email over SMTP, then the RLS-client update fails (transient error, or the RLS-as-anon 0-rows case that this route's own reads dodge by using the admin client). The route still returns sent:true, but test_message_id/test_sent_at were never stored: 'check' returns 400 'No test send to check', and checkTestCooldown never engages, so the user can hammer resend with unlimited real SMTP sends. Same at line 256: a settled verdict that fails to persist makes every subsequent check re-scan IMAP, the exact re-scan the line-205 guard exists to prevent.

**Evidence:** src/app/api/settings/email/test/route.ts:169-182: after the real SMTP send succeeds (:154-162), the user_settings update recording test_message_id/test_sent_at is awaited but its result is never destructured — a failed write is invisible and :184 still returns `sent: true`. The write uses the RLS `supabase` client (:96) while both reads deliberately use getAdminClient (:68, :100) to dodge the column-grant/role issues, so the write is exposed to exactly the failure mode the reads avoid (RLS-as-anon updates match 0 rows with no error). Consequences trace directly: 'check' at :196 returns 400 'No

### `src/app/email-skills/page.tsx:215` [state-machine]

refineSent is set when a refinement is handed to the agent but only cleared by a successful save (savedTick), so a failed or abandoned refine leaves the voice page busy forever

**Failure:** User clicks Refine; setRefineSent(true) fires and openAgentWith seeds the agent. The agent errors (LLM failure) or the user closes the panel without the save-tool ever running, so savedTick never increments. VoiceProfileView receives busy=true indefinitely: every button disabled, refine box shows 'Rewriting the rules...' with no timeout, error path, or cancel; only a full page reload recovers.

**Evidence:** src/app/email-skills/page.tsx:214-221: onRefine does `setRefineSent(true)` then openAgentWith; the only clear is the savedTick effect (lines 93-98). savedTick increments solely when a `data-voice-skill` stream part arrives, i.e. the save tool actually ran (src/lib/voice-run-context.tsx:272-289 `setSavedTick((t) => t + 1)`); notifyTurnDone (lines 295-304) clears `pending` but nothing clears refineSent on agent error or abandonment. busy={refineSent} disables every control in VoiceProfileView (src/components/email-skills/voice-profile-view.tsx:74,88,99,110,144,157,165-166, including the 'Rewriti

### `src/app/outreach/review/page.tsx:597` [race] (related: K1)

Send-now failure revert to review_status='pending' neither checks row count nor guards against a concurrent whole-contact approval, so DB and UI state diverge

**Failure:** Two concrete paths: (a) send-now fails after the send cron has already claimed the draft (status no longer 'draft'): the revert's .eq('status','draft') matches zero rows without error, UI shows pending, DB stays approved, and the email the user was told failed sends later anyway, the exact bug the comment says this revert exists to prevent; (b) user clicks Send now then immediately presses ArrowRight: handleContactAction (guarded only by `saving`, not sendingDraftIds) approves all pending drafts including the in-flight one; if the send then fails, the revert flips the draft the user deliberately approved back to pending in the DB while the contact reads as reviewed, so it silently never sends.

**Evidence:** src/app/outreach/review/page.tsx:597-601: the revert update checks only `revertErr` and has no `.select()`/row-count check, so `.eq("status", "draft")` matching zero rows (cron claimed the draft, status no longer 'draft') passes silently while setDrafts (607-611) shows pending; DB stays approved and the cron sends later. Path (b): handleContactAction's guard (line 354) is `if (!currentContact || saving)` and never consults sendingDraftIds; ArrowRight invokes it (lines 812-814); the in-flight draft's local review_status is still 'pending' during the send (local state only updated on completion)

### `src/app/profile/[id]/page.tsx:410` [swallowed-error] (related: K7)

fetchFacts discards the sender_facts query error and returns [], so a failed read renders 'No facts yet' and, after a successful research call, a failed refetch replaces the visible fact list with the empty state.

**Failure:** Query failure on load shows an empty fact bank for a profile with saved facts, inviting the user to re-add duplicates; in handleResearch (line 533) a refetch failure right after '+N facts added' wipes the displayed list, making research look like it deleted the bank.

**Evidence:** profile/[id]/page.tsx:408-416: fetchFacts destructures only `{ data }` and returns `(data as SenderFact[]) ?? []`, so a failed read returns [] — the load effect (445-451) then renders the 'No facts yet. Add one below...' empty state (lines 579-583) for a profile with saved facts. In handleResearch, line 533 `setFacts(await fetchFacts(profileId))` runs right after a successful research POST, so a failed refetch replaces the visible list with [] immediately after the '+N facts added' note is set (lines 534-538).

### `src/app/signals/page.tsx:82` [race]

fetchToggles has the same stale-response race: switching the campaign selector quickly lets the earlier campaign's campaign_signals response land last and populate enabledMap for the wrong campaign.

**Failure:** Select campaign A then immediately campaign B; A's response resolves after B's and setEnabledMap shows A's enabled/disabled state while B is selected. A user who then clicks a toggle writes campaign B's campaign_signals row based on A's displayed state (e.g. 'disabling' a signal that was never enabled on B, or believing B already has a signal on).

**Evidence:** signals/page.tsx:82-100: fetchToggles checks only `mountedRef.current` (line 92) before setEnabledMap(map) at line 99; there is no comparison of the fetched campaignId to current selectedCampaignId and no request cancellation in the effect at lines 111-115. Selecting A then B fires two concurrent queries; if A's lands last, enabledMap shows A's toggle state under B's selector, and handleToggle (lines 117-133) then upserts campaign B's campaign_signals row based on that stale display.

### `src/app/tracking/page.tsx:58` [race]

fetchTrackingData has no stale-selection guard: after its two sequential awaits it setRows() without checking that selectedCampaignId still equals the campaignId it fetched for (mountedRef only guards unmount).

**Failure:** User selects campaign A (slow joins query with two round trips), then switches to campaign B; B's fetch resolves first, then A's late response overwrites rows, so the table, readiness counts, and 'ready_to_contact' badges shown under campaign B's selector belong to campaign A until the user re-selects.

**Evidence:** tracking/page.tsx:58-168: fetchTrackingData checks only `mountedRef.current` (lines 75, 138) after its awaits; setRows(mappedRows) at line 167 never compares the fetched campaignId to the current selectedCampaignId, and the effect at lines 179-183 issues a new overlapping fetch per selection change with no abort/sequence token. A slow campaign-A response resolving after campaign B's overwrites rows with A's data while B is selected. mountedRef stays true across selection changes, so it provides no protection.

### `src/components/agent-panel.tsx:88` [llm-context]

Settings-page suggestion 'Show me my API usage costs' points at capability the agent does not have: no chat tool reads api_usage (grep over src/lib/tools finds zero references), and settings/page.tsx explicitly keeps cost reporting non-user-facing.

**Failure:** User on /settings clicks the built-in suggestion; the agent has no tool to fetch usage/cost data, so it either dead-ends or fabricates spend numbers for a sales tool whose owner bills real provider keys: an invented '$4.20 this week' answer is presented as ground truth.

**Evidence:** agent-panel.tsx:85-92: /settings suggestions include 'Show me my API usage costs'. No chat tool can answer it: grep over src/lib/tools finds api_usage only as a WRITE via trackUsage (email-tools.ts:633 importing cost-tracker); the only readers are /api/settings/costs (a REST route, not in the chat toolset in src/lib/tools/index.ts) and cost-tracker.ts. settings/page.tsx:75-76 comment states 'Usage/cost reporting is intentionally not user-facing'. The suggestion therefore points at capability the agent provably lacks; whether it dead-ends or fabricates is model behavior, but the mismatch is cod

### `src/components/campaign/campaign-header.tsx:58` [llm-context] _(plausible)_ (related: K2,K11)

The one-click 'Set Up Outreach' button hardcodes 'Use Hiring Activity as the trigger signal. Enroll all contacts.' into the agent prompt regardless of which signals the campaign actually has enabled or tracked.

**Failure:** For a campaign whose enabled signals are funding/product (or none), the canned prompt asserts a decision the user never made; the agent creates a hiring-triggered sequence and enrolls every contact into 'waiting' for a Hiring Activity signal that has no tracking config on those companies, so enrollments sit in waiting indefinitely, adjacent to the K2/K11 dead-end pipeline states.

**Evidence:** campaign-header.tsx:49-65: SetUpOutreachButton takes only campaignName and unconditionally sends 'Set up a 3-step outreach sequence... Use Hiring Activity as the trigger signal. Enroll all contacts.' via openAgentWith — the hardcoding regardless of the campaign's enabled signals is confirmed, and the prompt is auto-sent (agent-panel.tsx:274). But the claimed failure (agent creates a hiring-triggered sequence whose enrollments wait indefinitely) depends on the agent obeying the canned assertion instead of checking campaign signals with its tools first — runtime LLM behavior that cannot be prove

### `src/components/campaign/companies-list.tsx:485` [swallowed-error]

updateContactEmail ignores the error from the email_drafts.to_email retarget, so a failed retarget silently leaves pending drafts addressed to the old email, which later blocks the send

**Failure:** User corrects a contact's email; the people update succeeds but the email_drafts update (status='draft', to_email=oldEmail) fails (RLS, transient error): no error check, EditableEmail shows success. At send time outreach-sender.ts:390 compares draft.to_email against the person's current address, mismatches, and refuses with 'Regenerate the draft': the enrollment stalls on a draft the user believes they already fixed. Additionally, clearing the email (allowEmpty) passes next='' so the drafts update writes to_email='' instead of skipping, leaving a draft addressed to empty string.

**Evidence:** companies-list.tsx:483-490: the email_drafts update's result is not destructured — supabase-js returns {error} rather than throwing, so a failed retarget is invisible; updateContactEmail resolves, and EditableEmail's commit() (editable-email.tsx:60-62) treats resolution as success and closes the editor with no error. The downstream block exists: outreach-sender.ts:388-397 refuses when `draft.to_email.toLowerCase() !== personEmail.toLowerCase()` with the 'Regenerate the draft' message. The allowEmpty branch is deterministic: allowEmpty passed at companies-list.tsx:1068; with next='' the people

### `src/components/campaign/companies-list.tsx:518` [correctness]

Pagination page index is never clamped when companiesWithLeads shrinks, leaving the user on a phantom empty page

**Failure:** User is on page 2 of 11 companies-with-leads (pageSize 10). They click 'Not here' on the sole lead of the 11th company (or a refetch via onDataChanged removes it): companiesWithLeads drops to 10, totalPages becomes 1, but page stays 1, so paginatedCompanies is empty; the section renders the header with zero rows and the range label reads '11-10 of 10 companies'. Recoverable only by noticing and clicking the Previous arrow.

**Evidence:** companies-list.tsx: `page` state at line 99 is only ever set by the Prev/Next buttons (lines 809, 826); no effect clamps it when companiesWithLeads shrinks. totalPages/slice at 518-522; 'Not here' shrinks the list via removedContactIds (line 135 skips the contact, line 143 filters companies to those with contacts), so 11->10 leaves page=1 and paginatedCompanies = slice(10,20) = []. Detail correction that makes it worse: with totalPages=1 the pagination footer at line 795 (`totalPages > 1 &&`) unmounts, so the '11-10 of 10' label and the Previous button are gone — the empty section is unrecover

### `src/components/campaign/contacts-table.tsx:50` [cleanup]

Entire component is dead code (nothing imports it; companies-list.tsx defines its own private ContactsTable), and it carries a latent contract mismatch: it passes {} as CampaignContact to onContactEnriched whose only real handler replaces the row in state, which would blank the row if ever wired up.

**Failure:** grep shows no importer of @/components/campaign/contacts-table anywhere in src; the live table is the local ContactsTable in companies-list.tsx:902. The comment at line 49 says 'Trigger parent re-fetch' but the matching handler shape, handleContactEnriched in src/app/campaigns/[id]/page.tsx:314, does setContacts(prev.map(c => c.id===contactId ? updated : c)): passing {} would replace the contact with an empty object (undefined name/id/status, broken row key and expand toggle). That handler chain is itself dead too: companies-list declares onContactEnriched at line 46 and never calls it. Both silent-failure fetch handlers here (findEmail line 39, enrichContact line 72, console-only on non-ok responses) are also duplicated drift risk: this is exactly the two-tables-drifted-apart problem companies-list's comment warns about.

**Evidence:** Dead code: grep for "contacts-table" across src finds only a prose comment in outreach-activity-panel.tsx:20; grep for the ContactsTable identifier finds all other uses inside companies-list.tsx, whose private `function ContactsTable(` at companies-list.tsx:902 is the one rendered (lines 762, 1505). Contract mismatch traced: contacts-table.tsx:50 and :84 call `onContactEnriched(contact.id, {} as CampaignContact)`, while the only real handler shape, handleContactEnriched at src/app/campaigns/[id]/page.tsx:310-315, does `setContacts(prev.map(c => c.id === contactId ? updated : c))` — replacing t

### `src/components/campaign/csv-upload.tsx:212` [swallowed-error]

FileReader has no onerror handler; a failed file read leaves the dialog stuck on 'Parsing CSV...' forever with no error message.

**Failure:** handleFile calls reset() then setOpen(true) immediately; companies/headers/error are only ever set inside reader.onload. If the read errors (file deleted/moved after picking, permission or encoding failure), onload never fires, error stays null and companies stays [], so the dialog's fallback branch renders the permanent 'Parsing CSV...' state (line 432-436). The user's only recourse is closing the dialog with zero indication of what went wrong.

**Evidence:** csv-upload.tsx:191-214: handleFile calls reset() (clearing companies/headers/error) and `setOpen(true)` immediately, and registers only `reader.onload` — no onerror/onabort handler exists anywhere in the file. All state transitions out of the empty state (setError at 198/205, setCompanies at 210) live inside onload, which never fires on a failed read (FileReader fires error instead). The dialog body at lines 432-436 renders `Parsing CSV...` for the state result==null && companies.length===0 && !error, so a read failure leaves that branch permanently with no message; the only exit is closing th

### `src/components/chat/chat-input.tsx:79` [correctness]

Chat CSV upload has no size cap: the entire file is read and inlined into a single chat message, so a large CSV blows the /api/chat request or model context and the turn fails opaquely.

**Failure:** handleFileChange reads any .csv fully and hands the raw string to onCsvUpload; chat/[id]/page.tsx:137 wraps it verbatim into one sendMessage text ('`csv\n<content>\n`'). A user uploads a 20k-row export (a normal Clay/Apollo export size): the request body or model context limit is exceeded, useChat surfaces a generic transport error and ChatErrorBanner shows 'The agent stopped unexpectedly'. The campaign-page import path caps at MAX_ROWS_PER_REQUEST per request precisely because of this; the chat path has no bound and no user warning. posthog also captures csv_uploaded before knowing the read succeeded.

**Evidence:** chat-input.tsx:72-88: handleFileChange reads the entire file (`reader.readAsText(file)`) with no size or row cap, and posthog.capture("csv_uploaded") fires at lines 75-78 before the read starts or succeeds. chat/[id]/page.tsx:137-139 inlines the raw string verbatim into one message: `` `...\n\n\`\`\`csv\n${content}\n\`\`\`` `` passed to sendMessage. No warning or truncation anywhere on this path. By contrast the campaign import path bounds requests: csv-upload.tsx imports MAX_ROWS_PER_REQUEST (line 14) and batches at line 235. A multi-MB CSV inlined as one user message exceeds model context (2

### `src/components/company/add-person-dialog.tsx:49` [race]

Debounced orphan search has no in-flight cancellation or sequence guard, so out-of-order responses let a stale query's results overwrite the newer ones.

**Failure:** User types 'jo' (request A fires after 200ms), then 'john smith' (request B fires); A is slow on the network and resolves after B: the list shows matches for 'jo' under the query text 'john smith', including people who don't match, until the next keystroke. The debounce only clears the pending timer, not the fetch already in flight; an AbortController or request-sequence check would fix it.

**Evidence:** src/components/company/add-person-dialog.tsx:45-68: the effect's cleanup and the re-run both only `clearTimeout(debounceRef.current)` (lines 47, 65-67), which cannot cancel a fetch already dispatched after a timer fired; there is no AbortController and no sequence/latest-request guard, and the resolved response unconditionally calls `setResults(people)` (line 56). So if request A ('jo') is dispatched, the user types more, request B ('john smith') dispatches and resolves first, A's later resolution overwrites B's results with stale matches under the newer query text. No guard exists in the code

### `src/components/company/classify-button.tsx:25` [correctness] (related: K14)

Classify uses raw fetch against the auth-protected POST /api/companies/[id]/classify-departments instead of apiFetch, skipping the Bearer-token refresh.

**Failure:** Stale-cookie tab clicks 'Classify N people': route 401s before running, user gets an 'HTTP 401' toast for an action that a fresh-token request (apiFetch) would have completed. Same class as K14.

**Evidence:** src/components/company/classify-button.tsx:25-27 uses raw `fetch('/api/companies/${companyId}/classify-departments', { method: 'POST' })` with no apiFetch import anywhere in the file; the route 401s before doing anything when auth is missing (src/app/api/companies/[id]/classify-departments/route.ts:20-23), and the component surfaces it as a toast via lines 29-31/42-43. Same stale-cookie class the app's own api-fetch.ts:57-63 docstring documents; apiFetch would have attached a fresh Bearer token.

### `src/components/email-skills/voice-swipe.tsx:209` [llm-context] (related: K6,K12)

commit() records only personaLabel into run.judged and drops personaReal, so real-campaign-recipient judgements are indistinguishable from invented-persona ones downstream: the skill prompt (swipe-prompts.ts:459) then asserts 'the recipients in the judged drafts were fictional personas invented for practice' about real people, and the invent-recipient batch prompt's never-reuse-a-persona instruction treats real contacts' names as spent inventions.

**Failure:** A campaign-scoped run drafts to real recipients (personaReal=true). At save time the skill prompt tells the model those real contacts and their real signals were fictional practice material; a user comment like 'the line about Acme's Series B was perfect' gets discounted as persona detail rather than grounded fact, and any later invented-persona batch is told real names in the judged list are personas it must not reuse.

**Evidence:** Queue drafts carry personaReal (swipe-run.ts:36-38), stamped from the batch response's `persona.real` (voice-run-context.tsx:255-260; set true for real recipients at swipe-service.ts:250-261 via pickRecipient/recipientLabel). commit() records only `personaLabel: card.personaLabel ?? undefined` into judged (voice-swipe.tsx:200-210) and JudgedDraft has no personaReal field (swipe-prompts.ts:113-123), so realness is unrecoverable downstream. writeSkill (swipe-service.ts:288) uses buildSkillSystem whose SKILL_SYSTEM unconditionally states 'The recipients in the judged drafts were fictional persona

### `src/components/safe-link.tsx:27` [correctness]

When a chat is streaming and the user confirms navigation, SafeLink calls router.push but never invokes the composed onClick, so caller side effects are skipped on that path.

**Failure:** While an agent chat streams, the user clicks a campaign in sidebar-campaigns.tsx (SidebarMenuButton merges onClick={() => onSelectCampaign(id)} into the rendered SafeLink) and confirms the leave prompt. Navigation happens via router.push, but onSelectCampaign never fires, so activeCampaignId state in the sidebar's parent is not updated and the selected-campaign highlight/state desyncs from the page navigated to. Same for any other SafeLink caller relying on onClick.

**Evidence:** src/components/safe-link.tsx:25-32: `if (isStreaming) { e.preventDefault(); if (confirmNavigation()) { router.push(...); } return; } onClick?.(e);` — the composed onClick prop is only invoked on the non-streaming path; the confirm-and-navigate path returns before it. The onClick prop really reaches SafeLink: src/components/ui/sidebar.tsx:499-521 implements SidebarMenuButton via useRender + mergeProps (imports at sidebar.tsx:4-5), which merges the button's props, including `onClick={() => onSelectCampaign(campaign.id)}` from sidebar-campaigns.tsx:100, into the render element `<SafeLink href={..

### `src/components/settings/email-settings.tsx:97` [swallowed-error] (related: K7)

load() bails silently on !res.ok, so a server error on GET /api/settings/email renders the 'Not connected' connect form even when Gmail is connected.

**Failure:** GET /api/settings/email returns 500 (or 401 past apiFetch's recovery). load() returns early, gmailAddress stays null, loading flips false in finally. The user sees the 'Not connected' badge plus the app-password setup form for a mailbox that is actually connected, and may re-enter credentials or conclude the connection was lost; pause/send-window state also renders as defaults (kill switch shown off even if sending is paused).

**Evidence:** src/components/settings/email-settings.tsx:96-97: `const res = await apiFetch("/api/settings/email"); if (!res.ok) return;` — silent early return inside try, then `finally { if (mountedRef.current) setLoading(false); }` (lines 175-176). gmailAddress stays at its initial null (line 59), so line 457-465 renders the 'Not connected' badge and line 474's `gmailAddress ? ... :` falls to the connect/app-password form for a mailbox that may be connected. sendingPaused also keeps its default false (line 69), so the pause switch shows off regardless of server state.

### `src/components/sidebar-campaigns.tsx:53` [swallowed-error] (related: K7)

Campaigns query error is silently dropped (`if (!error && data)`), so a failed fetch renders the empty-state 'Speak to agent to get started' instead of any error indication.

**Failure:** First sidebar fetch fails (transient Supabase error, or RLS silently returning zero rows due to the known Clerk role-claim issue). loading flips to false with campaigns=[], sidebar shows 'Speak to agent to get started' to a user with existing campaigns; the 10s re-poll that also fails keeps it that way with no toast or log.

**Evidence:** src/components/sidebar-campaigns.tsx:52-57: `if (mountedRef.current) { if (!error && data) { setCampaigns(data); } setLoading(false); }` — on error, campaigns stays [] while loading flips false, and there is no toast/log/error state anywhere in the component. Lines 83-93 then render the `!loading && campaigns.length === 0` branch: 'Speak to agent to get started'. The 10s poll (line 62 `setInterval(fetchCampaigns, 10000)`) retries, but a persistently failing query (e.g. the known Clerk role-claim RLS issue returning errors/empty) keeps the misleading empty state with zero indication.

### `src/components/tracking/tracking-table.tsx:223` [correctness]

Company-expand fetch uses one global .limit(50) ordered by detected_at across all of the company's configs, so one chatty config crowds out the others' timelines entirely.

**Failure:** A company tracks 3 signals; a daily headcount signal has 60 changes newer than anything else. The 50-row window contains only that config's rows, so the other two configs render 'No changes recorded yet.' in the expanded view despite having recorded changes.

**Evidence:** tracking-table.tsx:218-223: single query `.in('tracking_config_id', configIds).order('detected_at', {ascending:false}).limit(50)` applies one global 50-row window across all configs. Grouping at 225-230 partitions only surviving rows; line 277 renders `changesByConfig[row.id] ?? []`, and tracking-timeline.tsx:11 shows 'No changes recorded yet.' for starved configs whose changes are all older than the chatty config's newest 50.

### `src/components/tracking/tracking-table.tsx:370` [correctness]

By-company view keys rows with group.organizationName while grouping keys on organizationDomain || organizationName, so two same-named companies with different domains produce duplicate React keys.

**Failure:** User tracks 'Acme' at acme.com and 'Acme' at acme.io; groupMap holds two groups but both <ExpandableCompanyRow> elements get key='Acme'. React logs duplicate-key errors and expand/collapse state and change caches can be applied to the wrong company's row after re-render or reorder.

**Evidence:** tracking-table.tsx:309 groups by `row.organizationDomain || row.organizationName`, but line 371 keys rows with `key={group.organizationName}`. Two same-named orgs with different domains yield two groups sharing one React key: duplicate-key warning and possible state misattribution between the sibling ExpandableCompanyRow instances.

### `src/components/ui/markdown.tsx:15` [correctness]

autoLinkDomains rewrites the raw markdown string before parsing, and with the m flag its ^ anchor matches line starts inside fenced code blocks, injecting [domain](https://domain) link syntax into code.

**Failure:** Agent chat output contains a fenced code block with a line like 'acme.com' or 'ping acme.io' (config samples, curl targets). The domain is preceded by line start/whitespace so DOMAIN_RE matches, and the code block renders the literal text '[acme.com](https://acme.com)' instead of the original code, corrupting displayed commands the user may copy.

**Evidence:** markdown.tsx:14-17 rewrites the raw markdown before ReactMarkdown parses it; DOMAIN_RE's lookbehind matches after ^ (m flag) and \s (including newlines), with no code-fence awareness. Executed the regex: '`\nping acme.io\nacme.com\n`' becomes '`\nping [acme.io](https://acme.io)\n[acme.com](https://acme.com)\n`', which renders as literal bracket syntax inside the fence. Component is the chat renderer (src/components/chat/chat-message-bubble.tsx).

### `src/lib/email-composition/save.ts:37` [swallowed-error] (related: K7)

saveDraft discards the .error from both pre-reads (people and campaign_people) and maps any failure to 'Person not found.' / 'Person is not linked to the specified campaign.', so a transient DB or RLS failure is reported to the agent LLM as a factual claim about the data.

**Failure:** A transient PostgREST error (or the known Clerk-role/RLS silent-failure class from this project) makes the people select return error+null data for a person that exists. saveDraft tells the agent 'Person not found. Use findEmail to discover one first.', and the agent acts on the false premise: re-runs discovery, re-adds the contact, or drops them from the sequence, instead of retrying a transient read. The real error message is never logged anywhere.

**Evidence:** save.ts:37-45: `const { data: person } = await supabase.from("people")...single()` discards `.error`; `if (!person) return { ok: false, error: "Person not found." }`. save.ts:56-68 does the same for campaign_people -> 'Person is not linked to the specified campaign.' supabase-js returns { data: null, error } on any PostgREST/network failure, and .single() also yields error+null when RLS filters an existing row to zero results: the exact Clerk-role/RLS silent-failure class documented for this project. The error object is never logged, and the false factual message is returned verbatim to the ag

### `src/lib/email-learnings.ts:91` [llm-context] _(plausible)_

loadActiveLearnings slices to MAX_LEARNINGS_IN_PROMPT before filtering out 'timing' rows (renderLearningsBlock drops them), so timing learnings consume prompt-cap slots and can crowd every copy/targeting learning out of the compose prompt.

**Failure:** The weekly outreach.learn job plus auto-adjust accumulate 10+ campaign-scoped timing rows with fresh last_evaluated_at. The query's limit(20) and the final slice(0,10) at line 91 are category-blind, so the 10 returned rows are all 'timing'; renderLearningsBlock filters them all and returns null. The user's active copy learnings silently stop reaching outreach-process.ts:326, sequence-tools.ts:433, and regenerate/route.ts:168, and drafts revert to un-tuned copy with no error anywhere.

**Evidence:** Mechanism confirmed: loadActiveLearnings' query has no category filter and slice(0, MAX_LEARNINGS_IN_PROMPT) at src/lib/email-learnings.ts:88-91 is category-blind, while renderLearningsBlock drops timing rows only afterwards (line 36), so timing rows do consume prompt-cap slots. But the stated scenario is partly wrong: every email_learnings writer inserts campaign_id: null (outreach-learn.ts:370 and 465, learning-tools.ts:73), so '10+ campaign-scoped timing rows' cannot exist. Total crowd-out still requires 10+ user-wide timing rows outranking every copy row (auto-adjust inserts at most one au

### `src/lib/email-skills/swipe-prompts.ts:459` [llm-context] _(plausible)_ (related: K6)

SKILL_SYSTEM flatly asserts 'The recipients in the judged drafts were fictional personas invented for practice', which is untrue for runs where batches addressed real campaign contacts (personaReal=true).

**Failure:** Once the swipe-recipient.ts status-column bug is fixed, a campaign voice run judges drafts written to real contacts with real enrichment signals. At finish, the skill model is told those recipients were invented, so it may discount genuinely voice-relevant patterns ('always opens on the recipient's funding news') as practice artifacts, and the false premise contradicts the transcript's own real names. The rule-writing intent (no persona rules) is right, but the ground truth given to the model is wrong for one of the two shipped modes.

**Evidence:** The false assertion is real and unconditional: src/lib/email-skills/swipe-prompts.ts:459 'The recipients in the judged drafts were fictional personas invented for practice' sits in SKILL_SYSTEM, and buildSkillSystem (lines 477-484) takes no recipient/mode input, so a run whose judged drafts addressed real contacts (personaReal, swipe-run.ts:38; renderRealRecipient path) would be told they were invented. However, in the code as written the real-recipient mode never activates: finding [0]'s missing status column makes loadRecipientCandidates always return [], so recipient is always null and ever

### `src/lib/email-skills/swipe-recipient.ts:45` [correctness] _(plausible)_

pickRecipient's documented 'wrap around' actually pins: once every candidate label appears in judgedLabels, the fallback `?? ordered[0]` returns the same first enriched candidate for every subsequent batch instead of cycling.

**Failure:** A campaign has 3 contacts and the user swipes through 5+ batches. Batches 1-3 rotate; batches 4, 5, 6... are all written to the same contact (the stable-sort-first enriched one), so later judgements over-index one person's signals and the variety the rotation exists for disappears. Contradicts the function's own contract comment ('then wrap around').

**Evidence:** The pinning is provable in the pure function: src/lib/email-skills/swipe-recipient.ts:45 'ordered.find((c) => !seen.has(recipientLabel(c))) ?? ordered[0]!' returns the same stable-sort-first enriched candidate for every batch once all labels appear in judgedLabels, contradicting the line 33-34 contract '(then wrap around)'. But its only caller is swipe-service.ts:204, fed exclusively by loadRecipientCandidates, which always returns [] due to the dropped status column (finding [0]); pickRecipient therefore never receives a non-empty candidate list, so the 3-contact/5-batch scenario is unreachab

### `src/lib/email-skills/swipe-service.ts:367` [swallowed-error] (related: K21)

refineVoiceProfile destructures only { data } from maybeSingle, so a query failure is reported to the agent as 'There is no saved voice in this scope to refine', a false factual claim.

**Failure:** A transient Supabase error (or RLS misconfiguration, cf. the known Clerk role-claim failure mode) makes the select fail; data is null, and the tool returns the no-saved-voice error. The chat agent, told authoritatively that no voice exists, steers the user into a fresh swipe run whose completion overwrites (upsert on user_id,campaign_key) the profile that actually existed.

**Evidence:** src/lib/email-skills/swipe-service.ts:367-371 destructures only '{ data }' from the maybeSingle select; a query error (transient failure, or the known Clerk role-claim RLS mode) leaves data null, and lines 374-378 return { ok: false, error: 'There is no saved voice in this scope to refine.' }: a false factual claim, surfaced verbatim to the chat agent via voice-tools.ts:279. A fresh run steered by that answer ends in writeSkill's upsert with onConflict 'user_id,campaign_key' (swipe-service.ts:317-326), which overwrites the profile that actually existed.

### `src/lib/jobs/executors/outreach-learn.ts:234` [swallowed-error]

outreach_timing_stats rewrite is delete-then-insert with no atomicity: an insert failure after a successful delete wipes the user's timing grid for a week, logged but never recovered

**Failure:** Weekly run deletes all of a user's outreach_timing_stats rows, then the insert of statRows fails (payload too large, transient 5xx). The error is console.error'd and the run continues, returning analyzed:true with clean job success. The user's timing dashboard renders empty until the next weekly run, and any consumer of the stats (send-window reasoning, UI grid) sees zero data instead of last week's; a concurrent dashboard read also sees the empty window between delete and insert.

**Evidence:** outreach-learn.ts:234-250: delete of all the user's outreach_timing_stats rows (234-237) followed by insert of statRows (241-243); an insert error is only console.error'd (244-249) with no restore, retry, or transaction, and execution continues to the normal return path so the job reports success. The grid stays empty until the next scheduled run, and there is a delete-to-insert window visible to concurrent readers regardless.

### `src/lib/jobs/executors/reply-backfill.ts:110` [correctness]

Each pass takes the FIRST 10 users from an identical candidate map, so users past slot 10 are never processed when earlier users' rows are unfillable or credential-less

**Failure:** needsBody is rebuilt from the same 500-row query each pass and byUser preserves insertion order (sent_at desc), so userIds is the same 10 users every pass. A user in slot 1-10 with no gmail creds (continue at line 139) or only permanently-unrecoverable replies contributes filled=0 but still occupies a slot; a user in slot 11 whose reply bodies ARE still in INBOX is never reached in any of the 20 passes, and the one-shot backfill ends with their rows permanently body-less even though recovery was possible. Fix would rotate/skip exhausted users (e.g. offset by pass or drop credless users before slicing).

**Evidence:** reply-backfill.ts:110: `userIds = [...byUser.keys()].slice(0, USERS_PER_PASS)` over a Map built (103-108) from the identical sent_at-desc limit-500 query (73-82); rows only exit the candidate set when body_text gets filled (filter at 90-97). A user with no creds hits `continue` at line 139 AFTER occupying a slot in userIds, and unrecoverable rows (archived mail, failed fetchMessageText at 186-188) stay candidates forever. So when the first 10 users are exhausted/credless, every pass selects the same 10 and the loop ends at MAX_PASSES=20 (line 51, 224) without ever reaching user 11.

### `src/lib/posthog-server.ts:22` [correctness] _(plausible)_ (related: K9)

Server PostHog client is never flushed/shutdown in serverless: capture() enqueues an async HTTP send that nothing awaits, so events are dropped when the Vercel function freezes after the job completes

**Failure:** outreach-process calls getPostHogClient().capture({event:'outreach_drafted'}) as its last action before returning; executeClaimedJob completes the job and the invocation ends. flushAt:1/flushInterval:0 starts the network send immediately but returns synchronously; Vercel freezes the instance before the request lands, and the analytics event silently disappears. Same freeze mechanism as K9, applied to every server-side capture site.

**Evidence:** posthog-server.ts:22-27 constructs PostHog with flushAt:1/flushInterval:0 and repo-wide grep confirms shutdown()/flush() is never called anywhere (only the PostHogLike type Pick and the noop stub mention shutdown), so nothing awaits the capture's HTTP send before a serverless invocation ends. However actual event loss depends on Vercel freeze timing that cannot be proven from code: in outreach-process the capture (line 492) is followed by further awaited work (remaining picks, the send loop at 154-164, and the job runner's completion writes), which normally lets the in-flight request land. Str

### `src/lib/services/affiliation.ts:158` [swallowed-error]

recordAffiliation discards the .error on its person SELECT, reporting any query failure as reason 'person_not_found'.

**Failure:** const { data: person } never reads error; a transient DB failure makes maybeSingle() yield null and the function returns { written:false, reason:'person_not_found' } for a person that exists. contact-discovery then counts them as affiliationUnchanged with evidence text 'affiliation left as it was (person_not_found)': a misleading, unlogged explanation, in the same function whose UPDATE branch comments that 'the error is read, not discarded... because nothing here looked'.

**Evidence:** affiliation.ts:158-166: `const { data: person } = await supabase...maybeSingle(); if (!person) return { written: false, reason: 'person_not_found' }` never destructures .error, so any query failure yields data null and is reported as person_not_found for a person that exists. contact-discovery.ts:525-530 then counts them as affiliationUnchanged and lines 556-558 store the evidence string via unchangedEvidence(write.reason, ...) = 'affiliation left as it was (person_not_found)...', with no console.error anywhere on this path, in the same function whose UPDATE branch comment (affiliation.ts:289-

### `src/lib/services/affiliation.ts:293` [race]

recordAffiliation's monotonic guard is read-then-write with no compare-and-swap, so concurrent writes can land a weaker source last.

**Failure:** Two concurrent discovery runs (people is an explicitly shared pool across users/campaigns) judge the same person: run A reads the row (source null), writes team_page 0.9 at OrgA; run B read the row before A's UPDATE landed, its llm_verified 0.6 at OrgB passes the guard against the stale snapshot, and its UPDATE lands second: the person is moved cross-org on strictly weaker evidence, violating the invariant the whole file is built around. The UPDATE at line 293 filters only .eq('id', personId) with no .eq on affiliation_confidence/source to detect the interleaving.

**Evidence:** affiliation.ts:158-164 reads the row, the guard at 221-280 compares against that snapshot, and the UPDATE at 293-307 filters only .eq('id', personId): no compare-and-swap on affiliation_confidence/affiliation_source, no transaction or lock. Two concurrent recordAffiliation calls (people is a shared pool; discovery runs are concurrent HTTP requests) can both read the pre-write state, both pass the guard, and the weaker write can land last, moving the person cross-org on weaker evidence: the interleaving is unguarded in the code as written.

### `src/lib/services/cost-tracker.ts:195` [swallowed-error] _(plausible)_ (related: K9,K18,K19)

trackUsage runs its api_usage insert as void fire-and-forget; on Vercel the function instance can be frozen after the response returns and before the insert lands, silently dropping spend rows, and an insert error is only console.logged.

**Failure:** A route handler's last LLM call invokes trackUsage and immediately returns the response; Vercel suspends the lambda before the detached async insert reaches Supabase, so the row never lands and /api/settings/costs under-reports real spend with no error anywhere. Same serverless fire-and-forget mechanism as K9. Because every Claude/Exa/Apify call site funnels through this one function, drop probability compounds across the whole cost report.

**Evidence:** cost-tracker.ts:192-216: trackUsage returns void and runs the insert as `void (async () => {...})()`; no caller can await it, and grep shows no Vercel `waitUntil` anywhere in src (the only hits are Puppeteer page.goto options). An insert error is only console.error'd (:212), confirming the swallowed-error half in code. The row-drop half, though, requires the Vercel instance to be suspended after the response returns and before the detached promise's insert resolves; that is documented serverless behavior on a Vercel-deployed prod but is runtime timing that cannot be proven from the code, and c

### `src/lib/services/email-test.ts:90` [correctness]

stripQuotedReply only breaks on a single-line 'On ... wrote:' attribution, but Gmail wraps the attribution at ~78 chars across two lines, so wrapped fragments pass through into stored reply bodies and the Settings test snippet.

**Failure:** Reply sent from Gmail with a long attribution ('On Thu, Jul 31, 2026 at 9:12 AM Jay Sahnan\n<jay@sahnan.co> wrote:'): neither line matches the regex (line 1 lacks 'wrote:$', line 2 doesn't start with 'On'), quoted '>' lines are dropped but both attribution fragments are kept, so email_replies.body_text (via email-track.ts:212) and the test-card excerpt show the junk appended after what the person typed.

**Evidence:** src/lib/services/email-test.ts:87-94: the loop tests each line against `/^\s*(on\b.*\bwrote:\s*$|-+\s*original message\s*-+)/i` and `/^\s*>/`. For the wrapped attribution 'On Thu, Jul 31, 2026 at 9:12 AM Jay Sahnan' + '<jay@sahnan.co> wrote:', line 1 fails the first regex (no 'wrote:' before end-of-line, since the regex anchors `wrote:\s*$` on the same line as the leading 'on'), line 2 fails it (starts with '<', not 'on') and fails `/^\s*>/` ('<' is not '>'), so both lines are pushed to `kept` and the break never fires; the quoted '>' lines below are individually skipped but the attribution fr

### `src/lib/services/email-transport.ts:39` [swallowed-error] (related: K7)

resolveSenderConfig never reads the user_settings query .error, so any DB failure is indistinguishable from an unconfigured mailbox and surfaces as 'Email is not configured. Go to Settings > Email and connect your Gmail account.'

**Failure:** Transient Supabase outage during a send: settings comes back null with error set, and a user with a fully connected Gmail sees / has recorded 'Email is not configured...' as the send failure reason, sending them to re-do setup instead of retrying; the followups cron logs the same misleading reason for every send that run.

**Evidence:** src/lib/services/email-transport.ts:39-49: `const { data: settings } = await supabase.from("user_settings").select(...).maybeSingle();` never destructures or reads `.error`, and the very next check `if (!settings?.gmail_address || !settings.gmail_app_password_enc) return { error: NOT_CONNECTED }` (line 47) treats a query failure (data=null, error set) identically to a genuinely unconfigured mailbox, returning the line 27-28 message 'Email is not configured. Go to Settings > Email and connect your Gmail account.' A DB failure is indistinguishable from missing config by construction; only the re

### `src/lib/services/google-places-service.ts:147` [correctness] (related: K18)

trackUsage is only called on the found-with-results path; Google bills Text Search per request regardless, so zero-result searches and non-OK responses are billed but never appear in cost tracking.

**Failure:** A campaign enriches 50 small B2B companies with no Places listing: 50 billed Text Search requests, zero usage_tracking rows, cost dashboard understates Google spend by the entire miss rate (contrast exa-service.ts, which tracks every executed search).

**Evidence:** src/lib/services/google-places-service.ts: the only trackUsage call is at lines 147-152, reached solely on the found-with-place path; the non-OK branch returns at lines 77-92 and the zero-results branch returns at lines 97-110, both before any tracking, and the catch block (165-183) likewise tracks nothing. Google's Places Text Search bills per request regardless of result count, so every miss is billed but invisible to cost tracking (PRICING.google_places_search = 0.032 exists at cost-tracker.ts:33). The contrast holds: src/lib/services/exa-service.ts:190-201 calls trackUsage unconditionally

### `src/lib/services/jobs.ts:101` [swallowed-error]

completeJob and failJob never read the .error of their status-update writes and log nothing, so a failed 'completed' write silently converts a finished job into a lease-expiry retry that re-executes non-idempotent work.

**Failure:** An outreach/send-adjacent job finishes; the completeJob update at line 101 fails (transient PostgREST error, never checked). The row stays 'running' until the 330s lease expires, claim_jobs' reaper resets it to 'pending', and the whole executor runs again from the top. For executors without their own idempotency guard this doubles side effects (duplicate enqueues, duplicate drafts), and there is no log line anywhere indicating the completion write was lost. Same for failJob at line 129: a lost backoff write means the retry schedule silently reverts to lease-expiry timing.

**Evidence:** jobs.ts:101 (`await getAdminClient().from("jobs").update(values).eq("id", job.id);`) and the identical line at :129 discard the supabase-js result; the client returns errors rather than throwing, so a failed status write is invisible. claim_jobs' reaper (20260801000003_job_queue.sql:57-70) resets 'running' rows with expired locked_until to 'pending' (dead only when attempts >= max_attempts) with last_error 'lease expired', and the tick claims with lease_seconds: 330 (src/app/api/jobs/tick/route.ts:14-16), so a lost 'completed' write re-executes the job after lease expiry with no log; a lost fa

### `src/lib/services/linkedin-service.ts:63` [llm-context]

cleanLinkedInUsername strips the trailing slash before stripping the query string, so a URL like linkedin.com/in/john/?utm=1 yields username 'john/', producing a malformed scrape URL and guaranteeing the profile-extraction match at line 151 (publicIdentifier === username) fails.

**Failure:** Agent or user supplies a LinkedIn URL with a query after a trailing slash (common in copied share links; enrichment-tools.ts:561 passes linkedinFinal straight from tool input without normalizeLinkedInUrl). replace(/\/$/) runs first and misses, replace(/\?.*$/) then leaves 'john/'; scrapeProfile fetches https://www.linkedin.com/in/john//, and even when posts come back, ownPost.author.publicIdentifier ('john') never equals 'john/', so profile is null and enrichmentData.linkedin.profileInfo is stored as null: the compose prompt loses the person's name/headline ground truth while the Apify spend is still tracked.

**Evidence:** linkedin-service.ts:58-65: `.replace(/\/$/, "")` (line 63) runs before `.replace(/\?.*$/, "")` (line 64), so 'linkedin.com/in/john/?utm=1' -> 'john/?utm=1' -> (no trailing-slash match) -> 'john/'. scrapeProfile then fetches 'https://www.linkedin.com/in/john//' (:111-112) and the profile match at :150-151 (`p.author?.publicIdentifier === username`) compares 'john' to 'john/' and can never succeed, so profile is null while trackUsage (:141-146) still records the Apify spend. Reachable: enrichContact passes raw input.linkedinUrl (enrichment-tools.ts:846 -> linkedinFinal at :545 -> scrapeProfile a

### `src/lib/services/person-enrichment.ts:115` [swallowed-error]

Company-URL dedup looks up the organization by name (.eq('name', ...)) instead of the organization_id the callers already select, and discards the query error: with two same-named org rows maybeSingle() errors, the error is swallowed, and dedup is silently skipped (or the wrong namesake org's enrichment is used).

**Failure:** A user's workspace contains two organizations rows named 'Acme' (e.g. re-discovered by two different campaigns). enrichPerson's org lookup by name returns multiple rows, maybeSingle() sets error and data:null, the error is never read, companyUrls stays empty, and the same Exa result URLs appear on both the company card and the contact card: the exact duplication the block exists to prevent. The bulk route (api/enrich/bulk/route.ts:74) already selects person.organization_id but enrichPerson never receives it.

**Evidence:** src/lib/services/person-enrichment.ts:114-119: org lookup is `.eq("name", person.organization.name ?? "")` + `.maybeSingle()` with the error field discarded. The schema (supabase/migrations/20260419000000_initial_schema.sql:373-390) puts a unique index only on organizations.domain (partial: `where domain is not null`) — name is not unique, so two rows named 'Acme' can coexist (e.g. one with null domain). maybeSingle() returns an error with data:null on multiple rows; orgRow is then undefined, companyUrls stays empty, and the dedup filter at line 146 (`results.filter((r) => !companyUrls.has(r.u

### `src/lib/services/relevance-filter.ts:41` [correctness]

The 'from the company's own domain, always relevant' shortcut is a raw substring check (r.url.includes(companyDomain)), so URLs on lookalike or superstring domains bypass the LLM relevance judge entirely.

**Failure:** companyDomain is 'acme.co'. A search result from 'https://notacme.com/...' or 'https://acme.com.scam-site.io/...' contains the substring 'acme.co', so it is classified fromOwnDomain and skips the LLM judgment whose entire purpose is filtering out similarly-named businesses. Irrelevant results about a different company land in enrichment_data and are later fed as ground truth into email drafting. A hostname-suffix check against the parsed URL host would be the correct test.

**Evidence:** src/lib/services/relevance-filter.ts:40-46: `if (companyDomain && r.url.includes(companyDomain))` is a raw substring test on the full URL. "https://notacme.com/...".includes("acme.co") === true (substring 'acme.co' occurs inside 'notacme.com'), and "https://acme.com.scam-site.io/..." likewise contains 'acme.co', so lookalike/superstring domains are classified fromOwnDomain and returned at line 97 without passing through the generateObject relevance judge whose prompt (line 74) explicitly targets 'not a similarly-named business'. Misclassified results are then returned to the enrichment pipelin

### `src/lib/services/sender-research.ts:222` [correctness] (related: K19)

trackUsage call passes no user_id and its call sites (research-facts route, chat sender-fact tools) run without withAction context, so research-sender LLM spend is unattributed

**Failure:** cost-tracker resolves user_id as entry.user_id ?? actionStore context ?? null; neither /api/profile/research-facts nor the chat tool path wraps in withAction, and the trackUsage call at line 222 omits user_id (profileId only lands in metadata). Every research-sender Haiku call inserts api_usage with user_id null, so per-user cost reporting silently drops this spend: same class as K19.

**Evidence:** src/lib/services/sender-research.ts:222-229: trackUsage passes service/operation/tokens/cost and metadata {model, profileId} but no user_id. src/lib/services/cost-tracker.ts:208 resolves `user_id: entry.user_id ?? ctx?.user_id ?? null`. Neither call site establishes ctx: /api/profile/research-facts/route.ts has no withAction (grep for withAction|actionStore in that file and src/lib/tools/sender-fact-tools.ts and src/app/api/chat/route.ts returns nothing), so every research-sender row inserts with user_id null. The cost-tracker's own comment (cost-tracker.ts:53-61) confirms NULL user_id rows ar

### `src/lib/services/web-extraction-service.ts:147` [correctness] (related: K18)

Browserbase Fetch cost is tracked only when content length > 100, and a browser session that errors after creation is never cost-tracked, so billed usage goes unrecorded

**Failure:** A JS-rendered page returns thin content from Browserbase Fetch: the API call was billed but trackUsage is skipped and the code cascades to a browser session, so the fetch spend never appears in api_usage. Likewise in extractViaBrowserbaseSession, if page.goto times out after session creation, the catch at line 217 returns a failure result without any trackUsage even though the session ran (and is billed) for up to ~30s+. Cost dashboard undercounts Browserbase spend exactly on the failure/retry paths where spend is highest.

**Evidence:** src/lib/services/web-extraction-service.ts:147-153: trackUsage for the Browserbase Fetch ($0.004/req, billed on the successful API call at line 474-485) sits inside `if (bbFetchResult.content.length > 100)`; the thin-content path (line 163) cascades to a browser session with the fetch spend untracked. And lines 192-216: the browser-session trackUsage runs only on success; if page.goto/content throws after session creation, the finally (lines 556-579) releases the billed session but the catch at lines 217-234 returns the failure result with no trackUsage call. Both untracked-spend paths are dir

### `src/lib/services/x-service.ts:123` [cleanup] (related: K18)

On the 2-minute poll timeout the Apify run is abandoned but never aborted, and its cost is never tracked since trackUsage fires only after full success

**Failure:** waitForRunCompletion throws 'Apify run timed out after 2 minutes' but the actor run keeps executing on Apify's side, consuming paid credits for results nobody will read; no abort call (POST /abort) is made. Because trackUsage in enrichTwitterProfile runs only after getUserTweetsAndReplies resolves, every timed-out or failed run is real Apify spend invisible in api_usage. Repeated enrichments of a slow/protected handle burn credits with zero recorded cost.

**Evidence:** src/lib/services/x-service.ts:92-124: waitForRunCompletion polls for 120s then `throw new Error('Apify run timed out after 2 minutes')` (line 123); no abort endpoint is called anywhere in the file (the only 'ABORTED' reference is the status check at line 114), so the actor run continues consuming credits server-side. trackUsage (lines 227-232) executes only after `getUserTweetsAndReplies` resolves (line 224), so every timeout/failure path is billed Apify usage with no api_usage row. Fully traced in code; only the fact that Apify keeps running an un-aborted run is platform behavior, which is it

### `src/lib/tools/email-tools.ts:184` [swallowed-error] (related: K7)

The organizations lookup error is swallowed; a transient failure nulls domain and silently degrades the entire waterfall (no pattern, no on-domain candidates, catch-all cache never consulted).

**Failure:** DB hiccup on the org select during a bulk find-email run: domain=null, so steps 1/2/4/5 are all skipped and Exa runs the domainless query. The tool either stores a worse off-domain suggestion or reports 'Could not find an email address.' as a clean answer for a contact whose org has a perfectly good domain, with no log and nothing marking the result as retryable.

**Evidence:** email-tools.ts:184-190: 'const { data: org } = await supabase.from("organizations")...single()' — error discarded, domain and orgIsCatchAll stay null. domainAcceptsMail is then false (line 203: 'domain ? await mxCheck(domain) : false'), which gates the org-pattern step (226), paid finder (251-258), inferred pattern (292), and blind guess (314); Exa falls back to the domainless '"name" email contact' query (607-609). Outcome is either a stored off-domain suggestion or 'Could not find an email address.' (330) presented as a clean answer, with no logging and no retryable marker.

### `src/lib/tools/email-tools.ts:727` [llm-context]

findEmails tool description asserts two things the code does not do: it claims to skip contacts that already have emails (they are returned in 'found'), and claims each contact costs a provider find plus up to 3 verifications (batch discovery is free, verify is never passed).

**Failure:** Agent runs findEmails over 25 ids where 20 already hold stored addresses; result says 'Found emails for 20 of 25' and the agent reports 20 new discoveries to the user. Conversely the spend warning makes the agent ration batches or ask the user before a call that costs nothing, contradicting the lazy-verification design the other descriptions teach.

**Evidence:** Description at email-tools.ts:727 claims 'Skips contacts that already have emails', but findEmailForPerson returns the stored address early (161-173, source 'existing') and findEmails pushes it into found (789-790) — counted in 'Found emails for N of M'. The personIds schema text (733) claims 'a provider find plus up to 3 verifications' per contact, but findEmails calls findEmailForPerson(personId) with no opts (788), so wantVerify=false (199), the paid finder branch is skipped (251 'wantVerify && provider?.canFind'), and the tool returns before the verify loop (340 '!provider?.canVerify || !w

### `src/lib/tools/email-tools.ts:1052` [correctness]

sendBulkEmails silently drops any passed draftIds that do not belong to the given campaignId: they vanish from inScope, so they are neither sent nor counted in awaitingReview/rejected/total.

**Failure:** Agent collects draftIds from listDrafts (which spans campaigns when called without a filter) and calls sendBulkEmails with one campaignId. The cross-campaign drafts are excluded by the campaign_id filter, appear in no results bucket, and the summary 'Sent N of M approved drafts' accounts for every draft the agent named except those; the agent tells the user everything was handled while those drafts sit unsent.

**Evidence:** email-tools.ts:1047-1054: scopeQuery ANDs .eq('campaign_id', campaignId) with .in('id', draftIds), so passed ids from other campaigns never enter inScope. All reporting derives from inScope only: awaitingReview/rejected/approvedIds (1061-1069), total: inScope.length (1156), and the summary 'Sent N of approvedIds.length approved drafts' (1159). The only guard is inScope.length === 0 → 'No drafts found to send.' (1057), which does not fire on partial overlap; cross-campaign drafts appear in no results bucket and no count. listDrafts (982-1000) indeed spans campaigns when called without a filter,

### `src/lib/tools/enrichment-tools.ts:610` [swallowed-error]

Company-URL dedup looks the organization up by name with maybeSingle, but findOrCreateOrganization deliberately allows multiple orgs with the same name (dedup is domain-only), so duplicates make maybeSingle error, the error is never read, and dedup silently does nothing.

**Failure:** Two organizations named 'Apex' exist (one with domain, one created without: the exact situation the domain-only dedup comment at line 126 describes as expected). maybeSingle returns an error with data null; the destructure reads only data, companyUrls stays empty, and the contact card shows the same news/article links already on the company card: the duplication this block exists to prevent. The person row's own organization_id is available one query earlier and would be the correct key.

**Evidence:** enrichment-tools.ts:610-614: `.from("organizations").select("enrichment_data").eq("name", orgName).maybeSingle()` destructures only `data`; supabase-js maybeSingle returns {data:null, error:PGRST116} when the filter matches multiple rows, so companyUrls (line 605) stays empty and the dedup filter (635-636) passes everything through — exactly the company/contact link duplication the block's own comment (603-604) says it prevents. Duplicate names are by design: knowledge-base.ts:121-132 ('NO name-based merge fallback... we create a separate row and leave domain null') and search-tools.ts:126-128

### `src/lib/tools/enrichment-tools.ts:804` [security]

enrichContactById calls findEmailForPerson with no callerHoldsPerson gate, bypassing the ownership predicate that ownership.ts documents as required before 'exactly the same email-finding code' (/api/find-email applies it; getContactDetail applies it for reads).

**Failure:** In a multi-user deployment, user A passes any person UUID from the shared people pool (e.g. one seen in a previously shared campaign) to enrichContact. The tool enriches it and, if affiliation_confidence >= 0.6 and no email is stored, runs email discovery and writes discoveredEmail/pattern-guessed work_email onto a contact user A does not hold: the exact write path the /api/find-email ownership check exists to prevent. enrichContact/enrichContacts also perform all their people writes with no ownership test, unlike the gated sibling tools in the same file.

**Evidence:** enrichContactById (enrichment-tools.ts:476-820) uses bare createClient() (line 487) and contains no callerHoldsPerson/toolSession call anywhere; at 802-812 it invokes findEmailForPerson(personId) directly. findEmailForPerson itself (email-tools.ts:115+) has no ownership test and writes the discovered address onto the row (email-tools.ts:535-537: update people set work_email). Every sibling path gates: email-tools.ts:713 and :783 call callerHoldsPerson before findEmailForPerson, /api/find-email does (route.ts:10,51), /api/enrich has its inline copy (route.ts:37,114), and getContactDetail in the

### `src/lib/tools/enrichment-tools.ts:1045` [correctness]

fetchSitemap's homepage-link fallback filters with hostname.endsWith(domain) without a dot boundary, so foreign domains that merely end with the target string pass as same-domain.

**Failure:** domain='acme.com'; homepage links to partner site 'notacme.com' or 'evilacme.com': 'notacme.com'.endsWith('acme.com') is true, so those URLs are returned as the company's own pages, and the agent then extracts a competitor's or unrelated site's content as if it were the target company's, feeding wrong ground truth into enrichment and drafts.

**Evidence:** enrichment-tools.ts:1043-1049 (fetchSitemap homepage-link fallback): `return new URL(link).hostname.endsWith(domain)` with no leading-dot or exact-host boundary. 'notacme.com'.endsWith('acme.com') === true, so any foreign host whose name merely ends with the target string is kept, and lines 1050-1056 return those links as the company's own pages (source: 'homepage_links'). `domain` is only stripped of protocol/trailing slashes at 945, nothing normalizes the comparison. The tool's stated purpose (935-936) is feeding extractWebContent for the company's own site, so a matching partner/squatter do

### `src/lib/tools/enrichment-tools.ts:1370` [correctness]

new URL(companyUrl) throws synchronously when organizations.url was stored without a scheme, failing the entire company enrichment with 'Invalid URL'.

**Failure:** discoverCompanies stores the LLM-extracted url verbatim (search-tools.ts:691 passes c.url straight to findOrCreateOrganization; the schema only says 'Full website URL if found'), so a model answer of 'acme.com' lands in organizations.url. For that org with domain null, enrichCompanyById evaluates new URL('acme.com') before any Promise.allSettled guard, throws TypeError, and enrichCompany/enrichCompanies report the whole company failed with an unactionable 'Invalid URL' instead of enriching with the domain fallback.

**Evidence:** enrichment-tools.ts:1360: `companyUrl = org.url || (org.domain ? https://${org.domain} : null)`; 1369-1370: `companyDomain = org.domain || (companyUrl ? new URL(companyUrl).hostname : null)`. With domain null and url='acme.com', new URL throws TypeError('Invalid URL') synchronously, before the Promise.allSettled at 1384, unhandled inside enrichCompanyById — enrichCompany rethrows to the agent and enrichCompanies files the whole company under failed (1633-1641). The schemeless write path exists: discoverCompanies' extraction schema is `url: z.string().nullable()` with no .url() (search-tools.ts

### `src/lib/tools/enrichment-tools.ts:2254` [swallowed-error] (related: K7)

getGoogleReviews' signal_results insert error is never read, and an empty signals table (built-ins seed lives only in the initial migration) makes the slug lookup silently null, so signal tracking is dropped with no trace.

**Failure:** On a deployment where the signals seed was emptied (documented failure mode: emptied local signals table won't self-heal), or when the RLS-scoped insert is rejected (campaign_id not owned by caller), no signal_results row is written; the tool still returns the reviews as success, the campaign's signal history silently omits the run, and nothing is logged.

**Evidence:** enrichment-tools.ts:2245-2262: the slug lookup `.eq("slug", "google-reviews").maybeSingle()` yields null on an emptied signals table and the whole tracking block is silently skipped; the insert at 2254-2260 is `await supabase.from("signal_results").insert({...})` with its result entirely unread, so any insert failure (e.g. FK violation on a stale campaign_id) vanishes; either way the tool returns `result` as success (2264) with no log. The empty-seed state is a documented real mode (migration 20260804000001_reseed_builtin_signals.sql header: the clerk migration's TRUNCATE CASCADE wiped signals

### `src/lib/tools/github-tools.ts:313` [swallowed-error]

signal_results persistence silently no-ops when the 'github-stargazers' slug is missing, and the insert error is never read; the tool still reports full success.

**Failure:** On an environment where the built-in signals seed is absent (built-ins live only in the initial migration) or the insert violates RLS, the maybeSingle returns null / the insert error is dropped, so no signal_results row is written for the campaign while the tool output claims saved_to_db=N. Signal-results UI and getSignalResults show nothing for a run the agent believes was recorded.

**Evidence:** github-tools.ts:311-334: `const { data: signal } = ...maybeSingle()` never reads .error; `if (signal)` silently skips the insert when the slug row is absent; the signal_results insert's return value is never checked (`await supabase.from('signal_results').insert({...})` with no destructure). The output object (lines 293-308) including saved_to_db and fetched is built before this block and returned unconditionally at line 336, so the tool reports full success with no signal_results row. Reachability: project memory documents that built-in signals live only in migrations and an emptied local sig

### `src/lib/tools/sequence-tools.ts:371` [swallowed-error] (related: K7)

Enrollment/step/sequence query errors are folded into 'not found' answers: draftEmailsForSequence (lines 333, 362, 371) and draftSequenceEmails (lines 195, 205, 211) read only .data, so a failed query returns 'Sequence not found.' / 'No steps found' / 'No contacts enrolled in this sequence.'

**Failure:** A timeout or RLS error on the sequence_enrollments select returns data=null; the tool answers 'No contacts enrolled in this sequence.' for a sequence that has 50 enrollments. The agent may then re-enroll contacts (duplicating enrollments via createSequence) or tell the user their sequence is empty; nothing is logged so the real error is unrecoverable.

**Evidence:** All six sites read only .data and fold errors into not-found answers. draftEmailsForSequence: sequence-tools.ts:333-338 (`if (!sequence) return { error: "Sequence not found." }`), 362-369 (`No steps found for this sequence.`), 371-377 (`No contacts enrolled in this sequence.`). draftSequenceEmails: 195-202, 205-217, 211-221 identically. PostgREST errors return data=null, so a timeout/RLS failure on the enrollments select yields 'No contacts enrolled in this sequence.' for a populated sequence; no .error is read or logged anywhere in either tool's lookup section, so the real cause is unrecovera

### `src/lib/tools/tracking-tools.ts:346` [swallowed-error] (related: K7)

getTrackingConfigs ignores the tracking_changes query .error, so a failed query renders every config with latestChange: null.

**Failure:** tracking_changes select fails (timeout/RLS): latestChanges=null, changeMap empty, every config returned with latestChange null. The agent narrates 'no changes detected yet' for companies that have recorded changes, and may re-run signals or tell the user tracking has found nothing when it has.

**Evidence:** tracking-tools.ts:346-350: `const { data: latestChanges } = await supabase.from("tracking_changes").select(...)` — .error never read, nothing logged. On failure latestChanges is null, the loop at 354 iterates `latestChanges || []` zero times, changeMap stays empty, and line 361-364 returns every config with `latestChange: changeMap.get(c.id as string) || null`. A query failure is indistinguishable from 'no changes detected yet' for configs that do have tracking_changes rows. (Contrast: the configs query at 340-342 and getTrackingHistory at 401-406 both check .error; only this one swallows it.)

### `src/lib/voice-run-context.tsx:248` [race]

data-voice-drafts stream parts carry no scope identifier (unlike data-voice-skill, which carries campaignId and is checked), so an in-flight batch generated for one scope is appended to whichever run is active when it arrives.

**Failure:** User requests drafts on campaign A's voice deck (pending='drafts'), then navigates to the user-level /email-skills deck and resumes/begins the user run before the response streams in. When data-voice-drafts arrives, ingest reads runRef.current (now the user-scope run) and appends campaign A's drafts, written against campaign A's ICP and persona, to the user run's queue. The user judges them there, and those judgements are saved into the user default voice via the transcript, contaminating one scope's voice with another scope's material. The data-voice-skill branch guards exactly this with a campaignId comparison at line 277; the drafts branch has no equivalent.

**Evidence:** voice-run-context.tsx:248-266: the data-voice-drafts branch reads `runRef.current` and appends with no scope comparison, while data-voice-skill checks `(current.campaignId ?? null) === (data.campaignId ?? null)` at :277-280. DraftsPart (:90-96) and the server emitter (voice-tools.ts:56-65 `writer?.write({ type: "data-voice-drafts", data, transient: true })`) carry no campaignId. The cross-scope arrival is reachable: DashboardShell (provider + AgentPanel) lives in the root layout (src/app/layout.tsx), and AgentPanelInner's key `activeCampaignId ?? "__global__"` (agent-panel.tsx:400) does not ch
