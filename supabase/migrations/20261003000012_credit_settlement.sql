begin;
alter table public.credit_operations add column started_at timestamptz;
alter table public.credit_operations add column finished_at timestamptz;
alter table public.credit_operations add column result jsonb;

create function public.start_credit_operation(p_id uuid, p_user text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare op public.credit_operations; held boolean; changed integer;
begin
  select * into op from public.credit_operations where id = p_id and user_id = p_user;
  if not found then return false; end if;
  perform 1 from public.workspace_members where workspace_id = op.workspace_id and user_id = p_user and active for share;
  if not found then return false; end if;
  perform 1 from public.workspaces where id = op.workspace_id for update;
  select risk_hold into held from public.workspace_billing where workspace_id = op.workspace_id for share;
  if coalesce(held, false) then return false; end if;
  update public.credit_operations set state = 'running', started_at = clock_timestamp()
    where id = p_id and state = 'reserved' and reserved_until > clock_timestamp();
  get diagnostics changed = row_count;
  return changed = 1;
end $$;

create function public.finish_credit_operation(p_id uuid, p_user text, p_state text,
  p_charged bigint, p_result jsonb default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare op public.credit_operations; allocation record; remaining bigint := p_charged; take bigint;
begin
  select * into op from public.credit_operations where id = p_id and user_id = p_user;
  if not found then raise exception 'Credit operation unavailable' using errcode = '42501'; end if;
  perform 1 from public.workspaces where id = op.workspace_id for update;
  select * into op from public.credit_operations where id = p_id for update;
  if p_state is null or p_state not in ('succeeded', 'released', 'uncertain')
    or (p_state = 'uncertain' and (p_charged is not null or p_result is not null))
    or (p_state <> 'uncertain' and (p_charged is null or p_charged < 0 or p_charged > op.credits))
    or (p_state = 'released' and (p_charged <> 0 or p_result is not null))
    or pg_column_size(p_result) > 262144 then
    raise exception 'Invalid credit settlement' using errcode = '23514';
  end if;
  if op.state in ('succeeded', 'released') then
    if op.state <> p_state or op.charged is distinct from p_charged or op.result is distinct from p_result then
      raise exception 'Conflicting credit settlement' using errcode = '23505';
    end if;
    return false;
  end if;
  if p_state = 'uncertain' and op.state = 'uncertain' then return false; end if;
  if (p_state = 'released' and op.state <> 'reserved')
    or (p_state <> 'released' and op.state not in ('running', 'uncertain')) then
    raise exception 'Operation is not in a settleable state' using errcode = '55000';
  end if;
  if p_state = 'uncertain' then
    update public.credit_operations set state = 'uncertain' where id = p_id;
    return true; -- Retain reserved credits until the external outcome is known.
  end if;
  if (select sum(credits) from public.credit_allocations where operation_id = p_id) is distinct from op.credits then
    raise exception 'Credit allocation invariant failed';
  end if;
  for allocation in select a.* from public.credit_allocations a join public.credit_grants g on g.id = a.grant_id
    where a.operation_id = p_id order by g.expires_at nulls last, g.created_at, g.id loop
    take := least(remaining, allocation.credits);
    update public.credit_grants set reserved = reserved - allocation.credits, consumed = consumed + take
      where id = allocation.grant_id;
    remaining := remaining - take;
  end loop;
  update public.credit_operations set state = p_state, charged = p_charged, result = p_result,
    finished_at = clock_timestamp() where id = p_id;
  return true;
end $$;

-- Only unstarted reservations can be refunded automatically. Running/uncertain
-- operations need provider reconciliation; elapsed time is not proof of failure.
create function public.release_expired_credit_reservations(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare op record; released integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid recovery batch'; end if;
  for op in select id, user_id from public.credit_operations where state = 'reserved'
    and reserved_until <= clock_timestamp() order by workspace_id, id limit p_limit loop
    begin
      if public.finish_credit_operation(op.id, op.user_id, 'released', 0, null) then released := released + 1; end if;
    exception when object_not_in_prerequisite_state or unique_violation then null; -- Another worker advanced it.
    end;
  end loop;
  return released;
end $$;
revoke all on function public.start_credit_operation(uuid, text),
  public.finish_credit_operation(uuid, text, text, bigint, jsonb),
  public.release_expired_credit_reservations(integer) from public, anon, authenticated;
grant execute on function public.start_credit_operation(uuid, text),
  public.finish_credit_operation(uuid, text, text, bigint, jsonb),
  public.release_expired_credit_reservations(integer) to service_role;
commit;
