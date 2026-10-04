-- Additive preparation only: tenant enforcement and backfill follow separately.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table public.organizations add column workspace_id uuid references public.workspaces(id);
alter table public.people add column workspace_id uuid references public.workspaces(id);
create index organizations_workspace on public.organizations(workspace_id);
create index people_workspace on public.people(workspace_id);

-- NULLS NOT DISTINCT retains global deduplication for legacy self-host rows.
drop index public.idx_organizations_domain;
create unique index idx_organizations_domain on public.organizations(domain, workspace_id)
  nulls not distinct where domain is not null;
drop index public.idx_people_linkedin;
create unique index idx_people_linkedin on public.people(linkedin_url, workspace_id)
  nulls not distinct where linkedin_url is not null;
drop index public.idx_people_github_url;
create unique index idx_people_github_url on public.people(github_url, workspace_id)
  nulls not distinct where github_url is not null;
-- Until hosted policies land, assigned records are quarantined from legacy
-- callers. Retain identifier-first indexes for their existing lookup paths.
create policy workspace_pending on public.organizations as restrictive for all to authenticated
  using (workspace_id is null) with check (workspace_id is null);
create policy workspace_pending on public.people as restrictive for all to authenticated
  using (workspace_id is null) with check (workspace_id is null);
commit;
