begin;
alter table public.credit_operations add column execution_attempt uuid;
-- The private token belongs to one live server invocation. It may confirm a
-- lost RPC response, but a new request cannot take over already-started work.
create function public.claim_credit_execution(p_id uuid, p_user text, p_attempt uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare op public.credit_operations; held boolean;
begin
 if p_attempt is null then return false; end if;
 select * into op from public.credit_operations where id = p_id and user_id = p_user;
 if not found then return false; end if;
 perform 1 from public.workspace_members where workspace_id = op.workspace_id and user_id = p_user and active for share;
 if not found then return false; end if;
 perform 1 from public.workspaces where id = op.workspace_id for update;
 select risk_hold into held from public.workspace_billing where workspace_id = op.workspace_id for share;
 if coalesce(held,false) then return false; end if;
 select * into op from public.credit_operations where id = p_id for update;
 if op.state = 'running' then return op.execution_attempt is not distinct from p_attempt; end if;
 if op.state <> 'reserved' or op.reserved_until <= clock_timestamp() then return false; end if;
 update public.credit_operations set state = 'running', execution_attempt = p_attempt,
  started_at = clock_timestamp() where id = p_id;
 return true;
end $$;
revoke all on function public.claim_credit_execution(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.claim_credit_execution(uuid,text,uuid) to service_role;
commit;
