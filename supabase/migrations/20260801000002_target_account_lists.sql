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
