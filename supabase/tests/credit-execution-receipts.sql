\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('receipt-owner') as w \gset
select public.grant_credits(:'w','receipt-grant',10,'v1',null);
select (public.reserve_credit_quote(:'w','receipt-owner','receipt',repeat('a',64),'research','web',5,'v1')).id as op \gset
do $$ declare op uuid; attempt uuid := gen_random_uuid(); begin
 select id into op from public.credit_operations where user_id = 'receipt-owner';
 if not public.claim_credit_execution(op,'receipt-owner',attempt) then raise exception 'Start failed'; end if;
 if not public.claim_credit_execution(op,'receipt-owner',attempt) then raise exception 'Lost response not recoverable'; end if;
 if public.claim_credit_execution(op,'receipt-owner',gen_random_uuid()) then raise exception 'New invocation took over running work'; end if;
 if public.claim_credit_execution(op,'foreign',attempt) then raise exception 'Foreign caller confirmed execution'; end if;
 update public.workspace_members set active = false where user_id = 'receipt-owner';
 if public.claim_credit_execution(op,'receipt-owner',attempt) then raise exception 'Revoked caller confirmed execution'; end if;
end $$;
rollback;
