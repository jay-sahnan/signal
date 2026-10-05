# Recover uncertain prepaid operations

Use a secured operator environment with `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Never put the key in command arguments or logs.
Do not expose this CLI or its service-role RPC to customers.

1. Run `node scripts/reconcile-credit-operations.mjs list` (up to 100 holds).
   Continue with `list NEXT_AFTER_UUID` using `nextAfter` until it is null.
   Pages use stable operation-ID ordering, so settling earlier rows does not shift
   later pages. Restart the scan to include holds created during investigation.
2. Run `node scripts/reconcile-credit-operations.mjs inspect OPERATION_UUID`.
   Record its execution attempt, frozen credit quote, provider usage and audit.
   Truncated usage requires checking the remaining telemetry directly.
3. Verify the provider's receipt/logs and application writes for this attempt.
   Missing telemetry, a timeout or age alone is not proof of no work. Confirm
   execution has stopped. If the outcome remains unknown, leave the hold intact unless an accountable
   operator explicitly approves absorbing the cost with a documented waiver.
4. Prepare a reviewed JSON decision with these fields:
   - `operationId`, `attemptId`: copied from inspection, never regenerated.
   - `operator`: accountable operator identity.
   - `evidenceReference`: durable support ticket/provider receipt reference;
     retain provider findings and application-write checks there, not secrets.
   - `applicationWritesChecked`: `true` after those checks are complete.
   - `executionStopped`: `true` only after confirming no invocation can continue.
   - `outcome`: `completed` or `no_work`, based on evidence; `waived` for an
     explicit business decision to absorb an unrecoverable unknown cost. A waiver
     must never describe provider work as confirmed absent.
   - `charged`: final credits within the frozen quote; `no_work` and `waived` must be zero.
   - `result`: original action's complete JSON result shape, reconstructed from
     verified persisted output. Do not fabricate successful contacts/facts.
     A confirmed failure needs its action's normal error envelope and empty
     counts/arrays so HTTP/tool replay can interpret it.
5. Run `node scripts/reconcile-credit-operations.mjs apply decision.json`.
   This atomically settles credits, frees the concurrency slot, stores the exact
   result for existing-key replay, and appends a private immutable audit record.
   Inspect again to confirm. If the response is lost, retry the identical file;
   never change the decision or run providers to recover the command response.

The CLI never re-runs providers. Running work cannot be reconciled here: first
investigate the original invocation and provider outcome. Do not mark a live
execution uncertain or treat a resolved hold as proof other holds can be freed.
This tool is a manual recovery path, not an automatic refund policy or launch
approval. Hosted mode stays disabled until all rollout checks pass.

Oversized original outcomes are retained exactly in a separate private recovery
store, using PostgreSQL text storage. The normal execution limit stays at 1 MB.
Check database capacity before recovering a large result; do not truncate it or
replace successful work with a fabricated smaller response. Existing-key replay
reads the original recovered payload under the same owner authorization.
