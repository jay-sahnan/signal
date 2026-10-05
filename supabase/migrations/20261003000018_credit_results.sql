begin;
-- Results remain private to the operation's user and are not exposed via REST.
create table public.credit_results (
  operation_id uuid primary key references public.credit_operations(id) on delete cascade,
  result jsonb not null,
  check (octet_length(result::text) <= 2097152)
);
alter table public.credit_results enable row level security;
revoke all on public.credit_results from public, anon, authenticated;
grant all on public.credit_results to service_role;
create function public.finish_credit_result(p_id uuid, p_user text, p_charged bigint, p_result jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare op public.credit_operations; stored jsonb;
begin
  p_result := coalesce(p_result, 'null'::jsonb);
  select * into op from public.credit_operations where id = p_id and user_id = p_user;
  if not found then raise exception 'Operation unavailable' using errcode = '42501'; end if;
  perform 1 from public.workspaces where id = op.workspace_id for update;
  select * into op from public.credit_operations where id = p_id for update;
  if op.state = 'succeeded' and not exists(select 1 from public.credit_results where operation_id = p_id) then
    if coalesce(op.result, 'null'::jsonb) is distinct from p_result then
      raise exception 'Conflicting legacy credit result' using errcode = '23505';
    end if;
    return public.finish_credit_operation(p_id, p_user, 'succeeded', p_charged, op.result);
  end if;
  insert into public.credit_results values (p_id, p_result) on conflict do nothing;
  select result into stored from public.credit_results where operation_id = p_id;
  if stored is distinct from p_result then
    raise exception 'Conflicting credit result' using errcode = '23505';
  end if;
  -- Result storage and charging commit together or roll back together.
  return public.finish_credit_operation(p_id, p_user, 'succeeded', p_charged, null);
end $$;
create function public.read_credit_result(p_id uuid, p_user text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op public.credit_operations; payload jsonb;
begin
  select * into op from public.credit_operations where id = p_id and user_id = p_user and state = 'succeeded';
  if not found then raise exception 'Completed operation required' using errcode = '42501'; end if;
  perform 1 from public.workspace_members where workspace_id = op.workspace_id and user_id = p_user and active for share;
  if not found then raise exception 'Active membership required' using errcode = '42501'; end if;
  select result into payload from public.credit_results where operation_id = p_id;
  if not found then return op.result; end if; -- Compatibility with small legacy replays.
  return payload;
end $$;
revoke all on function public.finish_credit_result(uuid,text,bigint,jsonb),
  public.read_credit_result(uuid,text) from public, anon, authenticated;
grant execute on function public.finish_credit_result(uuid,text,bigint,jsonb),
  public.read_credit_result(uuid,text) to service_role;
commit;
