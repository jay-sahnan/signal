\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('billing_a') as a \gset
select public.ensure_workspace('billing_b') as b \gset
insert into public.workspace_billing(workspace_id, stripe_customer_id)
  values (:'a', 'cus_a'), (:'b', 'cus_b');
do $$ begin
  begin
    update public.workspace_billing set period_end = now() where stripe_customer_id = 'cus_a';
    raise exception 'Incomplete billing period accepted';
  exception when check_violation then null;
  end;
end $$;
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
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.billing_events;
    raise exception 'Anonymous inbox read accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.billing_events(id, event_type, customer_id) values ('forged', 'invoice.paid', 'cus_a');
    raise exception 'Anonymous inbox write accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform 1 from public.billing_events;
    raise exception 'Customer inbox read accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.billing_events(id, event_type, customer_id) values ('forged', 'invoice.paid', 'cus_a');
    raise exception 'Customer inbox write accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
