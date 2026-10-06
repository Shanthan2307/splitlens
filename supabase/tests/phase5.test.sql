-- Phase 5: settlements, comments, activity. Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000005a1', 'amy@p5.test', '{"full_name":"Amy"}'),
  ('00000000-0000-0000-0000-0000000005b1', 'bo@p5.test',  '{"full_name":"Bo"}'),
  ('00000000-0000-0000-0000-0000000005c1', 'cy@p5.test',  '{"full_name":"Cy"}');

create or replace function pg_temp.login(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

select pg_temp.login('00000000-0000-0000-0000-0000000005a1');
insert into ids values ('g', public.create_group('Flat', 'home', 'GBP', false));
select public.add_group_member((select v from ids where k = 'g'), 'bo@p5.test', null);
insert into ids select 'amy_m', id from public.group_members where user_id = '00000000-0000-0000-0000-0000000005a1';
insert into ids select 'bo_m', id from public.group_members where user_id = '00000000-0000-0000-0000-0000000005b1';

-- Group settlement.
insert into ids values ('s', public.save_settlement(jsonb_build_object(
  'group_id', (select v from ids where k = 'g'), 'from_member_id', (select v from ids where k = 'bo_m'),
  'to_member_id', (select v from ids where k = 'amy_m'), 'amount_minor', 2500, 'currency', 'GBP',
  'method', 'external_app', 'external_provider', 'paypal')));
select is((select amount_minor from public.settlements where id = (select v from ids where k = 's')), 2500::bigint,
  'group settlement saved');
select is((select external_provider from public.settlements where id = (select v from ids where k = 's')), 'paypal',
  'external provider stored');
select is((select payload -> 'after' -> 'from' ->> 'name' from public.activity_log
           where settlement_id = (select v from ids where k = 's') and action = 'settlement_created'), 'Bo',
  'settlement activity has names');

select throws_ok($$ select public.save_settlement(jsonb_build_object(
  'group_id', (select v from ids where k = 'g'), 'from_member_id', (select v from ids where k = 'bo_m'),
  'to_member_id', (select v from ids where k = 'bo_m'), 'amount_minor', 100, 'currency', 'GBP')) $$,
  'P0001', 'Someone can''t pay themselves.', 'cannot pay yourself');
select throws_ok($$ select public.save_settlement(jsonb_build_object(
  'group_id', (select v from ids where k = 'g'), 'from_member_id', (select v from ids where k = 'bo_m'),
  'to_member_id', (select v from ids where k = 'amy_m'), 'amount_minor', 0, 'currency', 'GBP')) $$,
  'P0001', 'The payment amount must be more than zero.', 'amount must be positive');
select throws_ok($$ insert into public.settlements (group_id, from_member_id, to_member_id, amount_minor, currency, created_by)
  values ((select v from ids where k = 'g'), (select v from ids where k = 'bo_m'), (select v from ids where k = 'amy_m'),
          1, 'GBP', '00000000-0000-0000-0000-0000000005a1') $$,
  '42501', null, 'direct settlement inserts are blocked');

-- Edit, delete, restore.
select lives_ok($$ select public.save_settlement(jsonb_build_object(
  'id', (select v from ids where k = 's'), 'group_id', (select v from ids where k = 'g'),
  'from_member_id', (select v from ids where k = 'bo_m'), 'to_member_id', (select v from ids where k = 'amy_m'),
  'amount_minor', 3000, 'currency', 'GBP', 'method', 'cash', 'external_provider', 'paypal')) $$, 'edit settlement');
select is((select external_provider from public.settlements where id = (select v from ids where k = 's')), null,
  'provider cleared for cash');
select lives_ok($$ select public.set_settlement_deleted((select v from ids where k = 's'), true) $$, 'delete settlement');
select lives_ok($$ select public.set_settlement_deleted((select v from ids where k = 's'), false) $$, 'restore settlement');

-- Friend-only settlement: must involve me and a friend.
select throws_ok($$ select public.save_settlement(jsonb_build_object(
  'from_user_id', '00000000-0000-0000-0000-0000000005c1', 'to_user_id', '00000000-0000-0000-0000-0000000005a1',
  'amount_minor', 500, 'currency', 'USD')) $$,
  'P0001', 'You can only record payments with friends.', 'non-friend payment rejected');
select lives_ok($$ select public.save_settlement(jsonb_build_object(
  'from_user_id', '00000000-0000-0000-0000-0000000005b1', 'to_user_id', '00000000-0000-0000-0000-0000000005a1',
  'amount_minor', 500, 'currency', 'USD')) $$, 'friend payment allowed');

-- Comments.
insert into ids values ('c', public.add_comment(null, (select v from ids where k = 's'), '  Thanks!  '));
select is((select body from public.comments where id = (select v from ids where k = 'c')), 'Thanks!', 'comment trimmed and saved');
select is((select action::text from public.activity_log where comment_id = (select v from ids where k = 'c')), 'comment_added',
  'comment logged');
select throws_ok($$ select public.add_comment(null, (select v from ids where k = 's'), '   ') $$,
  'P0001', 'Write a comment first.', 'empty comment rejected');

select pg_temp.login('00000000-0000-0000-0000-0000000005b1');
select throws_ok($$ select public.delete_comment((select v from ids where k = 'c')) $$,
  'P0001', 'You can only delete your own comments.', 'cannot delete others'' comments');

-- Receipt links: an inaccessible receipt id is dropped; an own receipt is linked and shared with the group.
select pg_temp.login('00000000-0000-0000-0000-0000000005a1');
insert into public.receipts (id, uploaded_by, storage_path, mime_type)
values ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005a1/r.jpg', 'image/jpeg');
create or replace function pg_temp.expense_with_receipt(p_receipt uuid) returns uuid language sql as $$
  select public.save_expense(jsonb_build_object(
    'group_id', (select v from ids where k = 'g'), 'description', 'Groceries', 'currency', 'GBP', 'total_minor', 1000,
    'split_type', 'equal', 'receipt_id', p_receipt,
    'payers', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'amy_m'), 'amount', 1000)),
    'shares', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = 'amy_m'), 'amount', 1000))));
$$;
insert into ids values ('e_unknown', pg_temp.expense_with_receipt(gen_random_uuid()));
insert into ids values ('e_own', pg_temp.expense_with_receipt('00000000-0000-0000-0000-0000000005e1'));
select is((select receipt_id from public.expenses where id = (select v from ids where k = 'e_unknown')), null,
  'unknown receipt id is dropped instead of failing the save');
select is((select receipt_id from public.expenses where id = (select v from ids where k = 'e_own')),
  '00000000-0000-0000-0000-0000000005e1'::uuid, 'own receipt is linked');
select is((select group_id from public.receipts where id = '00000000-0000-0000-0000-0000000005e1'),
  (select v from ids where k = 'g'), 'linked receipt is shared with the group');


select pg_temp.login('00000000-0000-0000-0000-0000000005c1');
select is((select count(*)::int from public.settlements), 0, 'non-member sees no settlements');

select * from finish();
rollback;
