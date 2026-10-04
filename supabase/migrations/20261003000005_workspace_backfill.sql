begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function public.workspace_data_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'organizations', 'people', 'campaigns', 'user_profile', 'chats',
    'signals', 'signal_results', 'campaign_organizations', 'campaign_people',
    'campaign_signals', 'tracking_configs', 'tracking_snapshots', 'tracking_changes',
    'outreach_events', 'email_drafts', 'sent_emails', 'email_replies', 'sequences',
    'sequence_steps', 'sequence_enrollments', 'email_voice_profiles', 'sender_facts',
    'email_learnings', 'outreach_suppressions', 'outreach_timing_stats', 'user_settings'
  ]::text[]
$$;

create function public.workspace_backfill_report() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t text; n bigint; owners text[] := array[]::text[]; found_owners text[];
  counts jsonb := '{}'::jsonb;
begin
  foreach t in array public.workspace_data_tables() loop
    execute format('select count(*), array_agg(distinct to_jsonb(r)->>''user_id'')
      from public.%I r where workspace_id is null %s', t,
      case when t = 'signals' then 'and not is_builtin' else '' end)
      into n, found_owners;
    counts := counts || jsonb_build_object(t, n);
    owners := owners || coalesce(found_owners, array[]::text[]);
  end loop;
  select coalesce(array_agg(distinct u order by u), array[]::text[]) into owners
    from unnest(owners) u where u is not null;
  return jsonb_build_object('unassigned', counts, 'owners', owners);
end $$;

-- Invoke in a maintenance transaction with SET LOCAL lock_timeout = '5s'
-- and SET LOCAL statement_timeout = '300s'; rehearse and inspect the report first.
-- This operation is deliberately limited to a single, explicitly confirmed
-- legacy team. Mixed customer graphs require a reviewed clone/remap migration.
create function public.assign_legacy_workspace(p_owner text, p_confirmed_users text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t text; u text; w uuid; expected text[]; actual text[]; conflict boolean;
begin
  lock table public.deployment_settings, public.workspaces, public.workspace_members
    in share row exclusive mode;
  if public.hosted_mode() then
    raise exception 'Pause hosted operation before backfill' using errcode = '23514';
  end if;
  foreach t in array public.workspace_data_tables() loop
    execute format('lock table public.%I in share row exclusive mode', t);
  end loop;
  select coalesce(array_agg(distinct x order by x), array[]::text[]) into expected
    from unnest(p_confirmed_users) x where x is not null;
  select coalesce(array_agg(x order by x), array[]::text[]) into actual
    from jsonb_array_elements_text(public.workspace_backfill_report()->'owners') x;
  if expected is distinct from actual or
    (cardinality(actual) > 0 and not p_owner = any(actual)) then
    raise exception 'Historical owners must be explicitly confirmed as one team' using errcode = '23514';
  end if;
  w := public.ensure_workspace(p_owner);
  if exists(select 1 from public.workspace_members
    where user_id = any(expected) and (workspace_id <> w or not active)) then
    raise exception 'Historical user already belongs to a different or revoked workspace' using errcode = '23514';
  end if;
  foreach u in array expected loop
    insert into public.workspace_members(workspace_id, user_id, role)
      values (w, u, 'member') on conflict (user_id) do nothing;
  end loop;
  foreach t in array public.workspace_data_tables() loop
    execute format('select exists(select 1 from public.%I where workspace_id <> $1)', t)
      into conflict using w;
    if conflict then
      raise exception 'Existing workspace data in % requires a reviewed migration', t using errcode = '23514';
    end if;
    execute format('update public.%I set workspace_id = $1 where workspace_id is null %s', t,
      case when t = 'signals' then 'and not is_builtin' else '' end) using w;
  end loop;
  -- Validate the whole connected graph with the real ownership triggers. The
  -- flag is restored before commit; failure rolls back every assignment.
  update public.deployment_settings set hosted_enabled = true;
  foreach t in array public.workspace_data_tables() loop
    execute format('update public.%I set workspace_id = workspace_id', t);
  end loop;
  update public.deployment_settings set hosted_enabled = false;
  return w;
end $$;

revoke all on function public.workspace_data_tables(), public.workspace_backfill_report(),
  public.assign_legacy_workspace(text, text[]) from public, anon, authenticated;
grant execute on function public.workspace_data_tables(), public.workspace_backfill_report(),
  public.assign_legacy_workspace(text, text[]) to service_role;
commit;
