\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('billing_a') as a \gset
select public.ensure_workspace('billing_b') as b \gset
insert into public.workspace_billing(workspace_id, stripe_customer_id)
  values (:'a', 'cus_a'), (:'b', 'cus_b');
reset role;
select set_config('request.jwt.claims', '{"sub":"billing_a"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.workspace_billing) <> 1 then
    raise exception 'billing records leak across customers';
  end if;
  begin
    update public.workspace_billing set status = 'active';
    raise exception 'customer can self-activate billing';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
