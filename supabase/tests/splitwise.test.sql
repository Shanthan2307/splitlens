-- Splitwise integration RPCs (service-role only). Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000005a1', 'sam@sw.test', '{"full_name":"Sam"}'),
  ('00000000-0000-0000-0000-0000000005b1', 'tia@sw.test', '{"full_name":"Tia"}'),
  ('00000000-0000-0000-0000-0000000005c1', 'uma@sw.test', '{"full_name":"Uma"}');

create or replace function pg_temp.login(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', '', true);
$$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;

-- Sam's group has a placeholder that was imported for Splitwise user 99501 (Tia).
select pg_temp.login('00000000-0000-0000-0000-0000000005a1');
insert into ids values ('g', public.create_group('Flat', 'home', 'USD', true));
reset role;
insert into public.group_members (group_id, placeholder_name, splitwise_user_id)
  select v, 'Tia (Splitwise)', 99501 from ids where k = 'g';
insert into ids select 'ph', id from public.group_members where splitwise_user_id = 99501;

-- ----- clients can't call the service-role RPCs
select pg_temp.login('00000000-0000-0000-0000-0000000005b1');
select throws_ok($$ select public.splitwise_link_account('00000000-0000-0000-0000-0000000005b1', 99501) $$,
  '42501', null, 'users cannot link a Splitwise id themselves');

-- ----- linking (as the server, after OAuth)
set local role service_role;
select is(public.splitwise_link_account('00000000-0000-0000-0000-0000000005b1', 99501), 1, 'linking claims the placeholder');
reset role;
select is((select user_id from public.group_members where id = (select v from ids where k = 'ph')),
  '00000000-0000-0000-0000-0000000005b1'::uuid, 'placeholder now belongs to Tia');
select is((select splitwise_user_id from public.profiles where id = '00000000-0000-0000-0000-0000000005b1'), 99501::bigint,
  'verified Splitwise id stored on the profile');
select ok(exists (select 1 from public.friendships where status = 'accepted'
  and '00000000-0000-0000-0000-0000000005b1' in (requester_id, addressee_id)), 'claiming befriends the group');
select is((select actor_id from public.activity_log where action = 'placeholder_claimed' order by id desc limit 1),
  '00000000-0000-0000-0000-0000000005b1'::uuid, 'activity is attributed to the impersonated user');

set local role service_role;
select throws_ok($$ select public.splitwise_link_account('00000000-0000-0000-0000-0000000005a1', 99501) $$,
  'P0001', 'This Splitwise account is already connected to another SplitLens account.', 'one SplitLens account per Splitwise account');
select public.splitwise_unlink_account('00000000-0000-0000-0000-0000000005b1');
reset role;
select is((select splitwise_user_id from public.profiles where id = '00000000-0000-0000-0000-0000000005b1'), null,
  'unlinking clears the Splitwise id');

-- ================================================================== import
-- Sam (Splitwise 99500) imports Splitwise group 999001: Sam, Uma (registered, matched by email),
-- Vic (not on SplitLens) and Tia (Splitwise 99501, linked again below).
set local role service_role;
select public.splitwise_link_account('00000000-0000-0000-0000-0000000005a1', 99500);
select public.splitwise_link_account('00000000-0000-0000-0000-0000000005b1', 99501);
select throws_ok($$ select public.splitwise_import_group('00000000-0000-0000-0000-0000000005c1', '{"splitwise_group_id": 1}') $$,
  'P0001', 'Connect Splitwise first.', 'importing needs a linked account');
insert into ids values ('trip', (public.splitwise_import_group('00000000-0000-0000-0000-0000000005a1', '{
  "splitwise_group_id": 999001, "name": "Lisbon", "type": "trip", "simplify": true, "currency": "EUR",
  "members": [
    {"splitwise_user_id": 99500, "name": "Sam", "email": "sam@sw.test"},
    {"splitwise_user_id": 99502, "name": "Uma", "email": "UMA@sw.test"},
    {"splitwise_user_id": 99503, "name": "Vic", "email": "vic@elsewhere.test"},
    {"splitwise_user_id": 99501, "name": "Tia", "email": "tia-old@sw.test"}
  ]}') ->> 'group_id')::uuid);
reset role;
select is((select count(*)::int from public.group_members where group_id = (select v from ids where k = 'trip')), 4, 'group imported with 4 members');
select is((select role::text from public.group_members where group_id = (select v from ids where k = 'trip')
  and user_id = '00000000-0000-0000-0000-0000000005a1'), 'owner', 'importer owns the new group');
select is((select user_id from public.group_members where group_id = (select v from ids where k = 'trip') and splitwise_user_id = 99502),
  '00000000-0000-0000-0000-0000000005c1'::uuid, 'registered user matched by email');
select is((select user_id from public.group_members where group_id = (select v from ids where k = 'trip') and splitwise_user_id = 99501),
  '00000000-0000-0000-0000-0000000005b1'::uuid, 'linked Splitwise id wins over a different email');
select is((select placeholder_email from public.group_members where group_id = (select v from ids where k = 'trip') and splitwise_user_id = 99503),
  'vic@elsewhere.test', 'someone not on SplitLens becomes an email placeholder');

-- Re-import by another member reuses the same group and adds nobody.
set local role service_role;
select is((public.splitwise_import_group('00000000-0000-0000-0000-0000000005b1', '{
  "splitwise_group_id": 999001, "name": "Lisbon!", "members": [{"splitwise_user_id": 99503, "name": "Vic", "email": "vic@elsewhere.test"}]}') ->> 'group_id')::uuid,
  (select v from ids where k = 'trip'), 're-import maps to the same group');
reset role;
select is((select count(*)::int from public.group_members where group_id = (select v from ids where k = 'trip')), 4, 're-import adds no duplicates');

-- ----- expenses
create temp table page (j jsonb);
grant all on page to service_role;
insert into page values ('[
  {"splitwise_expense_id": 70001, "description": "Dinner", "date": "2026-09-01", "currency": "EUR", "total_minor": 9000,
   "created_at": "2026-09-01T20:00:00Z", "notes": "tasca",
   "payers": [{"splitwise_user_id": 99500, "amount": 9000}],
   "shares": [{"splitwise_user_id": 99500, "amount": 3000}, {"splitwise_user_id": 99502, "amount": 3000}, {"splitwise_user_id": 99504, "amount": 3000}],
   "comments": [{"splitwise_comment_id": 81, "splitwise_user_id": 99500, "body": "great", "created_at": "2026-09-02T10:00:00Z"},
                {"splitwise_comment_id": 82, "splitwise_user_id": 99503, "author_name": "Vic", "body": "yum"}]},
  {"splitwise_expense_id": 70002, "description": "Payback", "payment": true, "date": "2026-09-03", "currency": "EUR", "total_minor": 3000,
   "payers": [{"splitwise_user_id": 99502, "amount": 3000}], "shares": [{"splitwise_user_id": 99500, "amount": 3000}]},
  {"splitwise_expense_id": 70003, "description": "Gone", "deleted": true, "currency": "EUR", "total_minor": 100,
   "payers": [{"splitwise_user_id": 99500, "amount": 100}], "shares": [{"splitwise_user_id": 99500, "amount": 100}]},
  {"splitwise_expense_id": 70004, "description": "Bad sums", "currency": "EUR", "total_minor": 100,
   "payers": [{"splitwise_user_id": 99500, "amount": 100}], "shares": [{"splitwise_user_id": 99500, "amount": 99}]}
]');
set local role service_role;
select is(public.splitwise_import_expenses('00000000-0000-0000-0000-0000000005a1', (select v from ids where k = 'trip'),
  '[{"splitwise_user_id": 99504, "name": "Wes (left)"}]', (select j from page)),
  '{"created": 1, "payments": 1, "existing": 0, "deleted": 0, "skipped": 2, "comments": 2, "unresolved": []}'::jsonb,
  'first import: expense + payment, deleted and inconsistent ones skipped');
select is(public.splitwise_import_expenses('00000000-0000-0000-0000-0000000005a1', (select v from ids where k = 'trip'),
  '[]', (select j from page)) ->> 'existing', '2', 're-running finds both as existing');
reset role;
select is((select count(*)::int from public.expenses where splitwise_expense_id = 70001), 1, 'no duplicate expenses');
select is((select count(*)::int from public.comments where expense_id = (select id from public.expenses where splitwise_expense_id = 70001)), 2,
  'no duplicate comments');
select is((select sum(owed_minor)::int from public.expense_shares s join public.expenses e on e.id = s.expense_id
  where e.splitwise_expense_id = 70001), 9000, 'shares sum to the total');
select is((select placeholder_name from public.group_members where splitwise_user_id = 99504), 'Wes (left)',
  'former Splitwise member becomes a placeholder');
select is((select body from public.comments where splitwise_comment_id = 82), 'Vic: yum', 'unknown author keeps their name');
select is((select author_id from public.comments where splitwise_comment_id = 81), '00000000-0000-0000-0000-0000000005a1'::uuid,
  'known author is linked');
select is((select from_member_id from public.settlements where splitwise_expense_id = 70002),
  (select id from public.group_members where splitwise_user_id = 99502), 'payment becomes a settlement from the payer');

-- Deleted later in Splitwise → soft-deleted here.
set local role service_role;
select is(public.splitwise_import_expenses('00000000-0000-0000-0000-0000000005a1', (select v from ids where k = 'trip'), '[]',
  '[{"splitwise_expense_id": 70001, "deleted": true}]') ->> 'deleted', '1', 'deletion is mirrored');
reset role;
select is((select is_deleted from public.expenses where splitwise_expense_id = 70001), true, 'expense soft-deleted');

-- ----- friend-only: everyone must be on SplitLens
set local role service_role;
select is(public.splitwise_import_expenses('00000000-0000-0000-0000-0000000005a1', null,
  '[{"splitwise_user_id": 99502, "email": "uma@sw.test"}, {"splitwise_user_id": 99599, "email": "nobody@x.test"}]', '[
  {"splitwise_expense_id": 71001, "description": "Taxi", "currency": "USD", "total_minor": 2000,
   "payers": [{"splitwise_user_id": 99500, "amount": 2000}], "shares": [{"splitwise_user_id": 99500, "amount": 1000}, {"splitwise_user_id": 99502, "amount": 1000}]},
  {"splitwise_expense_id": 71002, "description": "Concert", "currency": "USD", "total_minor": 2000,
   "payers": [{"splitwise_user_id": 99500, "amount": 2000}], "shares": [{"splitwise_user_id": 99500, "amount": 1000}, {"splitwise_user_id": 99599, "amount": 1000}]},
  {"splitwise_expense_id": 71003, "description": "Not mine", "currency": "USD", "total_minor": 2000,
   "payers": [{"splitwise_user_id": 99502, "amount": 2000}], "shares": [{"splitwise_user_id": 99501, "amount": 2000}]}
]') - 'existing' - 'deleted' - 'payments',
  '{"created": 1, "skipped": 2, "comments": 0, "unresolved": [99599]}'::jsonb,
  'friend expense imported; one with someone not on SplitLens and one without the importer are skipped');
reset role;
select is((select user_id from public.expense_shares where expense_id = (select id from public.expenses where splitwise_expense_id = 71001)
  and user_id <> '00000000-0000-0000-0000-0000000005a1'), '00000000-0000-0000-0000-0000000005c1'::uuid, 'friend-only expense uses user ids');

-- ----- clients can't call the import RPCs
select pg_temp.login('00000000-0000-0000-0000-0000000005b1');
select throws_ok($$ select public.splitwise_import_group('00000000-0000-0000-0000-0000000005b1', '{"splitwise_group_id": 999001}') $$,
  '42501', null, 'users cannot run the group import directly');
select throws_ok($$ select public.splitwise_import_expenses('00000000-0000-0000-0000-0000000005b1', null, '[]', '[]') $$,
  '42501', null, 'users cannot run the expense import directly');
select is((select count(*)::int from public.expenses where splitwise_expense_id = 71001), 0,
  'Tia cannot see a friend-only expense she is not on');

-- ----- friend invite links
select pg_temp.login('00000000-0000-0000-0000-0000000005b1');
insert into public.invite_links (created_by) values ('00000000-0000-0000-0000-0000000005b1');
create temp table tok (v text);
grant all on tok to authenticated;
insert into tok select token from public.invite_links where group_id is null;
select is(public.get_invite((select v from tok)) ->> 'kind', 'friend', 'friend invite is recognised');
select throws_ok($$ select public.redeem_friend_invite((select v from tok)) $$, 'P0001', 'This is your own invite link.',
  'cannot redeem your own link');
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000005d1', 'xan@sw.test');
select pg_temp.login('00000000-0000-0000-0000-0000000005d1');
select throws_ok($$ select public.redeem_invite((select v from tok), null) $$, 'P0001', 'This invite link is no longer valid.',
  'a friend link cannot be used to join a group');
select is(public.redeem_friend_invite((select v from tok)), '00000000-0000-0000-0000-0000000005b1'::uuid, 'friend invite redeemed');
select ok(private.is_friend('00000000-0000-0000-0000-0000000005b1'), 'now friends with the inviter');
reset role;

-- ===================================================== post to Splitwise
select pg_temp.login('00000000-0000-0000-0000-0000000005a1');
select is((public.splitwise_participants((select v from ids where k = 'trip'), null) ->> 'splitwise_group_id')::bigint, 999001::bigint,
  'group maps to its Splitwise group');
select is((select count(*)::int from jsonb_object_keys(public.splitwise_participants((select v from ids where k = 'trip'), null) -> 'participants')), 5,
  'every member with a Splitwise id (imported or linked) is postable');
select is(public.splitwise_participants(null, array['00000000-0000-0000-0000-0000000005c1'::uuid, '00000000-0000-0000-0000-0000000005d1'::uuid]) -> 'participants',
  '{"00000000-0000-0000-0000-0000000005a1": 99500}'::jsonb, 'friend-only: only linked accounts of yourself and friends');
select throws_ok($$ select public.splitwise_set_expense_id('00000000-0000-0000-0000-0000000005a1', gen_random_uuid(), 1) $$,
  '42501', null, 'users cannot set Splitwise ids directly');
reset role;

select * from finish();
rollback;
