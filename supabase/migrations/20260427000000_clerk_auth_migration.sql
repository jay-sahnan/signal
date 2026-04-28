-- Clerk auth migration
-- 2026-04-27
--
-- Replaces Supabase Auth with Clerk as the identity provider while keeping
-- Supabase as the data layer. RLS policies now read the Clerk user id from
-- the validated JWT's `sub` claim instead of `auth.uid()`. Per-user `user_id`
-- columns become TEXT (Clerk IDs look like "user_2abc…", not UUIDs).
--
-- Side effects (the user accepted these):
--   * All user-owned data in api_usage / chats / user_settings / email_drafts /
--     sent_emails / sequences / campaigns (cascading) / user_profile /
--     email_skill_attachments is wiped — old UUIDs won't map to Clerk IDs.
--   * User-authored email_skills (is_builtin = false) are deleted; the
--     seeded built-ins (user_id IS NULL) survive.
--   * Shared pools — organizations, people, signals, signal_results — are
--     untouched.
--   * The on_auth_user_created trigger and handle_new_user() function are
--     dropped. New-user provisioning is handled lazily in app code (the chat
--     agent + profile page already create a user_profile row on first read).

-- ────────────────────────────────────────────────────────────────────────────
-- Migration safety on hosted DBs: bound how long this can hold ACCESS
-- EXCLUSIVE locks on the truncated tables so a stuck migration aborts
-- cleanly instead of wedging the database behind a long read.
-- ────────────────────────────────────────────────────────────────────────────
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Helper: read the Clerk user id from the validated JWT.
-- `set search_path = ''` blocks schema-shadowing attacks (Supabase lints
-- functions without it). All references inside the body are fully qualified.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.requesting_user_id() returns text
  language sql stable
  set search_path = ''
  as $$ select auth.jwt() ->> 'sub' $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Wipe user-owned data.
-- ────────────────────────────────────────────────────────────────────────────
truncate table
  api_usage,
  chats,
  user_settings,
  email_drafts,
  sent_emails,
  sequences,
  campaigns,
  user_profile,
  email_skill_attachments
restart identity cascade;

delete from email_skills where user_id is not null and is_builtin = false;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Drop the auth.users trigger + function (Clerk replaces signup hook).
-- ────────────────────────────────────────────────────────────────────────────
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Drop FKs to auth.users.
-- ────────────────────────────────────────────────────────────────────────────
alter table campaigns    drop constraint if exists campaigns_user_id_fkey;
alter table chats        drop constraint if exists chats_user_id_fkey;
alter table user_profile drop constraint if exists user_profile_user_id_fkey;
alter table api_usage    drop constraint if exists api_usage_user_id_fkey;
alter table email_skills drop constraint if exists email_skills_user_id_fkey;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Drop every policy that references user_id / scope_id BEFORE we retype
--    those columns. Postgres rejects ALTER COLUMN TYPE on columns that
--    appear in a policy definition, so policy drops have to go first.
-- ────────────────────────────────────────────────────────────────────────────
drop policy if exists "signals_update" on signals;
drop policy if exists "signals_delete" on signals;

drop policy if exists "campaigns_select" on campaigns;
drop policy if exists "campaigns_insert" on campaigns;
drop policy if exists "campaigns_update" on campaigns;
drop policy if exists "campaigns_delete" on campaigns;

drop policy if exists "chats_select" on chats;
drop policy if exists "chats_insert" on chats;
drop policy if exists "chats_update" on chats;
drop policy if exists "chats_delete" on chats;

drop policy if exists "profile_select" on user_profile;
drop policy if exists "profile_insert" on user_profile;
drop policy if exists "profile_update" on user_profile;
drop policy if exists "profile_delete" on user_profile;

drop policy if exists "usage_select" on api_usage;
drop policy if exists "usage_insert" on api_usage;

drop policy if exists "camp_orgs_select" on campaign_organizations;
drop policy if exists "camp_orgs_insert" on campaign_organizations;
drop policy if exists "camp_orgs_update" on campaign_organizations;
drop policy if exists "camp_orgs_delete" on campaign_organizations;

drop policy if exists "camp_people_select" on campaign_people;
drop policy if exists "camp_people_insert" on campaign_people;
drop policy if exists "camp_people_update" on campaign_people;
drop policy if exists "camp_people_delete" on campaign_people;

drop policy if exists "camp_signals_select" on campaign_signals;
drop policy if exists "camp_signals_insert" on campaign_signals;
drop policy if exists "camp_signals_update" on campaign_signals;
drop policy if exists "camp_signals_delete" on campaign_signals;

drop policy if exists "tracking_configs_select" on tracking_configs;
drop policy if exists "tracking_configs_insert" on tracking_configs;
drop policy if exists "tracking_configs_update" on tracking_configs;
drop policy if exists "tracking_configs_delete" on tracking_configs;

drop policy if exists "outreach_select" on outreach_events;
drop policy if exists "outreach_insert" on outreach_events;

drop policy if exists "snapshots_select" on tracking_snapshots;
drop policy if exists "snapshots_insert" on tracking_snapshots;
drop policy if exists "changes_select" on tracking_changes;
drop policy if exists "changes_insert" on tracking_changes;

drop policy if exists "user_settings_select" on user_settings;
drop policy if exists "user_settings_insert" on user_settings;
drop policy if exists "user_settings_update" on user_settings;
drop policy if exists "user_settings_delete" on user_settings;

drop policy if exists "email_drafts_select" on email_drafts;
drop policy if exists "email_drafts_insert" on email_drafts;
drop policy if exists "email_drafts_update" on email_drafts;
drop policy if exists "email_drafts_delete" on email_drafts;

drop policy if exists "sent_emails_select" on sent_emails;
drop policy if exists "sent_emails_insert" on sent_emails;
drop policy if exists "sent_emails_update" on sent_emails;

drop policy if exists "sequences_select" on sequences;
drop policy if exists "sequences_insert" on sequences;
drop policy if exists "sequences_update" on sequences;
drop policy if exists "sequences_delete" on sequences;

drop policy if exists "sequence_steps_select" on sequence_steps;
drop policy if exists "sequence_steps_insert" on sequence_steps;
drop policy if exists "sequence_steps_update" on sequence_steps;
drop policy if exists "sequence_steps_delete" on sequence_steps;

drop policy if exists "enrollments_select" on sequence_enrollments;
drop policy if exists "enrollments_insert" on sequence_enrollments;
drop policy if exists "enrollments_update" on sequence_enrollments;
drop policy if exists "enrollments_delete" on sequence_enrollments;

drop policy if exists "email_skills_select" on email_skills;
drop policy if exists "email_skills_insert" on email_skills;
drop policy if exists "email_skills_update" on email_skills;
drop policy if exists "email_skills_delete" on email_skills;

drop policy if exists "email_skill_attachments_select" on email_skill_attachments;
drop policy if exists "email_skill_attachments_insert" on email_skill_attachments;
drop policy if exists "email_skill_attachments_update" on email_skill_attachments;
drop policy if exists "email_skill_attachments_delete" on email_skill_attachments;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Retype user_id columns: UUID → TEXT.
-- ────────────────────────────────────────────────────────────────────────────
alter table campaigns       alter column user_id type text;
alter table chats           alter column user_id type text;
alter table user_profile    alter column user_id type text;
alter table api_usage       alter column user_id type text;
alter table user_settings   alter column user_id type text;
alter table email_drafts    alter column user_id type text;
alter table sent_emails     alter column user_id type text;
alter table sequences       alter column user_id type text;
alter table email_skills    alter column user_id type text;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Retype email_skill_attachments.scope_id (UUID → TEXT) so it can hold
--    Clerk user IDs alongside cast UUIDs (user_profile.id, campaigns.id).
-- ────────────────────────────────────────────────────────────────────────────
alter table email_skill_attachments alter column scope_id type text;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Recreate every RLS policy using requesting_user_id() in place of
--    auth.uid(). All policies were already dropped in section 5; this
--    section only creates the new ones. For email_skill_attachments,
--    uuid PKs are cast to text on join (scope_id is now text).
-- ────────────────────────────────────────────────────────────────────────────

-- ─── signals (only update / delete reference user_profile) ─────────────────
create policy "signals_update" on signals for update to authenticated
  using (
    is_builtin = false
    and created_by in (
      select id from user_profile where user_id = requesting_user_id()
    )
  );
create policy "signals_delete" on signals for delete to authenticated
  using (
    is_builtin = false
    and created_by in (
      select id from user_profile where user_id = requesting_user_id()
    )
  );

-- ─── campaigns (direct owner) ──────────────────────────────────────────────

create policy "campaigns_select" on campaigns for select to authenticated
  using (requesting_user_id() = user_id);
create policy "campaigns_insert" on campaigns for insert to authenticated
  with check (requesting_user_id() = user_id);
create policy "campaigns_update" on campaigns for update to authenticated
  using (requesting_user_id() = user_id);
create policy "campaigns_delete" on campaigns for delete to authenticated
  using (requesting_user_id() = user_id);

-- ─── chats (direct owner) ──────────────────────────────────────────────────

create policy "chats_select" on chats for select to authenticated
  using (requesting_user_id() = user_id);
create policy "chats_insert" on chats for insert to authenticated
  with check (requesting_user_id() = user_id);
create policy "chats_update" on chats for update to authenticated
  using (requesting_user_id() = user_id);
create policy "chats_delete" on chats for delete to authenticated
  using (requesting_user_id() = user_id);

-- ─── user_profile (direct owner) ───────────────────────────────────────────

create policy "profile_select" on user_profile for select to authenticated
  using (requesting_user_id() = user_id);
create policy "profile_insert" on user_profile for insert to authenticated
  with check (requesting_user_id() = user_id);
create policy "profile_update" on user_profile for update to authenticated
  using (requesting_user_id() = user_id);
create policy "profile_delete" on user_profile for delete to authenticated
  using (requesting_user_id() = user_id);

-- ─── api_usage (direct owner; insert open for system writes) ───────────────

create policy "usage_select" on api_usage for select to authenticated
  using (requesting_user_id() = user_id);
create policy "usage_insert" on api_usage for insert to authenticated
  with check (true);

-- ─── campaign_organizations (transitive via campaigns) ─────────────────────

create policy "camp_orgs_select" on campaign_organizations for select to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "camp_orgs_insert" on campaign_organizations for insert to authenticated
  with check (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "camp_orgs_update" on campaign_organizations for update to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "camp_orgs_delete" on campaign_organizations for delete to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));

-- ─── campaign_people (transitive via campaigns) ────────────────────────────

create policy "camp_people_select" on campaign_people for select to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "camp_people_insert" on campaign_people for insert to authenticated
  with check (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "camp_people_update" on campaign_people for update to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "camp_people_delete" on campaign_people for delete to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));

-- ─── campaign_signals (transitive via campaigns) ───────────────────────────

create policy "camp_signals_select" on campaign_signals for select to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "camp_signals_insert" on campaign_signals for insert to authenticated
  with check (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "camp_signals_update" on campaign_signals for update to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "camp_signals_delete" on campaign_signals for delete to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));

-- ─── tracking_configs (transitive via campaigns) ───────────────────────────

create policy "tracking_configs_select" on tracking_configs for select to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "tracking_configs_insert" on tracking_configs for insert to authenticated
  with check (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "tracking_configs_update" on tracking_configs for update to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "tracking_configs_delete" on tracking_configs for delete to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));

-- ─── outreach_events (transitive via campaigns) ────────────────────────────

create policy "outreach_select" on outreach_events for select to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));
create policy "outreach_insert" on outreach_events for insert to authenticated
  with check (exists (select 1 from campaigns c where c.id = campaign_id and c.user_id = requesting_user_id()));

-- ─── tracking_snapshots (deeply transitive: tracking_configs → campaigns) ──

create policy "snapshots_select" on tracking_snapshots for select to authenticated
  using (
    exists (
      select 1 from tracking_configs tc
      join campaigns c on c.id = tc.campaign_id
      where tc.id = tracking_config_id and c.user_id = requesting_user_id()
    )
  );
create policy "snapshots_insert" on tracking_snapshots for insert to authenticated
  with check (
    exists (
      select 1 from tracking_configs tc
      join campaigns c on c.id = tc.campaign_id
      where tc.id = tracking_config_id and c.user_id = requesting_user_id()
    )
  );

-- ─── tracking_changes (deeply transitive: tracking_configs → campaigns) ────

create policy "changes_select" on tracking_changes for select to authenticated
  using (
    exists (
      select 1 from tracking_configs tc
      join campaigns c on c.id = tc.campaign_id
      where tc.id = tracking_config_id and c.user_id = requesting_user_id()
    )
  );
create policy "changes_insert" on tracking_changes for insert to authenticated
  with check (
    exists (
      select 1 from tracking_configs tc
      join campaigns c on c.id = tc.campaign_id
      where tc.id = tracking_config_id and c.user_id = requesting_user_id()
    )
  );

-- ─── user_settings (direct owner) ──────────────────────────────────────────

create policy "user_settings_select" on user_settings
  for select using (user_id = requesting_user_id());
create policy "user_settings_insert" on user_settings
  for insert with check (user_id = requesting_user_id());
create policy "user_settings_update" on user_settings
  for update using (user_id = requesting_user_id());
create policy "user_settings_delete" on user_settings
  for delete using (user_id = requesting_user_id());

-- ─── email_drafts (direct owner) ───────────────────────────────────────────

create policy "email_drafts_select" on email_drafts
  for select using (user_id = requesting_user_id());
create policy "email_drafts_insert" on email_drafts
  for insert with check (user_id = requesting_user_id());
create policy "email_drafts_update" on email_drafts
  for update using (user_id = requesting_user_id());
create policy "email_drafts_delete" on email_drafts
  for delete using (user_id = requesting_user_id());

-- ─── sent_emails (transitive via campaigns for select; direct for write) ───

create policy "sent_emails_select" on sent_emails
  for select using (
    exists (
      select 1 from campaigns c
      where c.id = sent_emails.campaign_id
        and c.user_id = requesting_user_id()
    )
  );
create policy "sent_emails_insert" on sent_emails
  for insert with check (user_id = requesting_user_id());
create policy "sent_emails_update" on sent_emails
  for update using (user_id = requesting_user_id());

-- ─── sequences (direct owner) ──────────────────────────────────────────────

create policy "sequences_select" on sequences
  for select using (user_id = requesting_user_id());
create policy "sequences_insert" on sequences
  for insert with check (user_id = requesting_user_id());
create policy "sequences_update" on sequences
  for update using (user_id = requesting_user_id());
create policy "sequences_delete" on sequences
  for delete using (user_id = requesting_user_id());

-- ─── sequence_steps (transitive via sequences) ─────────────────────────────

create policy "sequence_steps_select" on sequence_steps
  for select using (
    exists (select 1 from sequences s where s.id = sequence_steps.sequence_id and s.user_id = requesting_user_id())
  );
create policy "sequence_steps_insert" on sequence_steps
  for insert with check (
    exists (select 1 from sequences s where s.id = sequence_steps.sequence_id and s.user_id = requesting_user_id())
  );
create policy "sequence_steps_update" on sequence_steps
  for update using (
    exists (select 1 from sequences s where s.id = sequence_steps.sequence_id and s.user_id = requesting_user_id())
  );
create policy "sequence_steps_delete" on sequence_steps
  for delete using (
    exists (select 1 from sequences s where s.id = sequence_steps.sequence_id and s.user_id = requesting_user_id())
  );

-- ─── sequence_enrollments (transitive via sequences) ───────────────────────

create policy "enrollments_select" on sequence_enrollments
  for select using (
    exists (select 1 from sequences s where s.id = sequence_enrollments.sequence_id and s.user_id = requesting_user_id())
  );
create policy "enrollments_insert" on sequence_enrollments
  for insert with check (
    exists (select 1 from sequences s where s.id = sequence_enrollments.sequence_id and s.user_id = requesting_user_id())
  );
create policy "enrollments_update" on sequence_enrollments
  for update using (
    exists (select 1 from sequences s where s.id = sequence_enrollments.sequence_id and s.user_id = requesting_user_id())
  );
create policy "enrollments_delete" on sequence_enrollments
  for delete using (
    exists (select 1 from sequences s where s.id = sequence_enrollments.sequence_id and s.user_id = requesting_user_id())
  );

-- ─── email_skills (built-ins readable by all; user-authored owner-only) ────

create policy "email_skills_select" on email_skills for select to authenticated
  using (is_builtin = true or user_id = requesting_user_id());
create policy "email_skills_insert" on email_skills for insert to authenticated
  with check (user_id = requesting_user_id() and is_builtin = false);
create policy "email_skills_update" on email_skills for update to authenticated
  using (user_id = requesting_user_id() and is_builtin = false);
create policy "email_skills_delete" on email_skills for delete to authenticated
  using (user_id = requesting_user_id() and is_builtin = false);

-- ─── email_skill_attachments (polymorphic: user / profile / campaign) ──────
-- scope_id is now TEXT. For 'user' scope it equals the Clerk id directly.
-- For 'profile' / 'campaign' scopes, the uuid PKs are cast to text on join.

create policy "email_skill_attachments_select" on email_skill_attachments
  for select to authenticated using (
    (scope_type = 'user' and scope_id = requesting_user_id())
    or (scope_type = 'profile' and exists (
      select 1 from user_profile p where p.id::text = scope_id and p.user_id = requesting_user_id()
    ))
    or (scope_type = 'campaign' and exists (
      select 1 from campaigns c where c.id::text = scope_id and c.user_id = requesting_user_id()
    ))
  );
create policy "email_skill_attachments_insert" on email_skill_attachments
  for insert to authenticated with check (
    (scope_type = 'user' and scope_id = requesting_user_id())
    or (scope_type = 'profile' and exists (
      select 1 from user_profile p where p.id::text = scope_id and p.user_id = requesting_user_id()
    ))
    or (scope_type = 'campaign' and exists (
      select 1 from campaigns c where c.id::text = scope_id and c.user_id = requesting_user_id()
    ))
  );
create policy "email_skill_attachments_update" on email_skill_attachments
  for update to authenticated using (
    (scope_type = 'user' and scope_id = requesting_user_id())
    or (scope_type = 'profile' and exists (
      select 1 from user_profile p where p.id::text = scope_id and p.user_id = requesting_user_id()
    ))
    or (scope_type = 'campaign' and exists (
      select 1 from campaigns c where c.id::text = scope_id and c.user_id = requesting_user_id()
    ))
  );
create policy "email_skill_attachments_delete" on email_skill_attachments
  for delete to authenticated using (
    (scope_type = 'user' and scope_id = requesting_user_id())
    or (scope_type = 'profile' and exists (
      select 1 from user_profile p where p.id::text = scope_id and p.user_id = requesting_user_id()
    ))
    or (scope_type = 'campaign' and exists (
      select 1 from campaigns c where c.id::text = scope_id and c.user_id = requesting_user_id()
    ))
  );
