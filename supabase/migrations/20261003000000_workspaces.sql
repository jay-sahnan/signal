begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null unique check (length(trim(owner_user_id)) > 0),
  name text not null default 'My workspace',
  created_at timestamptz not null default now()
);

-- Initial hosted product: one workspace per account. Keep revoked memberships
-- as tombstones so logging in cannot silently recreate an owner's access.
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id),
  user_id text primary key,
  role text not null check (role in ('owner', 'member')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index workspace_members_workspace on public.workspace_members(workspace_id);
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
revoke all on public.workspaces, public.workspace_members from anon, authenticated;
grant select on public.workspaces, public.workspace_members to authenticated;
grant all on public.workspaces, public.workspace_members to service_role;

create function public.requesting_workspace_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select workspace_id from public.workspace_members
  where user_id = public.requesting_user_id() and active
$$;
revoke all on function public.requesting_workspace_id() from public, anon;
grant execute on function public.requesting_workspace_id() to authenticated, service_role;

create policy workspace_read on public.workspaces for select to authenticated
  using (id = public.requesting_workspace_id());
create policy membership_read on public.workspace_members for select to authenticated
  using (workspace_id = public.requesting_workspace_id());

-- Only trusted server code may provision an already authenticated identity.
create function public.ensure_workspace(p_user_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid;
  v_active boolean;
begin
  if p_user_id is null or length(trim(p_user_id)) = 0 then
    raise exception 'User identity required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 781));
  select workspace_id, active into v_workspace, v_active
    from public.workspace_members where user_id = p_user_id;
  if found then
    if not v_active then
      raise exception 'Workspace membership revoked' using errcode = '42501';
    end if;
    return v_workspace;
  end if;
  insert into public.workspaces(owner_user_id) values (p_user_id)
    returning id into v_workspace;
  insert into public.workspace_members(workspace_id, user_id, role)
    values (v_workspace, p_user_id, 'owner');
  return v_workspace;
end $$;
revoke all on function public.ensure_workspace(text) from public, anon, authenticated;
grant execute on function public.ensure_workspace(text) to service_role;
commit;
