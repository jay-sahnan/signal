\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('checkout_owner') as w \gset
select public.ensure_workspace('checkout_attacker');
insert into public.workspace_billing(workspace_id) values (:'w');
do $$ declare w uuid; first_key uuid; next_key uuid; row public.workspace_billing; begin
  select id into w from public.workspaces where owner_user_id = 'checkout_owner';
  begin
    perform public.claim_checkout(w, 'checkout_attacker');
    raise exception 'Forged checkout owner accepted';
  exception when insufficient_privilege then null;
  end;
  row := public.claim_checkout(w, 'checkout_owner'); first_key := row.checkout_key;
  row := public.claim_checkout(w, 'checkout_owner');
  if first_key is null or row.checkout_key <> first_key then raise exception 'Checkout retry changed key'; end if;
  row := public.claim_checkout(w, 'checkout_owner', first_key); next_key := row.checkout_key;
  row := public.claim_checkout(w, 'checkout_owner', first_key);
  if next_key = first_key or row.checkout_key <> next_key then raise exception 'Concurrent rotation changed key twice'; end if;
  update public.workspace_billing set risk_hold = true where workspace_id = w;
  begin
    perform public.claim_checkout(w, 'checkout_owner');
    raise exception 'Risk hold bypassed by checkout';
  exception when insufficient_privilege then null;
  end;
  update public.workspace_billing set risk_hold = false, status = 'active' where workspace_id = w;
  begin
    perform public.claim_checkout(w, 'checkout_owner');
    raise exception 'Second checkout for active subscription accepted';
  exception when insufficient_privilege then null;
  end;
  update public.workspace_billing set status = 'none' where workspace_id = w;
  update public.workspace_members set active = false where user_id = 'checkout_owner';
  begin
    perform public.claim_checkout(w, 'checkout_owner');
    raise exception 'Revoked owner accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.claim_checkout('00000000-0000-0000-0000-000000000000', 'checkout_owner');
    raise exception 'Direct customer checkout claim accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
