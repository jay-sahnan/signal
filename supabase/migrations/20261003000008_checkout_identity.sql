begin;
alter table public.workspace_billing add column checkout_key uuid;
alter table public.workspace_billing add column checkout_session_id text;

-- Only trusted website code calls this after checking origin and Clerk identity.
-- The database independently verifies active owner membership and serializes
-- retries/rotation. A previous key may rotate only after Stripe confirms expiry.
create function public.claim_checkout(p_workspace uuid, p_user_id text, p_previous uuid default null)
returns public.workspace_billing language plpgsql security definer set search_path = '' as $$
declare row public.workspace_billing;
begin
  if not exists(select 1 from public.workspaces w join public.workspace_members m
    on m.workspace_id = w.id where w.id = p_workspace and w.owner_user_id = p_user_id
      and m.user_id = p_user_id and m.active) then
    raise exception 'Active workspace owner required' using errcode = '42501';
  end if;
  insert into public.workspace_billing(workspace_id) values (p_workspace)
    on conflict (workspace_id) do nothing;
  select * into row from public.workspace_billing where workspace_id = p_workspace for update;
  if row.risk_hold or row.status not in ('none', 'canceled', 'incomplete_expired') then
    raise exception 'Manage the current subscription before starting checkout' using errcode = '42501';
  end if;
  if row.checkout_key is null or (p_previous is not null and row.checkout_key = p_previous) then
    update public.workspace_billing set checkout_key = gen_random_uuid(), checkout_session_id = null
      where workspace_id = p_workspace returning * into row;
  end if;
  return row;
end $$;
revoke all on function public.claim_checkout(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_checkout(uuid, text, uuid) to service_role;
commit;
