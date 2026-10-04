begin;
-- Credit lots support purchased packs or periodic grants. An expiry is explicit;
-- null means the credits do not expire. Purchase policy is decided by the caller.
create table public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_key text not null unique check (length(source_key) between 1 and 255),
  credits bigint not null check (credits between 1 and 1000000000),
  reserved bigint not null default 0 check (reserved >= 0),
  consumed bigint not null default 0 check (consumed >= 0),
  rate_version text not null check (length(rate_version) between 1 and 100),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (reserved + consumed <= credits)
);
create index credit_grants_workspace on public.credit_grants(workspace_id, expires_at);
alter table public.credit_grants enable row level security;
revoke all on public.credit_grants from anon, authenticated;
grant select (id, workspace_id, credits, reserved, consumed, rate_version, expires_at, created_at)
  on public.credit_grants to authenticated;
grant all on public.credit_grants to service_role;
create policy credit_grants_read on public.credit_grants for select to authenticated
  using (workspace_id = public.requesting_workspace_id());

-- Only trusted payment fulfillment calls this after verifying a settled payment.
-- Deduplication is by the economic purchase, not the webhook delivery event ID.
create function public.grant_credits(p_workspace uuid, p_source text, p_credits bigint,
  p_rate_version text, p_expires timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare row public.credit_grants;
begin
  if p_workspace is null or p_source is null or length(p_source) not between 1 and 255
    or p_credits is null or p_credits not between 1 and 1000000000
    or p_rate_version is null or length(p_rate_version) not between 1 and 100 then
    raise exception 'Invalid credit grant' using errcode = '23514';
  end if;
  insert into public.credit_grants(workspace_id, source_key, credits, rate_version, expires_at)
    values (p_workspace, p_source, p_credits, p_rate_version, p_expires)
    on conflict (source_key) do nothing;
  select * into strict row from public.credit_grants where source_key = p_source;
  if row.workspace_id <> p_workspace or row.credits <> p_credits
    or row.rate_version <> p_rate_version or row.expires_at is distinct from p_expires then
    raise exception 'Credit grant conflicts with previous purchase' using errcode = '23505';
  end if;
  return row.id;
end $$;
revoke all on function public.grant_credits(uuid, text, bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function public.grant_credits(uuid, text, bigint, text, timestamptz) to service_role;
commit;
