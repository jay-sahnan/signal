begin;
set local lock_timeout = '5s';
create table public.deployment_settings (
  singleton boolean primary key default true check (singleton),
  hosted_enabled boolean not null default false,
  schema_version integer not null default 0
);
insert into public.deployment_settings default values;
alter table public.deployment_settings enable row level security;
revoke all on public.deployment_settings from public, anon, authenticated;
grant select, update on public.deployment_settings to service_role;
create function public.hosted_mode() returns boolean
language sql stable security definer set search_path = '' as $$
  select hosted_enabled from public.deployment_settings where singleton
$$;
revoke all on function public.hosted_mode() from public, anon;
grant execute on function public.hosted_mode() to authenticated, service_role;

-- A shared boundary covers browser inserts, tool inserts, and CSV imports.
-- Existing self-host rows remain in their legacy NULL workspace until cutover.
create function public.set_prospect_workspace() returns trigger
language plpgsql set search_path = '' as $$
declare
  parent_workspace uuid;
begin
  if not public.hosted_mode() then return new; end if;
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'Workspace ownership is immutable' using errcode = '23514';
  end if;
  new.workspace_id := coalesce(new.workspace_id, public.requesting_workspace_id());
  if tg_table_name = 'people' then
    if new.organization_id is not null then
      select workspace_id into parent_workspace from public.organizations
        where id = new.organization_id for key share;
      new.workspace_id := coalesce(new.workspace_id, parent_workspace);
      if parent_workspace is null or parent_workspace is distinct from new.workspace_id then
        raise exception 'Company belongs to another workspace' using errcode = '23514';
      end if;
    end if;
  end if;
  if new.workspace_id is null then
    raise exception 'Workspace identity required' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger organizations_workspace_write before insert or update on public.organizations
  for each row execute function public.set_prospect_workspace();
create trigger people_workspace_write before insert or update on public.people
  for each row execute function public.set_prospect_workspace();

create policy organizations_workspace_boundary on public.organizations
  as restrictive for all to authenticated
  using (not public.hosted_mode() or workspace_id = public.requesting_workspace_id())
  with check (not public.hosted_mode() or workspace_id = public.requesting_workspace_id());
create policy people_workspace_boundary on public.people
  as restrictive for all to authenticated
  using (not public.hosted_mode() or workspace_id = public.requesting_workspace_id())
  with check (not public.hosted_mode() or workspace_id = public.requesting_workspace_id());
commit;
