-- RLS + privilege tests. Run with `npm run test:db` (local stack must be running).
-- Fixtures are created through the same RPCs the app uses; direct writes that bypass
-- them must be denied.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- Fixtures: three users. The auth trigger creates their profiles.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@test.local', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test.local',   '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@test.local', '{}');

select is((select count(*)::int from public.profiles where email like '%@test.local'), 3, 'auth trigger creates profiles');
select is((select display_name from public.profiles where email = 'bob@test.local'), 'bob', 'display name falls back to email local part');
select is((select count(*)::int from public.notification_settings n join public.profiles p on p.id = n.user_id where p.email like '%@test.local'), 3,
  'auth trigger creates notification settings');
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity), 0,
  'every public table has RLS enabled');
select is(
  (select count(*)::int from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'), 0,
  'anon has no privileges on any public table');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee in ('anon', 'authenticated') and table_schema = 'public' and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')), 0,
  'no TRUNCATE/TRIGGER/REFERENCES for API roles');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef and n.nspname in ('public', 'private') and not coalesce(p.proconfig, '{}') @> array['search_path=""']), 0,
  'every SECURITY DEFINER function pins search_path');

create or replace function pg_temp.login(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

-- Alice creates a group with a placeholder member and a group expense.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into ids values ('g', public.create_group('Trip', 'trip', 'EUR', true));
insert into ids select 'alice_m', id from public.group_members where user_id = '00000000-0000-0000-0000-00000000000a';
insert into ids values ('dave_m', (public.add_group_member((select v from ids where k = 'g'), null, 'Dave (no account)') ->> 'member_id')::uuid);
insert into ids values ('dinner', public.save_expense(jsonb_build_object(
  'group_id', (select v from ids where k = 'g'), 'description', 'Dinner', 'currency', 'EUR', 'total_minor', 5000, 'split_type', 'equal',
  'payers', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'alice_m'), 'amount', 5000)),
  'shares', jsonb_build_array(
    jsonb_build_object('member_id', (select v from ids where k = 'alice_m'), 'amount', 2500),
    jsonb_build_object('member_id', (select v from ids where k = 'dave_m'), 'amount', 2500)))));
select is((select count(*)::int from public.groups), 1, 'creator sees own group');
select is((select count(*)::int from public.expense_shares), 2, 'member sees group expense shares');

-- Alice adds Bob to the group, and asks Carol to be friends.
select public.add_group_member((select v from ids where k = 'g'), 'bob@test.local', null);
select is(public.send_friend_request('carol@test.local'), 'requested', 'friend request sent');

-- ----- direct writes that bypass the RPCs are denied
select throws_ok($$ insert into public.expenses (group_id, description, currency, total_minor, created_by)
  values ((select v from ids where k = 'g'), 'x', 'EUR', 1, '00000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'expenses cannot be inserted directly');
select throws_ok($$ update public.expenses set total_minor = 1 where id = (select v from ids where k = 'dinner') $$,
  '42501', null, 'expense totals cannot be edited directly');
select throws_ok($$ update public.expense_shares set owed_minor = 0 where expense_id = (select v from ids where k = 'dinner') $$,
  '42501', null, 'shares cannot be edited directly');
select throws_ok($$ delete from public.expense_payers where expense_id = (select v from ids where k = 'dinner') $$,
  '42501', null, 'payers cannot be deleted directly');
select throws_ok($$ insert into public.item_assignments (item_id, member_id) values (gen_random_uuid(), gen_random_uuid()) $$,
  '42501', null, 'item assignments cannot be written directly');
select throws_ok($$ delete from public.groups where id = (select v from ids where k = 'g') $$,
  '42501', null, 'groups cannot be hard-deleted (would cascade away history)');
select throws_ok($$ update public.group_members set user_id = '00000000-0000-0000-0000-00000000000a' where id = (select v from ids where k = 'dave_m') $$,
  '42501', null, 'members cannot claim placeholders directly');
select throws_ok($$ delete from public.group_members where id = (select v from ids where k = 'dave_m') $$,
  '42501', null, 'members cannot be removed directly (skips balance check)');
select throws_ok($$ insert into public.friendships (requester_id, addressee_id) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'friend requests go through the RPC');
select throws_ok($$ insert into public.activity_log (actor_id, action) values ('00000000-0000-0000-0000-00000000000a', 'group_created') $$,
  '42501', null, 'activity cannot be forged');
select throws_ok($$ truncate public.comments $$, '42501', null, 'truncate is denied');
select throws_ok(
  $$ update public.profiles set splitwise_user_id = 1 where id = '00000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'users cannot set protected profile columns');
update public.profiles set display_name = 'Hacked' where id = '00000000-0000-0000-0000-00000000000b';
select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b'), 'bob',
  'users cannot update other profiles');

-- ----- Bob: group member.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.groups), 1, 'added member sees the group');
select is((select count(*)::int from public.expenses), 1, 'member sees the group expense');
select is((select count(*)::int from public.profiles), 2, 'sees self and registered co-members only');

-- ----- Carol: friend-request recipient, not in the group.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.groups), 0, 'non-member sees no groups');
select is((select count(*)::int from public.group_members), 0, 'non-member sees no group members');
select is((select count(*)::int from public.expenses), 0, 'non-member sees no group expenses');
select is((select count(*)::int from public.profiles), 2, 'pending friendship makes profiles visible');
select lives_ok($$ select public.respond_friend_request((select id from public.friendships), true) $$, 'addressee accepts via RPC');

-- Splitwise tokens never readable by users.
reset role;
insert into public.splitwise_connections (user_id, splitwise_user_id, access_token_encrypted) values
  ('00000000-0000-0000-0000-00000000000c', 42, 'ciphertext');
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok($$ select access_token_encrypted from public.splitwise_connections $$,
  '42501', null, 'user cannot read encrypted tokens');

-- Anonymous sees nothing.
select set_config('role', 'anon', true);
select throws_ok($$ select * from public.expenses $$, '42501', null, 'anon has no table access');
reset role;

select * from finish();
rollback;
