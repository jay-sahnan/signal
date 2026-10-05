begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Keep existing owner policies; this restrictive layer adds membership and
-- parent consistency without turning private mailboxes into team credentials.
do $$
declare t text;
begin
  foreach t in array array[
    'campaigns', 'user_profile', 'chats', 'signals', 'signal_results',
    'campaign_organizations', 'campaign_people', 'campaign_signals',
    'tracking_configs', 'tracking_snapshots', 'tracking_changes',
    'outreach_events', 'email_drafts', 'sent_emails', 'email_replies',
    'sequences', 'sequence_steps', 'sequence_enrollments', 'email_voice_profiles',
    'sender_facts', 'email_learnings', 'outreach_suppressions',
    'outreach_timing_stats', 'user_settings'
  ] loop
    execute format('alter table public.%I add column workspace_id uuid references public.workspaces(id)', t);
    execute format('create index %I on public.%I(workspace_id)', t || '_workspace', t);
    execute format('create policy workspace_boundary on public.%I as restrictive for all to authenticated
      using (not public.hosted_mode() or workspace_id = public.requesting_workspace_id() %s)
      with check (not public.hosted_mode() or workspace_id = public.requesting_workspace_id() %s)',
      t, case when t = 'signals' then 'or is_builtin' else '' end,
      case when t = 'signals' then 'or is_builtin' else '' end);
  end loop;
end $$;

create function public.set_record_workspace() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb := to_jsonb(new);
  v_workspace uuid := new.workspace_id;
  owner_workspace uuid;
  parent_workspace uuid;
  parent_key text;
  parent_table text;
  parent_id uuid;
  builtin boolean;
begin
  if not public.hosted_mode() then return new; end if;
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'Workspace ownership is immutable' using errcode = '23514';
  end if;
  if tg_table_name = 'signals' and (row_data->>'is_builtin')::boolean then
    if v_workspace is not null then
      raise exception 'Built-in signals must be global' using errcode = '23514';
    end if;
    return new;
  end if;
  if row_data->>'user_id' is not null then
    select workspace_id into owner_workspace from public.workspace_members
      where user_id = row_data->>'user_id' and active;
    if owner_workspace is null then
      raise exception 'Record owner has no active workspace' using errcode = '23514';
    end if;
    v_workspace := coalesce(v_workspace, owner_workspace);
    if v_workspace <> owner_workspace then
      raise exception 'Record owner belongs to another workspace' using errcode = '23514';
    end if;
  end if;
  -- Identifiers come only from this fixed mapping, never from a client.
  for parent_key, parent_table in select * from jsonb_each_text('{
    "campaign_id":"campaigns", "organization_id":"organizations",
    "person_id":"people", "tracking_config_id":"tracking_configs",
    "sequence_id":"sequences", "sequence_step_id":"sequence_steps",
    "enrollment_id":"sequence_enrollments", "campaign_people_id":"campaign_people",
    "draft_id":"email_drafts", "sent_email_id":"sent_emails",
    "profile_id":"user_profile", "created_by":"user_profile",
    "signal_id":"signals", "trigger_signal_id":"signals"
  }'::jsonb) loop
    if row_data->>parent_key is null then continue; end if;
    parent_id := (row_data->>parent_key)::uuid;
    execute format('select workspace_id from public.%I where id = $1 for key share', parent_table)
      into parent_workspace using parent_id;
    if parent_table = 'signals' and parent_workspace is null then
      select is_builtin into builtin from public.signals where id = parent_id;
      if builtin then continue; end if;
    end if;
    v_workspace := coalesce(v_workspace, parent_workspace);
    if parent_workspace is null or parent_workspace is distinct from v_workspace then
      raise exception 'Cross-workspace % reference', parent_key using errcode = '23514';
    end if;
  end loop;
  v_workspace := coalesce(v_workspace, public.requesting_workspace_id());
  if v_workspace is null then
    raise exception 'Workspace identity required' using errcode = '23514';
  end if;
  new.workspace_id := v_workspace;
  return new;
end $$;
revoke all on function public.set_record_workspace() from public, anon, authenticated;
do $$
declare t text;
begin
  for t in select tablename from pg_policies where policyname = 'workspace_boundary'
    and schemaname = 'public'
  loop
    execute format('create trigger record_workspace_write before insert or update on public.%I
      for each row execute function public.set_record_workspace()', t);
  end loop;
end $$;
-- Alphabetical trigger order runs this after people_workspace_write stamps
-- ownership. Previous employers are references just like current employers.
create function public.check_detached_workspace() returns trigger
language plpgsql set search_path = '' as $$
declare parent_workspace uuid;
begin
  if public.hosted_mode() and new.affiliation_detached_from is not null then
    select workspace_id into parent_workspace from public.organizations
      where id = new.affiliation_detached_from for key share;
    if parent_workspace is null or parent_workspace is distinct from new.workspace_id then
      raise exception 'Previous employer belongs to another workspace' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger zz_detached_workspace before insert or update on public.people
  for each row execute function public.check_detached_workspace();
commit;
