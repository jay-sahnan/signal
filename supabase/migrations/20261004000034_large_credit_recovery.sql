begin;
-- Normal execution keeps its 1 MB limit. Explicit operator recovery preserves
-- larger verified outcomes using PostgreSQL text/TOAST storage, without truncation.
create table public.credit_reconciled_results (
 operation_id uuid primary key references public.credit_operations(id),
 payload text not null
);
alter table public.credit_reconciled_results enable row level security;
revoke all on public.credit_reconciled_results from public, anon, authenticated, service_role;
grant select on public.credit_reconciled_results to service_role;
create or replace function public.reconcile_credit_operation(p_id uuid, p_attempt uuid,
 p_operator text, p_evidence text, p_charged bigint, p_result text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare op public.credit_operations; audit public.credit_operation_reconciliations; stored text;
begin
 if p_attempt is null or p_operator is null or length(trim(p_operator)) not between 3 and 200
  or p_evidence is null or length(trim(p_evidence)) not between 8 and 2000
  or p_charged is null or p_charged < 0 or p_result is null then
  raise exception 'Operator, attempt, evidence and replayable result required' using errcode='23514';
 end if;
 select * into op from public.credit_operations where id=p_id;
 if not found then raise exception 'Operation unavailable' using errcode='42501'; end if;
 -- Match settlement/reservation lock order, serializing racing decisions.
 perform 1 from public.workspaces where id=op.workspace_id for update;
 select * into op from public.credit_operations where id=p_id for update;
 select * into audit from public.credit_operation_reconciliations where operation_id=p_id;
 if found then
  select payload into stored from public.credit_serialized_results where operation_id=p_id;
  if not found then select payload into stored from public.credit_reconciled_results where operation_id=p_id; end if;
  if audit.execution_attempt is distinct from p_attempt or audit.operator_name is distinct from p_operator
   or audit.evidence_reference is distinct from p_evidence or audit.charged is distinct from p_charged
   or stored is distinct from p_result then
   raise exception 'Conflicting reconciliation decision' using errcode='23505';
  end if;
  return false;
 end if;
 if op.state <> 'uncertain' or op.execution_attempt is distinct from p_attempt then
  raise exception 'Only the inspected uncertain attempt can be reconciled' using errcode='55000';
 end if;
 -- Reuse atomic allocation accounting and immutable exact-byte result storage.
 if octet_length(p_result) > 1000000 then
  perform p_result::json;
  insert into public.credit_reconciled_results values(p_id,p_result);
  perform public.finish_credit_operation(p_id,op.user_id,'succeeded',p_charged,null);
 else
  perform public.finish_serialized_credit_result(p_id,op.user_id,p_charged,p_result);
 end if;
 insert into public.credit_operation_reconciliations
  (operation_id,workspace_id,execution_attempt,operator_name,evidence_reference,charged)
  values(p_id,op.workspace_id,p_attempt,p_operator,p_evidence,p_charged);
 return true;
end $$;
create or replace function public.read_serialized_credit_result(p_id uuid, p_user text)
returns text language plpgsql security definer set search_path = '' as $$
declare legacy jsonb; stored text;
begin
 legacy := public.read_credit_result(p_id,p_user);
 select payload into stored from public.credit_serialized_results where operation_id=p_id;
 if found then return stored; end if;
 select payload into stored from public.credit_reconciled_results where operation_id=p_id;
 if found then return stored; end if;
 return coalesce(legacy::text,'null');
end $$;
commit;
