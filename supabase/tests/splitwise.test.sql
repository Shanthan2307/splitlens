-- Splitwise integration RPCs (service-role only). Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000005a1', 'sam@sw.test', '{"full_name":"Sam"}'),
  ('00000000-0000-0000-0000-0000000005b1', 'tia@sw.test', '{"full_name":"Tia"}');

create or replace function pg_temp.login(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', '', true);
$$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;

-- Sam's group has a placeholder that was imported for Splitwise user 501 (Tia).
select pg_temp.login('00000000-0000-0000-0000-0000000005a1');
insert into ids values ('g', public.create_group('Flat', 'home', 'USD', true));
reset role;
insert into public.group_members (group_id, placeholder_name, splitwise_user_id)
  select v, 'Tia (Splitwise)', 501 from ids where k = 'g';
insert into ids select 'ph', id from public.group_members where splitwise_user_id = 501;

-- ----- clients can't call the service-role RPCs
select pg_temp.login('00000000-0000-0000-0000-0000000005b1');
select throws_ok($$ select public.splitwise_link_account('00000000-0000-0000-0000-0000000005b1', 501) $$,
  '42501', null, 'users cannot link a Splitwise id themselves');

-- ----- linking (as the server, after OAuth)
set local role service_role;
select is(public.splitwise_link_account('00000000-0000-0000-0000-0000000005b1', 501), 1, 'linking claims the placeholder');
reset role;
select is((select user_id from public.group_members where id = (select v from ids where k = 'ph')),
  '00000000-0000-0000-0000-0000000005b1'::uuid, 'placeholder now belongs to Tia');
select is((select splitwise_user_id from public.profiles where id = '00000000-0000-0000-0000-0000000005b1'), 501::bigint,
  'verified Splitwise id stored on the profile');
select ok(exists (select 1 from public.friendships where status = 'accepted'
  and '00000000-0000-0000-0000-0000000005b1' in (requester_id, addressee_id)), 'claiming befriends the group');
select is((select actor_id from public.activity_log where action = 'placeholder_claimed' order by id desc limit 1),
  '00000000-0000-0000-0000-0000000005b1'::uuid, 'activity is attributed to the impersonated user');

set local role service_role;
select throws_ok($$ select public.splitwise_link_account('00000000-0000-0000-0000-0000000005a1', 501) $$,
  'P0001', 'This Splitwise account is already connected to another SplitLens account.', 'one SplitLens account per Splitwise account');
select public.splitwise_unlink_account('00000000-0000-0000-0000-0000000005b1');
reset role;
select is((select splitwise_user_id from public.profiles where id = '00000000-0000-0000-0000-0000000005b1'), null,
  'unlinking clears the Splitwise id');

select * from finish();
rollback;
