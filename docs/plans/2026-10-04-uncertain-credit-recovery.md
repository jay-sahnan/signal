# Uncertain credit recovery

The prepaid rollout requires evidence-backed reconciliation before hosted activation.
Provider timeouts and partial writes retain their reservations; elapsed time alone
cannot establish whether billable work occurred.

1. Add a service-role-only database operation that accepts an inspected execution
   attempt, operator identity, evidence reference, final charge and exact replay
   result. Settle wallet allocations, save the result and append the audit record
   atomically. Repeated identical decisions are harmless; conflicting decisions fail.
2. Add an operator CLI that lists uncertain work and inspects associated usage.
   Applying a decision requires a reviewed evidence file and explicit command.
   There is no public endpoint, automatic refund or automatic provider rerun.
3. Verify four held requests can be reconciled to restore capacity, charges occur
   once, replay remains available, and customers cannot access the recovery path.
   Use disposable PostgreSQL plus CLI tests. Keep each PR under 400 changed lines.

Operators must establish provider outcome and inspect application writes before
settlement. Usage telemetry helps investigation but missing telemetry is not proof
that no work occurred. Unknown outcomes stay held until evidence is available.
Running executions must be investigated separately; this path only settles an
uncertain attempt and never takes over a currently running invocation.
