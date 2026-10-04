\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('settle-owner') as w \gset
select public.grant_credits(:'w', 'settle:soon', 2, 'v1', now() + interval '1 day');
select public.grant_credits(:'w', 'settle:later', 8, 'v1', null);
do $$ declare w uuid; op public.credit_operations; begin
  select id into w from public.workspaces where owner_user_id = 'settle-owner';
  op := public.reserve_credits(w, 'settle-owner', 'batch', repeat('a',64), 'research', 'web', 5, 'v1');
  if not public.start_credit_operation(op.id, 'settle-owner') then raise exception 'First start refused'; end if;
  if public.start_credit_operation(op.id, 'settle-owner') then raise exception 'Operation started twice'; end if;
  perform public.finish_credit_operation(op.id, 'settle-owner', 'succeeded', 3, '{"done":3}');
  perform public.finish_credit_operation(op.id, 'settle-owner', 'succeeded', 3, '{"done":3}');
  if (select sum(consumed) from public.credit_grants where workspace_id = w) <> 3 then raise exception 'Settlement charged twice'; end if;
  if (select sum(reserved) from public.credit_grants where workspace_id = w) <> 0 then raise exception 'Unused batch credits not released'; end if;
  if (select consumed from public.credit_grants where source_key = 'settle:soon') <> 2 then raise exception 'Settlement ignored expiry ordering'; end if;
  begin
    perform public.finish_credit_operation(op.id, 'settle-owner', 'succeeded', 4, '{"done":4}');
    raise exception 'Conflicting settlement accepted';
  exception when unique_violation then null; end;
  op := public.reserve_credits(w, 'settle-owner', 'expired', repeat('a',64), 'research', 'web', 2, 'v1');
  update public.credit_operations set reserved_until = now() - interval '1 second' where id = op.id;
  if public.start_credit_operation(op.id, 'settle-owner') then raise exception 'Expired reservation started'; end if;
  if public.release_expired_credit_reservations(100) <> 1 then raise exception 'Unstarted work not recovered'; end if;
  op := public.reserve_credits(w, 'settle-owner', 'uncertain', repeat('a',64), 'research', 'job', 1, 'v1');
  perform public.start_credit_operation(op.id, 'settle-owner');
  perform public.finish_credit_operation(op.id, 'settle-owner', 'uncertain', null, null);
  if (select sum(reserved) from public.credit_grants where workspace_id = w) <> 1 then raise exception 'Ambiguous provider work refunded'; end if;
  if public.start_credit_operation(op.id, 'settle-owner') then raise exception 'Ambiguous work restarted'; end if;
  perform public.release_expired_credit_reservations(100);
  if (select state from public.credit_operations where id = op.id) <> 'uncertain' then raise exception 'Recovery erased uncertain outcome'; end if;
  perform public.finish_credit_operation(op.id, 'settle-owner', 'succeeded', 1, '{"reconciled":true}');
  op := public.reserve_credits(w, 'settle-owner', 'held', repeat('a',64), 'research', 'web', 1, 'v1');
  insert into public.workspace_billing(workspace_id, risk_hold) values(w, true);
  if public.start_credit_operation(op.id, 'settle-owner') then raise exception 'Hold after reservation bypassed'; end if;
  perform public.finish_credit_operation(op.id, 'settle-owner', 'released', 0, null);
  update public.workspace_billing set risk_hold = false where workspace_id = w;
  op := public.reserve_credits(w, 'settle-owner', 'revoked', repeat('a',64), 'research', 'web', 1, 'v1');
  update public.workspace_members set active = false where user_id = 'settle-owner';
  if public.start_credit_operation(op.id, 'settle-owner') then raise exception 'Revoked member started work'; end if;
  perform public.finish_credit_operation(op.id, 'settle-owner', 'released', 0, null);
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.start_credit_operation(gen_random_uuid(), 'settle-owner');
    raise exception 'Client started work directly';
  exception when insufficient_privilege then null; end;
  begin
    perform public.finish_credit_operation(gen_random_uuid(), 'settle-owner', 'succeeded', 0, null);
    raise exception 'Client changed a charge';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
