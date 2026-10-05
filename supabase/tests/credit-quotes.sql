\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('quote-owner') as w \gset
select public.grant_credits(:'w','quote-grant',100,'v1',null);
select public.reserve_credit_quote(:'w','quote-owner','stable',repeat('a',64),'research','web',5,'v1');
do $$ declare w uuid; op public.credit_operations; begin
  select id into w from public.workspaces where owner_user_id = 'quote-owner';
  op := public.reserve_credit_quote(w,'quote-owner','stable',repeat('a',64),'research','web',10,'v2');
  if op.credits <> 5 or op.rate_version <> 'v1' then raise exception 'Retry repriced existing operation'; end if;
  op := public.reserve_credit_quote(w,'quote-owner','stable',repeat('a',64),'research','web',null,null);
  if op.credits <> 5 then raise exception 'Existing quote unavailable after rate removal'; end if;
  begin
    perform public.reserve_credit_quote(w,'quote-owner','missing-rate',repeat('a',64),'research','web',null,null);
    raise exception 'Unconfigured work reserved credits';
  exception when check_violation then null; end;
  if (select sum(reserved) from public.credit_grants where workspace_id = w) <> 5 then raise exception 'Retry reserved twice'; end if;
  begin
    perform public.reserve_credit_quote(w,'quote-owner','stable',repeat('b',64),'research','web',10,'v2');
    raise exception 'Payload changed under same key';
  exception when unique_violation then null; end;
  op := public.reserve_credit_quote(w,'quote-owner','new',repeat('a',64),'research','web',10,'v2');
  if op.credits <> 10 or op.rate_version <> 'v2' then raise exception 'New operation used stale quote'; end if;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.reserve_credit_quote(gen_random_uuid(),'quote-owner','forged',repeat('a',64),'research','web',1,'v1');
    raise exception 'Client supplied its own price';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
