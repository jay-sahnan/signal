begin;
-- A configuration update cannot change an existing operation's agreed quote.
-- Keep the strict reservation RPC for callers validating an explicit old quote.
create function public.reserve_credit_quote(p_workspace uuid, p_user text, p_key text,
  p_hash text, p_kind text, p_source text, p_credits bigint, p_version text)
returns public.credit_operations language plpgsql security definer set search_path = '' as $$
declare op public.credit_operations;
begin
  perform 1 from public.workspace_members where workspace_id = p_workspace
    and user_id = p_user and active for share;
  if not found then raise exception 'Active workspace member required' using errcode = '42501'; end if;
  perform 1 from public.workspaces where id = p_workspace for update;
  select * into op from public.credit_operations where workspace_id = p_workspace and operation_key = p_key;
  if found then
    p_credits := op.credits;
    p_version := op.rate_version;
  end if;
  -- This still validates membership, hold, payload, kind, source and user.
  return public.reserve_credits(p_workspace, p_user, p_key, p_hash, p_kind, p_source, p_credits, p_version);
end $$;
revoke all on function public.reserve_credit_quote(uuid,text,text,text,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.reserve_credit_quote(uuid,text,text,text,text,text,bigint,text) to service_role;
commit;
