begin;
-- Aggregate inside PostgreSQL so expiry uses its clock and REST row limits cannot
-- silently truncate the wallet. Reserved credits survive expiry until settlement.
create function public.credit_summary(p_workspace uuid, p_user text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare summary jsonb;
begin
  perform 1 from public.workspace_members
    where workspace_id = p_workspace and user_id = p_user and active for share;
  if not found then
    raise exception 'Active workspace membership required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'available', coalesce(sum(case when expires_at is null or expires_at > statement_timestamp()
      then credits - reserved - consumed else 0 end), 0),
    'reserved', coalesce(sum(reserved), 0),
    'spent', coalesce(sum(consumed), 0)) into summary
    from public.credit_grants where workspace_id = p_workspace;
  return summary;
end $$;
revoke all on function public.credit_summary(uuid, text) from public, anon, authenticated;
grant execute on function public.credit_summary(uuid, text) to service_role;
commit;
