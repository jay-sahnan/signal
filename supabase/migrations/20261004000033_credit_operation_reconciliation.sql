begin;
-- Evidence-backed, operator-only resolution. Never driven by a timeout or a
-- customer's assertion. Audit and wallet/result settlement share one transaction.
create table public.credit_operation_reconciliations (
 operation_id uuid primary key references public.credit_operations(id),
 workspace_id uuid not null references public.workspaces(id),
 execution_attempt uuid not null,
 operator_name text not null,
 evidence_reference text not null,
 charged bigint not null,
 resolved_at timestamptz not null default clock_timestamp()
);
alter table public.credit_operation_reconciliations enable row level security;
revoke all on public.credit_operation_reconciliations from public, anon, authenticated, service_role;
grant select on public.credit_operation_reconciliations to service_role;

create function public.reconcile_credit_operation(p_id uuid, p_attempt uuid,
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
 perform public.finish_serialized_credit_result(p_id,op.user_id,p_charged,p_result);
 insert into public.credit_operation_reconciliations
  (operation_id,workspace_id,execution_attempt,operator_name,evidence_reference,charged)
  values(p_id,op.workspace_id,p_attempt,p_operator,p_evidence,p_charged);
 return true;
end $$;
revoke all on function public.reconcile_credit_operation(uuid,uuid,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.reconcile_credit_operation(uuid,uuid,text,text,bigint,text) to service_role;
commit;
