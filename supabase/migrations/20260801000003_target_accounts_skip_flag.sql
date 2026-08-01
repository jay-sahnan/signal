-- Per-row contact-finding skip flag for target-list enrichment.
-- Previously skipContactFinding rode in the QStash chain payload, so two
-- concurrent enrichTargetAccounts calls with opposite flags cross-contaminated
-- whichever rows the list-scoped processor happened to pick. The flag now
-- lives on the row, stamped alongside enrich_requested_at.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table target_accounts
  add column if not exists skip_contact_finding boolean not null default false;

commit;
