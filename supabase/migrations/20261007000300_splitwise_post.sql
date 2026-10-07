-- SplitLens phase 9c: "Also post to Splitwise" for new expenses.

-- Splitwise ids for the people the caller could put on an expense: a group's members
-- (their imported Splitwise id, or their linked account's) or the caller and friends.
-- Returns {splitwise_group_id, participants: {participant_id: splitwise_user_id}}.
create or replace function public.splitwise_participants(p_group_id uuid, p_user_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_auth();
begin
  if p_group_id is not null then
    if not private.is_group_member(p_group_id) then perform private.fail('You are not a member of this group.'); end if;
    return jsonb_build_object(
      'splitwise_group_id', (select splitwise_group_id from public.groups where id = p_group_id),
      'participants', coalesce((
        select jsonb_object_agg(m.id, coalesce(m.splitwise_user_id, p.splitwise_user_id))
        from public.group_members m left join public.profiles p on p.id = m.user_id
        where m.group_id = p_group_id and m.left_at is null and coalesce(m.splitwise_user_id, p.splitwise_user_id) is not null
      ), '{}'));
  end if;
  return jsonb_build_object(
    'splitwise_group_id', 0,
    'participants', coalesce((
      select jsonb_object_agg(p.id, p.splitwise_user_id) from public.profiles p
      where p.id = any (coalesce(p_user_ids, '{}') || v_uid) and p.splitwise_user_id is not null
        and (p.id = v_uid or private.is_friend(p.id))
    ), '{}'));
end;
$$;

-- Records the Splitwise id of an expense SplitLens just posted (service role, after create_expense).
create or replace function public.splitwise_set_expense_id(p_user uuid, p_expense_id uuid, p_splitwise_expense_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.as_user(p_user);
  if not private.can_access_expense(p_expense_id) then perform private.fail('Expense not found.'); end if;
  update public.expenses set splitwise_expense_id = p_splitwise_expense_id
  where id = p_expense_id and splitwise_expense_id is null;
end;
$$;

revoke all on function public.splitwise_participants(uuid, uuid[]) from public, anon;
grant execute on function public.splitwise_participants(uuid, uuid[]) to authenticated;
revoke all on function public.splitwise_set_expense_id(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.splitwise_set_expense_id(uuid, uuid, bigint) to service_role;
