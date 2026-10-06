-- Phase 4 RPC tests. Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'ann@rpc.test', '{"full_name":"Ann"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'ben@rpc.test', '{"full_name":"Ben"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'cal@rpc.test', '{"full_name":"Cal"}'),
  ('00000000-0000-0000-0000-0000000000f1', 'zed@rpc.test', '{"full_name":"Zed"}');

create or replace function pg_temp.login(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

create temp table ids (k text primary key, v uuid);
create temp table tokens (k text primary key, v text);
grant all on ids, tokens to authenticated;

-- ------------------------------------------------------------------ friends
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.send_friend_request('BEN@rpc.test'), 'requested', 'friend request by email (case-insensitive)');
select is(public.send_friend_request('ben@rpc.test'), 'already_requested', 'duplicate request is detected');
select is(public.send_friend_request('nobody@rpc.test'), 'not_found', 'unknown email');
select is(public.send_friend_request('ann@rpc.test'), 'self', 'cannot friend yourself');

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select lives_ok(
  $$ select public.respond_friend_request(
       (select id from public.friendships where addressee_id = '00000000-0000-0000-0000-0000000000b1'), true) $$,
  'addressee accepts');
select is((select status::text from public.friendships), 'accepted', 'friendship accepted');

-- ------------------------------------------------------------------- groups
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into ids values ('g', public.create_group('Lisbon', 'trip', 'EUR', true));
select is((select count(*)::int from public.group_members where group_id = (select v from ids where k = 'g')), 1,
  'creator becomes a member');
select is((select role::text from public.group_members where group_id = (select v from ids where k = 'g')), 'owner',
  'creator is owner');

select is(public.add_group_member((select v from ids where k = 'g'), 'cal@rpc.test', null) ->> 'status', 'added',
  'add registered user by email');
select ok(private.is_friend('00000000-0000-0000-0000-0000000000c1'), 'group members become friends');
select is(public.add_group_member((select v from ids where k = 'g'), 'cal@rpc.test', null) ->> 'status', 'already_member',
  'adding twice is idempotent');
select is(public.add_group_member((select v from ids where k = 'g'), 'dee@rpc.test', null) ->> 'status', 'invited',
  'unknown email becomes an invited placeholder');
insert into ids values ('eve', (public.add_group_member((select v from ids where k = 'g'), null, 'Eve') ->> 'member_id')::uuid);
select is((select placeholder_name from public.group_members where id = (select v from ids where k = 'eve')), 'Eve',
  'named placeholder');

-- Signing up with an invited email claims the placeholder.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'Dee@rpc.test');
select is(
  (select user_id from public.group_members where lower(placeholder_email) = 'dee@rpc.test'),
  '00000000-0000-0000-0000-0000000000d1'::uuid, 'new user claims email placeholder');

-- Invite link: Ben joins by claiming the Eve placeholder.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into public.invite_links (created_by, group_id) values ('00000000-0000-0000-0000-0000000000a1', (select v from ids where k = 'g'));
insert into tokens select 'invite', token from public.invite_links;
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is((public.get_invite((select v from tokens)) -> 'placeholders' -> 0 ->> 'name'), 'Eve',
  'invite lists unclaimed placeholders');
select is(public.redeem_invite((select v from tokens), (select v from ids where k = 'eve')),
  (select v from ids where k = 'g'), 'redeem invite claiming a placeholder');
select is((select user_id from public.group_members where id = (select v from ids where k = 'eve')),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'placeholder now belongs to Ben');
select is((public.get_invite('nope') ->> 'valid')::boolean, false, 'bad token is invalid');
select is((public.get_invite((select v from tokens)) ->> 'placeholders'), '[]', 'claimed placeholder is no longer offered');

-- ----------------------------------------------------------------- expenses
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'ann_m', id from public.group_members where user_id = '00000000-0000-0000-0000-0000000000a1';
insert into ids select 'cal_m', id from public.group_members where user_id = '00000000-0000-0000-0000-0000000000c1';

insert into ids values ('e', public.save_expense(jsonb_build_object(
  'group_id', (select v from ids where k = 'g'), 'description', 'Dinner', 'currency', 'EUR',
  'total_minor', 9000, 'split_type', 'equal',
  'payers', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'amount', 9000)),
  'shares', jsonb_build_array(
    jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'amount', 3000),
    jsonb_build_object('member_id', (select v from ids where k = 'cal_m'), 'amount', 3000),
    jsonb_build_object('member_id', (select v from ids where k = 'eve'), 'amount', 3000))
)));
select is((select count(*)::int from public.expense_shares where expense_id = (select v from ids where k = 'e')), 3,
  'expense saved with shares');
select is((select action::text from public.activity_log where expense_id = (select v from ids where k = 'e')),
  'expense_created', 'creation logged');

select throws_ok($$ select public.save_expense(jsonb_build_object(
  'group_id', (select v from ids where k = 'g'), 'description', 'Bad', 'currency', 'EUR', 'total_minor', 100, 'split_type', 'equal',
  'payers', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'amount', 100)),
  'shares', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'amount', 99)))) $$,
  'P0001', 'The split must add up to the total.', 'shares must sum to total');

select throws_ok($$ select public.save_expense(jsonb_build_object(
  'group_id', (select v from ids where k = 'g'), 'description', 'Bad', 'currency', 'EUR', 'total_minor', 100, 'split_type', 'exact',
  'payers', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'amount', 100)),
  'shares', jsonb_build_array(
    jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'amount', 150),
    jsonb_build_object('member_id', (select v from ids where k = 'cal_m'), 'amount', -50)))) $$,
  'P0001', 'The split must add up to the total.', 'share signs must match the total');

-- Edit keeps history.
select lives_ok($$ select public.save_expense(jsonb_build_object(
  'id', (select v from ids where k = 'e'), 'group_id', (select v from ids where k = 'g'), 'description', 'Dinner + wine',
  'currency', 'EUR', 'total_minor', 6000, 'split_type', 'equal',
  'payers', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'amount', 6000)),
  'shares', jsonb_build_array(
    jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'amount', 3000),
    jsonb_build_object('member_id', (select v from ids where k = 'cal_m'), 'amount', 3000)))) $$, 'edit expense');
select is((select payload -> 'before' ->> 'total_minor' from public.activity_log
           where expense_id = (select v from ids where k = 'e') and action = 'expense_updated'), '9000',
  'edit history stores the previous version');
select is((select count(*)::int from public.expense_shares where expense_id = (select v from ids where k = 'e')), 2,
  'edit replaces shares');

-- Itemized: fractional quantities are stored; unassigned items are rejected server-side.
insert into ids values ('market', public.save_expense(jsonb_build_object(
  'group_id', (select v from ids where k = 'g'), 'description', 'Market', 'currency', 'EUR', 'total_minor', 135, 'split_type', 'itemized',
  'payers', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'amount', 135)),
  'shares', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'amount', 135)),
  'items', jsonb_build_array(jsonb_build_object('kind', 'item', 'name', 'Apples', 'quantity', '0.452', 'unit_price_minor', 299, 'amount', 135,
    'assignments', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'weight', 1)))))));
select is((select quantity from public.expense_items where expense_id = (select v from ids where k = 'market')), 0.452::numeric,
  'fractional item quantity stored');
select throws_ok($$ select public.save_expense(jsonb_build_object(
  'group_id', (select v from ids where k = 'g'), 'description', 'Market', 'currency', 'EUR', 'total_minor', 135, 'split_type', 'itemized',
  'payers', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'amount', 135)),
  'shares', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'ann_m'), 'amount', 135)),
  'items', jsonb_build_array(jsonb_build_object('kind', 'item', 'name', 'Apples', 'amount', 135, 'assignments', '[]'::jsonb)))) $$,
  'P0001', 'Assign every item to at least one person.', 'unassigned items rejected');

-- Soft delete + undo.
select lives_ok($$ select public.set_expense_deleted((select v from ids where k = 'e'), true) $$, 'soft delete');
select is((select is_deleted from public.expenses where id = (select v from ids where k = 'e')), true, 'marked deleted');
select lives_ok($$ select public.set_expense_deleted((select v from ids where k = 'e'), false) $$, 'undo delete');

-- Friend-only expenses: participants must be friends.
select throws_ok($$ select public.save_expense(jsonb_build_object(
  'description', 'Taxi', 'currency', 'USD', 'total_minor', 1000, 'split_type', 'equal',
  'payers', jsonb_build_array(jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000a1', 'amount', 1000)),
  'shares', jsonb_build_array(jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000a1', 'amount', 500),
                              jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000f1', 'amount', 500)))) $$,
  'P0001', 'You can only add friends to an expense outside a group.', 'non-friends rejected');

-- Leaving the group revokes access.
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.remove_group_member((select v from ids where k = 'cal_m')) $$, 'member leaves');
select is((select count(*)::int from public.expenses), 0, 'former member no longer sees group expenses');

select * from finish();
rollback;
