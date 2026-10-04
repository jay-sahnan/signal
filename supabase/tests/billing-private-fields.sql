\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('billing-private-owner') as w \gset
insert into public.workspace_billing(workspace_id, stripe_customer_id, checkout_key)
  values (:'w', 'cus_private', gen_random_uuid());
reset role;
select set_config('request.jwt.claims', '{"sub":"billing-private-owner"}', true);
set local role authenticated;
do $$ begin
  if (select status from public.workspace_billing) <> 'none' then raise exception 'Summary missing'; end if;
  begin
    perform stripe_customer_id from public.workspace_billing;
    raise exception 'Internal customer mapping exposed';
  exception when insufficient_privilege then null; end;
  begin
    perform checkout_key from public.workspace_billing;
    raise exception 'Internal checkout key exposed';
  exception when insufficient_privilege then null; end;
  begin
    perform checkout_session_id from public.workspace_billing;
    raise exception 'Internal checkout session exposed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
