\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('credit-spender') as w \gset
select public.grant_credits(:'w', 'credits:expired', 100, 'v1', now() - interval '1 day');
select public.grant_credits(:'w', 'credits:soon', 1, 'v1', now() + interval '1 day');
select public.grant_credits(:'w', 'credits:permanent', 1, 'v1', null);
select (public.reserve_credits(:'w', 'credit-spender', 'one', repeat('a',64), 'research', 'web', 1, 'v1')).id as op \gset
select (public.reserve_credits(:'w', 'credit-spender', 'one', repeat('a',64), 'research', 'web', 1, 'v1')).id = :'op' as same_op \gset
\if :same_op
\else
  \quit 1
\endif
do $$ declare w uuid; begin
  select id into w from public.workspaces where owner_user_id = 'credit-spender';
  if (select reserved from public.credit_grants where source_key = 'credits:soon') <> 1 then raise exception 'Soonest expiry not spent first'; end if;
  if (select sum(reserved) from public.credit_grants where workspace_id = w) <> 1 then raise exception 'Retry double-reserved'; end if;
  begin
    perform public.reserve_credits(w, 'credit-spender', 'one', repeat('b',64), 'research', 'web', 1, 'v1');
    raise exception 'Key reused for a different payload';
  exception when unique_violation then null; end;
  begin
    perform public.reserve_credits(w, 'forged', 'two', repeat('a',64), 'research', 'web', 1, 'v1');
    raise exception 'Forged member reserved credits';
  exception when insufficient_privilege then null; end;
  perform public.reserve_credits(w, 'credit-spender', 'two', repeat('a',64), 'research', 'mcp', 1, 'v1');
  begin
    perform public.reserve_credits(w, 'credit-spender', 'three', repeat('a',64), 'research', 'job', 1, 'v1');
    raise exception 'Expired or exhausted credits spent';
  exception when check_violation then null; end;
  insert into public.workspace_billing(workspace_id, risk_hold) values(w, true);
  begin
    perform public.reserve_credits(w, 'credit-spender', 'held', repeat('a',64), 'research', 'web', 1, 'v1');
    raise exception 'Billing hold bypassed';
  exception when insufficient_privilege then null; end;
  update public.workspace_billing set risk_hold = false where workspace_id = w;
  perform public.grant_credits(w, 'credits:topup', 100, 'v1', null);
  perform public.reserve_credits(w, 'credit-spender', 'three', repeat('a',64), 'research', 'web', 1, 'v1');
  perform public.reserve_credits(w, 'credit-spender', 'four', repeat('a',64), 'research', 'web', 1, 'v1');
  begin
    perform public.reserve_credits(w, 'credit-spender', 'five', repeat('a',64), 'research', 'web', 1, 'v1');
    raise exception 'Workspace concurrency cap bypassed';
  exception when lock_not_available then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform 1 from public.credit_operations;
    raise exception 'Private operation records exposed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.reserve_credits(gen_random_uuid(), 'credit-spender', 'forged', repeat('a',64), 'research', 'web', 1, 'v1');
    raise exception 'Customer invoked reserve directly';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
