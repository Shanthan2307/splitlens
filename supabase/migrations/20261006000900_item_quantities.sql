-- SplitLens phase 7: receipt review / item assignment.
-- Item quantities can be fractional (weighed goods: 0.452 kg), and save_expense now stores
-- quantity + unit price per item and rejects unassigned items server-side too.

alter table public.expense_items alter column quantity type numeric(12, 3);
alter table public.expense_items drop constraint if exists expense_items_quantity_check;
alter table public.expense_items add constraint expense_items_quantity_check check (quantity > 0);

/*
  Creates or updates an expense with its payers, shares and items in one transaction.
  p_expense: {
    id?, group_id?, description, category, expense_date, currency, total_minor, split_type, notes?, receipt_id?,
    payers: [{member_id | user_id, amount}],
    shares: [{member_id | user_id, amount, split_input?}],
    items?: [{kind, name, original_name?, quantity?, unit_price_minor?, amount,
              assignments: [{member_id | user_id, weight}]}]
  }
  Group expenses use member_id; friend-only expenses (group_id null) use user_id.
*/
create or replace function public.save_expense(p_expense jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_id uuid := nullif(p_expense ->> 'id', '')::uuid;
  v_group uuid := nullif(p_expense ->> 'group_id', '')::uuid;
  v_total bigint := (p_expense ->> 'total_minor')::bigint;
  v_split public.split_type := (p_expense ->> 'split_type')::public.split_type;
  v_payers jsonb := coalesce(p_expense -> 'payers', '[]');
  v_shares jsonb := coalesce(p_expense -> 'shares', '[]');
  v_items jsonb := coalesce(p_expense -> 'items', '[]');
  v_people jsonb;
  v_existing public.expenses;
  v_before jsonb;
  v_after jsonb;
  v_item record;
  v_item_id uuid;
  v_users uuid[];
begin
  if v_total is null or v_total = 0 then perform private.fail('The amount must not be zero.'); end if;
  if jsonb_array_length(v_payers) = 0 then perform private.fail('Choose who paid.'); end if;
  if jsonb_array_length(v_shares) = 0 then perform private.fail('Choose who to split with.'); end if;

  -- ----- access
  if v_id is not null then
    select * into v_existing from public.expenses where id = v_id for update;
    if not found or v_existing.is_deleted or not private.can_access_expense(v_id) then
      perform private.fail('Expense not found.');
    end if;
    if v_existing.group_id is distinct from v_group then
      perform private.fail('An expense cannot be moved between groups.');
    end if;
    v_before := private.expense_snapshot(v_id);
  end if;

  if v_group is not null then
    if not private.is_group_member(v_group)
       or not exists (select 1 from public.groups where id = v_group and deleted_at is null) then
      perform private.fail('You are not a member of this group.');
    end if;
  end if;

  -- ----- participants
  v_people := v_payers || v_shares;
  if v_split = 'itemized' then
    v_people := v_people || coalesce((
      select jsonb_agg(a) from jsonb_array_elements(v_items) i, jsonb_array_elements(i -> 'assignments') a), '[]');
  end if;

  if v_group is not null then
    if exists (
      select 1 from jsonb_array_elements(v_people) x
      where x ->> 'user_id' is not null
         or not exists (select 1 from public.group_members m
                        where m.id = (x ->> 'member_id')::uuid and m.group_id = v_group and m.left_at is null)
    ) then
      perform private.fail('Everyone on a group expense must be a current group member.');
    end if;
  else
    if exists (
      select 1 from jsonb_array_elements(v_people) x
      where x ->> 'member_id' is not null
         or not exists (select 1 from public.profiles p where p.id = (x ->> 'user_id')::uuid)
    ) then
      perform private.fail('Unknown person on this expense.');
    end if;
    if not exists (select 1 from jsonb_array_elements(v_people) x where (x ->> 'user_id')::uuid = v_uid) then
      perform private.fail('You must be part of an expense outside a group.');
    end if;
    if exists (select 1 from jsonb_array_elements(v_people) x
               where (x ->> 'user_id')::uuid <> v_uid and not private.is_friend((x ->> 'user_id')::uuid)) then
      perform private.fail('You can only add friends to an expense outside a group.');
    end if;
  end if;

  if (select count(*) from jsonb_array_elements(v_payers))
     <> (select count(distinct coalesce(x ->> 'member_id', x ->> 'user_id')) from jsonb_array_elements(v_payers) x)
  or (select count(*) from jsonb_array_elements(v_shares))
     <> (select count(distinct coalesce(x ->> 'member_id', x ->> 'user_id')) from jsonb_array_elements(v_shares) x) then
    perform private.fail('Each person can appear only once.');
  end if;

  -- ----- integrity (amounts were computed by lib/splits; re-check, don't recompute)
  if (select sum((x ->> 'amount')::bigint) from jsonb_array_elements(v_payers) x) <> v_total
     or exists (select 1 from jsonb_array_elements(v_payers) x where sign((x ->> 'amount')::bigint) <> sign(v_total)) then
    perform private.fail('The amounts paid must add up to the total.');
  end if;
  if (select sum((x ->> 'amount')::bigint) from jsonb_array_elements(v_shares) x) <> v_total
     or exists (select 1 from jsonb_array_elements(v_shares) x
                where sign((x ->> 'amount')::bigint) not in (0, sign(v_total))) then
    perform private.fail('The split must add up to the total.');
  end if;
  if v_split = 'itemized' and exists (
       select 1 from jsonb_array_elements(v_items) i
       where coalesce(i ->> 'kind', 'item') = 'item' and jsonb_array_length(coalesce(i -> 'assignments', '[]')) = 0) then
    perform private.fail('Assign every item to at least one person.');
  end if;
  if v_split = 'itemized' and (
       jsonb_array_length(v_items) = 0
       or (select sum((i ->> 'amount')::bigint) from jsonb_array_elements(v_items) i) <> v_total) then
    perform private.fail('The items must add up to the total.');
  end if;

  -- ----- write
  if v_id is null then
    insert into public.expenses (group_id, description, category, expense_date, currency, total_minor, split_type,
                                 notes, receipt_id, created_by, updated_by)
    values (v_group, trim(p_expense ->> 'description'), coalesce(p_expense ->> 'category', 'general'),
            coalesce((p_expense ->> 'expense_date')::date, current_date), p_expense ->> 'currency', v_total, v_split,
            nullif(trim(p_expense ->> 'notes'), ''), nullif(p_expense ->> 'receipt_id', '')::uuid, v_uid, v_uid)
    returning id into v_id;
  else
    update public.expenses set
      description = trim(p_expense ->> 'description'),
      category = coalesce(p_expense ->> 'category', 'general'),
      expense_date = coalesce((p_expense ->> 'expense_date')::date, expense_date),
      currency = p_expense ->> 'currency',
      total_minor = v_total,
      split_type = v_split,
      notes = nullif(trim(p_expense ->> 'notes'), ''),
      receipt_id = coalesce(nullif(p_expense ->> 'receipt_id', '')::uuid, receipt_id),
      updated_by = v_uid
    where id = v_id;
    delete from public.expense_payers where expense_id = v_id;
    delete from public.expense_shares where expense_id = v_id;
    delete from public.expense_items where expense_id = v_id;
  end if;

  insert into public.expense_payers (expense_id, member_id, user_id, paid_minor)
  select v_id, (x ->> 'member_id')::uuid, (x ->> 'user_id')::uuid, (x ->> 'amount')::bigint
  from jsonb_array_elements(v_payers) x;

  insert into public.expense_shares (expense_id, member_id, user_id, owed_minor, split_input)
  select v_id, (x ->> 'member_id')::uuid, (x ->> 'user_id')::uuid, (x ->> 'amount')::bigint, (x ->> 'split_input')::bigint
  from jsonb_array_elements(v_shares) x;

  if v_split = 'itemized' then
    for v_item in select value, ordinality from jsonb_array_elements(v_items) with ordinality loop
      insert into public.expense_items (expense_id, position, kind, name, original_name, quantity, unit_price_minor, total_minor)
      values (v_id, v_item.ordinality::int,
              coalesce((v_item.value ->> 'kind')::public.expense_item_kind, 'item'),
              trim(v_item.value ->> 'name'), nullif(trim(v_item.value ->> 'original_name'), ''),
              coalesce((v_item.value ->> 'quantity')::numeric, 1), (v_item.value ->> 'unit_price_minor')::bigint,
              (v_item.value ->> 'amount')::bigint)
      returning id into v_item_id;
      insert into public.item_assignments (item_id, member_id, user_id, share_weight)
      select v_item_id, (a ->> 'member_id')::uuid, (a ->> 'user_id')::uuid, coalesce((a ->> 'weight')::int, 1)
      from jsonb_array_elements(coalesce(v_item.value -> 'assignments', '[]')) a;
    end loop;
  end if;

  v_after := private.expense_snapshot(v_id);
  v_users := private.snapshot_user_ids(v_after) || private.snapshot_user_ids(v_before);

  -- Everyone on a friend-only expense becomes friends (as in Splitwise).
  if v_group is null then
    perform private.befriend(a, b)
    from unnest(private.snapshot_user_ids(v_after)) a, unnest(private.snapshot_user_ids(v_after)) b
    where a < b;
  end if;

  perform private.log_activity(
    case when v_before is null then 'expense_created'::public.activity_action else 'expense_updated'::public.activity_action end,
    v_group, v_id, v_users,
    jsonb_build_object('before', v_before, 'after', v_after));
  return v_id;
end;
$$;
