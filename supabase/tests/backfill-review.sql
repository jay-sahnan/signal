\set ON_ERROR_STOP on
begin;
set local role service_role;
insert into public.organizations(name) values ('Unattributed legacy company');
do $$ begin
  begin
    perform public.assign_legacy_workspace('chosen_owner', array[]::text[]);
    raise exception 'Ownerless data was assigned without explicit confirmation';
  exception when check_violation then null;
  end;
  perform public.assign_legacy_workspace('chosen_owner', array[]::text[], true);
end $$;
rollback;

begin;
set local role service_role;
select public.ensure_workspace('history_owner') as w \gset
insert into public.user_profile(user_id) values ('history_owner');
insert into public.campaigns(name, user_id, workspace_id, updated_at) values
  ('Already assigned', 'history_owner', :'w', '2020-01-01T00:00:00Z'),
  ('Unassigned', 'history_owner', null, '2021-01-01T00:00:00Z');
select public.assign_legacy_workspace('history_owner', array['history_owner'], true);
do $$ begin
  if exists(select 1 from public.campaigns where
    (name = 'Already assigned' and updated_at <> '2020-01-01T00:00:00Z') or
    (name = 'Unassigned' and updated_at <> '2021-01-01T00:00:00Z')) then
    raise exception 'Backfill destroyed modification history';
  end if;
end $$;
-- Timestamp triggers must be restored after the migration.
update public.campaigns set name = 'Edited' where name = 'Already assigned';
do $$ begin
  if exists(select 1 from public.campaigns where name = 'Edited' and updated_at < '2022-01-01') then
    raise exception 'Timestamp trigger was not restored';
  end if;
end $$;
rollback;
