begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table public.signals add column source_signal_id uuid references public.signals(id) on delete set null;
create unique index signals_workspace_source on public.signals(workspace_id, source_signal_id)
  where source_signal_id is not null;

-- Invoker RLS and existing workspace triggers remain the authority. A public
-- recipe is copied once; the publisher cannot later change an active campaign.
create function public.set_campaign_signal(p_campaign uuid, p_signal uuid, p_enabled boolean)
returns public.campaign_signals language plpgsql security invoker set search_path = '' as $$
declare
  v_workspace uuid;
  v_target uuid;
  v_profile uuid;
  v_source public.signals;
  v_result public.campaign_signals;
begin
  select workspace_id into v_workspace from public.campaigns
    where id = p_campaign and user_id = public.requesting_user_id();
  if not found then raise exception 'Campaign not found' using errcode = '42501'; end if;
  if public.hosted_mode() then
    select id into v_target from public.signals
      where workspace_id = v_workspace and source_signal_id = p_signal;
  end if;
  if v_target is null then
    select * into v_source from public.signals where id = p_signal;
    if not found then raise exception 'Signal not found' using errcode = '42501'; end if;
    v_target := v_source.id;
    if public.hosted_mode() and not v_source.is_builtin
      and v_source.workspace_id is distinct from v_workspace then
      if not v_source.is_public then raise exception 'Signal not found' using errcode = '42501'; end if;
      select id into v_profile from public.user_profile
        where user_id = public.requesting_user_id() and workspace_id = v_workspace
        order by created_at, id limit 1;
      if v_profile is null then raise exception 'Create a profile before copying a signal' using errcode = '42501'; end if;
      insert into public.signals(name, slug, description, long_description, category,
        icon, execution_type, tool_key, config, created_by, workspace_id, source_signal_id)
      values (v_source.name, 'copy-' || pg_catalog.gen_random_uuid()::text,
        v_source.description, v_source.long_description, v_source.category,
        v_source.icon, v_source.execution_type, v_source.tool_key, v_source.config,
        v_profile, v_workspace, v_source.id)
      on conflict (workspace_id, source_signal_id) where source_signal_id is not null do nothing
      returning id into v_target;
      if v_target is null then
        select id into v_target from public.signals
          where workspace_id = v_workspace and source_signal_id = p_signal;
      end if;
      if v_target is null then raise exception 'Signal copy unavailable' using errcode = '42501'; end if;
    end if;
  end if;
  insert into public.campaign_signals(campaign_id, signal_id, enabled)
    values (p_campaign, v_target, p_enabled)
    on conflict (campaign_id, signal_id) do update set enabled = excluded.enabled
    returning * into v_result;
  return v_result;
end $$;
revoke all on function public.set_campaign_signal(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_campaign_signal(uuid, uuid, boolean) to authenticated, service_role;
commit;
