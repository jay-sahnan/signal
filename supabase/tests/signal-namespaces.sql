\set ON_ERROR_STOP on
begin;
set local role service_role;
select public.ensure_workspace('slug_a');
select public.ensure_workspace('slug_b');
update public.deployment_settings set hosted_enabled = true;
insert into public.user_profile(user_id) values ('slug_a') returning id as a \gset
insert into public.user_profile(user_id) values ('slug_b') returning id as b \gset
insert into public.signals(name, slug, description, created_by) values
  ('A recipe', 'shared-customer-slug', 'private', :'a'),
  ('B recipe', 'shared-customer-slug', 'private', :'b');
insert into public.signals(name, slug, description, created_by)
  values ('Customer pricing', 'pricing-changes', 'private', :'a');
reset role;
select set_config('request.jwt.claims', '{"sub":"slug_a"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.signals where slug = 'pricing-changes') <> 2 then
    raise exception 'custom signal cannot coexist with built-in';
  end if;
  if (select count(*) from public.signals where slug = 'pricing-changes' and is_builtin) <> 1 then
    raise exception 'built-in lookup is ambiguous';
  end if;
  if (select count(*) from public.signals where slug = 'shared-customer-slug') <> 1 then
    raise exception 'signal namespace isolation failed';
  end if;
  begin
    insert into public.signals(name, slug, description, created_by)
      select name, slug, description, created_by from public.signals where slug = 'shared-customer-slug';
    raise exception 'same-workspace signal duplicate accepted';
  exception when unique_violation then null;
  end;
end $$;
rollback;
