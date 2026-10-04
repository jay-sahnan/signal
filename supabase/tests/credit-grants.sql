\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('credit-owner') as w \gset
select public.ensure_workspace('credit-other') as other \gset
select public.grant_credits(:'w', 'purchase:test', 100, 'credits-v1', null) as grant_id \gset
select public.grant_credits(:'w', 'purchase:test', 100, 'credits-v1', null) = :'grant_id' as same_grant \gset
\if :same_grant
\else
  \quit 1
\endif
do $$ declare w uuid; other uuid; begin
  select id into w from public.workspaces where owner_user_id = 'credit-owner';
  select id into other from public.workspaces where owner_user_id = 'credit-other';
  if (select sum(credits) from public.credit_grants where workspace_id = w) <> 100 then raise exception 'Payment credited twice'; end if;
  begin
    perform public.grant_credits(other, 'purchase:test', 100, 'credits-v1', null);
    raise exception 'Payment transferred across customers';
  exception when unique_violation then null; end;
  begin
    perform public.grant_credits(w, 'purchase:test', 200, 'credits-v1', null);
    raise exception 'Replay changed purchased credits';
  exception when unique_violation then null; end;
  begin
    perform public.grant_credits(w, 'invalid', -1, 'credits-v1', null);
    raise exception 'Negative credit grant accepted';
  exception when check_violation then null; end;
  begin
    update public.credit_grants set reserved = 101 where workspace_id = w;
    raise exception 'Invalid credit balance accepted';
  exception when check_violation then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"credit-owner"}', true);
set local role authenticated;
do $$ begin
  if (select sum(credits) from public.credit_grants) <> 100 then raise exception 'Owned balance inaccessible'; end if;
  begin
    perform source_key from public.credit_grants;
    raise exception 'Private payment reference exposed';
  exception when insufficient_privilege then null; end;
  begin
    update public.credit_grants set credits = 999999;
    raise exception 'Customer minted credits';
  exception when insufficient_privilege then null; end;
  begin
    perform public.grant_credits(gen_random_uuid(), 'forged', 1, 'v1', null);
    raise exception 'Customer granted credits';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"credit-other"}', true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.credit_grants) then raise exception 'Credit grants crossed workspaces'; end if;
end $$;
rollback;
