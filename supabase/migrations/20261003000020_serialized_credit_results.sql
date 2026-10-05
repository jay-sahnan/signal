begin;
-- Preserve the exact JSON bytes accepted by the application. JSONB expands tiny
-- floating-point values and cannot represent JSON strings containing \u0000.
create table public.credit_serialized_results (
 operation_id uuid primary key references public.credit_operations(id) on delete cascade,
 payload text not null check (octet_length(payload) <= 1000000)
);
alter table public.credit_serialized_results enable row level security;
revoke all on public.credit_serialized_results from public, anon, authenticated;
grant all on public.credit_serialized_results to service_role;
create function public.finish_serialized_credit_result(p_id uuid, p_user text, p_charged bigint, p_result text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare op public.credit_operations; stored text;
begin
 if p_result is null then raise exception 'Serialized JSON required'; end if;
 perform p_result::json; -- Validate JSON syntax without converting to JSONB.
 select * into op from public.credit_operations where id = p_id and user_id = p_user;
 if not found then raise exception 'Operation unavailable' using errcode = '42501'; end if;
 perform 1 from public.workspaces where id = op.workspace_id for update;
 select * into op from public.credit_operations where id = p_id for update;
 if op.state = 'succeeded' and not exists(select 1 from public.credit_serialized_results where operation_id = p_id) then
  raise exception 'Completed legacy result cannot be replaced' using errcode = '23505';
 end if;
 insert into public.credit_serialized_results values (p_id,p_result) on conflict do nothing;
 select payload into stored from public.credit_serialized_results where operation_id = p_id;
 if stored is distinct from p_result then raise exception 'Conflicting serialized result' using errcode = '23505'; end if;
 return public.finish_credit_operation(p_id,p_user,'succeeded',p_charged,null);
end $$;
create function public.read_serialized_credit_result(p_id uuid, p_user text)
returns text language plpgsql security definer set search_path = '' as $$
declare legacy jsonb; stored text;
begin
 -- Reuse the completed-operation and active-member authorization checks.
 legacy := public.read_credit_result(p_id,p_user);
 select payload into stored from public.credit_serialized_results where operation_id = p_id;
 if found then return stored; end if;
 return coalesce(legacy::text, 'null');
end $$;
revoke all on function public.finish_serialized_credit_result(uuid,text,bigint,text),
 public.read_serialized_credit_result(uuid,text) from public, anon, authenticated;
grant execute on function public.finish_serialized_credit_result(uuid,text,bigint,text),
 public.read_serialized_credit_result(uuid,text) to service_role;
commit;
