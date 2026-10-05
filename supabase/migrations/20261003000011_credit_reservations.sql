begin;
create table public.credit_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id text not null,
  operation_key text not null check (length(operation_key) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  kind text not null check (length(kind) between 1 and 100),
  source text not null check (source in ('web', 'mcp', 'job')),
  rate_version text not null,
  credits bigint not null check (credits between 1 and 1000000),
  charged bigint check (charged between 0 and credits),
  state text not null default 'reserved' check (state in ('reserved', 'running', 'succeeded', 'released', 'uncertain')),
  reserved_until timestamptz not null default (clock_timestamp() + interval '2 minutes'),
  created_at timestamptz not null default now(),
  unique (workspace_id, operation_key),
  unique (workspace_id, id)
);
create index credit_operations_active on public.credit_operations(workspace_id, state);
alter table public.credit_grants add unique (workspace_id, id);
create table public.credit_allocations (
  workspace_id uuid not null,
  operation_id uuid not null,
  grant_id uuid not null,
  credits bigint not null check (credits > 0),
  primary key (operation_id, grant_id),
  foreign key (workspace_id, operation_id) references public.credit_operations(workspace_id, id) on delete cascade,
  foreign key (workspace_id, grant_id) references public.credit_grants(workspace_id, id) on delete cascade
);
alter table public.credit_operations enable row level security;
alter table public.credit_allocations enable row level security;
revoke all on public.credit_operations, public.credit_allocations from anon, authenticated;
grant all on public.credit_operations, public.credit_allocations to service_role;

create function public.reserve_credits(p_workspace uuid, p_user text, p_key text,
  p_hash text, p_kind text, p_source text, p_credits bigint, p_version text)
returns public.credit_operations language plpgsql security definer set search_path = '' as $$
declare op public.credit_operations; lot public.credit_grants; remaining bigint := p_credits;
  take bigint; at_time timestamptz; held boolean;
begin
  if p_credits is null or p_credits not between 1 and 1000000 or p_key is null
    or length(p_key) not between 1 and 200 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
    or p_kind is null or length(p_kind) not between 1 and 100 or p_source is null
    or p_source not in ('web', 'mcp', 'job') or p_version is null
    or length(p_version) not between 1 and 100 then
    raise exception 'Invalid credit operation' using errcode = '23514';
  end if;
  perform 1 from public.workspace_members where workspace_id = p_workspace
    and user_id = p_user and active for share;
  if not found then raise exception 'Active workspace member required' using errcode = '42501'; end if;
  -- One lock orders every balance mutation, across all members and interfaces.
  perform 1 from public.workspaces where id = p_workspace for update;
  select risk_hold into held from public.workspace_billing where workspace_id = p_workspace for share;
  if coalesce(held, false) then raise exception 'Billing review required' using errcode = '42501'; end if;
  at_time := clock_timestamp();
  select * into op from public.credit_operations where workspace_id = p_workspace and operation_key = p_key;
  if found then
    if op.user_id <> p_user or op.request_hash <> p_hash or op.kind <> p_kind
      or op.source <> p_source or op.credits <> p_credits or op.rate_version <> p_version then
      raise exception 'Operation key reused with different request' using errcode = '23505';
    end if;
    return op;
  end if;
  if (select count(*) from public.credit_operations where workspace_id = p_workspace
    and state in ('reserved', 'running', 'uncertain')) >= 4 then
    raise exception 'Workspace concurrency limit reached' using errcode = '55P03';
  end if;
  insert into public.credit_operations(workspace_id, user_id, operation_key, request_hash, kind, source, credits, rate_version)
    values (p_workspace, p_user, p_key, p_hash, p_kind, p_source, p_credits, p_version) returning * into op;
  for lot in select * from public.credit_grants where workspace_id = p_workspace
    and (expires_at is null or expires_at > at_time) and credits > reserved + consumed
    order by expires_at nulls last, created_at, id for update loop
    take := least(remaining, lot.credits - lot.reserved - lot.consumed);
    update public.credit_grants set reserved = reserved + take where id = lot.id;
    insert into public.credit_allocations values (p_workspace, op.id, lot.id, take);
    remaining := remaining - take;
    exit when remaining = 0;
  end loop;
  if remaining <> 0 then raise exception 'Insufficient credits' using errcode = '23514'; end if;
  return op;
end $$;
revoke all on function public.reserve_credits(uuid, text, text, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid, text, text, text, text, text, bigint, text) to service_role;
commit;
