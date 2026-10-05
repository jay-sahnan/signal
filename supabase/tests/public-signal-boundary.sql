\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('public_signal_a');
select public.ensure_workspace('public_signal_b');
update public.deployment_settings set hosted_enabled = true;
insert into public.user_profile(user_id) values ('public_signal_a') returning id as owner_profile \gset
insert into public.signals(name, slug, description, created_by, is_public) values
  ('Shared recipe', 'shared-public-recipe', 'opt-in', :'owner_profile', true) returning id as shared \gset
insert into public.signals(name, slug, description, created_by) values
  ('Private recipe', 'private-recipe', 'private', :'owner_profile');
reset role;
select set_config('request.jwt.claims', '{"sub":"public_signal_b"}', true);
select set_config('test.shared_signal', :'shared', true);
set local role authenticated;
do $$ declare changed integer; begin
  if (select count(*) from public.signals where slug = 'shared-public-recipe') <> 1 then
    raise exception 'explicitly public signal is not visible';
  end if;
  if exists(select from public.signals where slug = 'private-recipe') then
    raise exception 'private signal leaked';
  end if;
  update public.signals set description = 'foreign edit' where id = current_setting('test.shared_signal')::uuid;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'public visibility allowed foreign edit'; end if;
  delete from public.signals where id = current_setting('test.shared_signal')::uuid;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'public visibility allowed foreign deletion'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"public_signal_a"}', true);
set local role authenticated;
update public.signals set is_public = false where id = :'shared';
reset role;
select set_config('request.jwt.claims', '{"sub":"public_signal_b"}', true);
set local role authenticated;
do $$ begin
  if exists(select from public.signals where slug = 'shared-public-recipe') then
    raise exception 'revoked sharing still visible';
  end if;
end $$;
rollback;
