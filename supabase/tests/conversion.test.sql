-- convert_group_currencies. Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007a1', 'kai@cv.test'),
  ('00000000-0000-0000-0000-0000000007b1', 'lou@cv.test'),
  ('00000000-0000-0000-0000-0000000007c1', 'out@cv.test');
create or replace function pg_temp.login(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

select pg_temp.login('00000000-0000-0000-0000-0000000007a1');
insert into ids values ('g', public.create_group('Tokyo', 'trip', 'USD', true));
select public.add_group_member((select v from ids where k = 'g'), 'lou@cv.test', null);
insert into ids select 'kai', id from public.group_members where user_id = '00000000-0000-0000-0000-0000000007a1';
insert into ids select 'lou', id from public.group_members where user_id = '00000000-0000-0000-0000-0000000007b1';

create or replace function pg_temp.leg(cur text, total bigint, payer text, sharer text) returns jsonb language sql as $$
  select jsonb_build_object('group_id', (select v from ids where k = 'g'), 'description', 'Currency conversion', 'category', 'conversion',
    'currency', cur, 'total_minor', total, 'split_type', 'exact',
    'payers', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = payer), 'amount', total)),
    'shares', jsonb_build_array(jsonb_build_object('member_id', (select v from ids where k = sharer), 'amount', total, 'split_input', total)));
$$;

-- Lou owes Kai ¥1,000 → convert to $6.31.
select is(cardinality(public.convert_group_currencies((select v from ids where k = 'g'),
  jsonb_build_array(pg_temp.leg('JPY', 1000, 'lou', 'kai'), pg_temp.leg('USD', 631, 'kai', 'lou')))), 2, 'both legs saved');
select is((select count(*)::int from public.expenses where group_id = (select v from ids where k = 'g') and category = 'conversion'), 2,
  'conversion expenses are in the group');
select throws_ok($$ select public.convert_group_currencies((select v from ids where k = 'g'),
  jsonb_build_array(pg_temp.leg('JPY', 1000, 'lou', 'kai') || '{"category": "dining"}')) $$,
  'P0001', 'Invalid conversion.', 'only conversion entries');
-- All-or-nothing: the second leg is invalid (shares don't add up), so neither is saved.
select throws_ok($$ select public.convert_group_currencies((select v from ids where k = 'g'),
  jsonb_build_array(pg_temp.leg('JPY', 500, 'lou', 'kai'), pg_temp.leg('USD', 300, 'kai', 'lou') || '{"total_minor": 301}')) $$,
  'P0001', null, 'a bad leg fails the whole conversion');
select pg_temp.login('00000000-0000-0000-0000-0000000007c1');
select throws_ok($$ select public.convert_group_currencies((select v from ids where k = 'g'), jsonb_build_array(pg_temp.leg('JPY', 1, 'lou', 'kai'))) $$,
  'P0001', 'You are not a member of this group.', 'non-members cannot convert');

select * from finish();
rollback;
