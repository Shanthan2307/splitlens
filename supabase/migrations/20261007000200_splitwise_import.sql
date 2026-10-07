-- SplitLens phase 9b: Splitwise import (idempotent by Splitwise ids) and friend invite links.
--
-- Import RPCs are service-role only: the server fetched the data from Splitwise with the
-- user's own token, so group membership and amounts are what Splitwise says. Clients can't
-- call them (a fabricated splitwise_group_id could otherwise join someone else's group).
-- Amounts arrive in minor units, already converted and reconciled by lib/splits/splitwise.

-- ------------------------------------------------------------------ helpers

-- SplitLens user for a Splitwise person: a verified link first, then the email.
create or replace function private.splitwise_user(p_splitwise_user_id bigint, p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select id from public.profiles where splitwise_user_id = p_splitwise_user_id),
    (select id from public.profiles where p_email is not null and lower(email) = lower(trim(p_email))
     order by created_at limit 1));
$$;

-- Group member for a Splitwise person, creating or linking it as needed:
-- existing row with that Splitwise id → registered user's row → placeholder with that email → new.
create or replace function private.splitwise_member(p_group uuid, p_splitwise_user_id bigint, p_name text, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(nullif(trim(p_email), ''));
  v_user uuid := private.splitwise_user(p_splitwise_user_id, v_email);
  v_member public.group_members;
begin
  select * into v_member from public.group_members where group_id = p_group and splitwise_user_id = p_splitwise_user_id;
  if found then
    if v_member.user_id is null and v_user is not null
       and not exists (select 1 from public.group_members where group_id = p_group and user_id = v_user) then
      update public.group_members set user_id = v_user where id = v_member.id;
      perform private.befriend_group(v_user, p_group);
    end if;
    return v_member.id;
  end if;

  if v_user is not null then
    select * into v_member from public.group_members where group_id = p_group and user_id = v_user;
    if found then
      update public.group_members set splitwise_user_id = p_splitwise_user_id, left_at = null where id = v_member.id;
      return v_member.id;
    end if;
    insert into public.group_members (group_id, user_id, splitwise_user_id)
    values (p_group, v_user, p_splitwise_user_id) returning * into v_member;
    perform private.befriend_group(v_user, p_group);
    return v_member.id;
  end if;

  if v_email is not null then
    select * into v_member from public.group_members
    where group_id = p_group and user_id is null and splitwise_user_id is null and lower(placeholder_email) = v_email
    limit 1;
    if found then
      update public.group_members set splitwise_user_id = p_splitwise_user_id where id = v_member.id;
      return v_member.id;
    end if;
  end if;

  -- Placeholder: claimed automatically when someone signs up with this email, links their
  -- Splitwise account, or picks it from an invite link.
  insert into public.group_members (group_id, placeholder_name, placeholder_email, splitwise_user_id)
  values (p_group, left(coalesce(nullif(trim(p_name), ''), 'Splitwise user'), 80), v_email, p_splitwise_user_id)
  returning * into v_member;
  return v_member.id;
end;
$$;

-- ------------------------------------------------------------------- groups
/*
  p_group: {splitwise_group_id, name, type, simplify, currency,
            members: [{splitwise_user_id, name, email}]}
  Creates the group on first import; later imports (by anyone in the Splitwise group) reuse
  it and add missing people. Returns {group_id, created, members: [{splitwise_user_id, member_id, registered}]}.
*/
create or replace function public.splitwise_import_group(p_user uuid, p_group jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me_sw bigint;
  v_sw_group bigint := (p_group ->> 'splitwise_group_id')::bigint;
  v_group public.groups;
  v_created boolean := false;
  v_me public.group_members;
  v_member uuid;
  v_out jsonb := '[]';
  m jsonb;
begin
  perform private.as_user(p_user);
  select splitwise_user_id into v_me_sw from public.profiles where id = p_user;
  if v_me_sw is null then perform private.fail('Connect Splitwise first.'); end if;

  select * into v_group from public.groups where splitwise_group_id = v_sw_group for update;
  if found and v_group.deleted_at is not null then
    perform private.fail('This group was deleted in SplitLens.');
  elsif not found then
    insert into public.groups (name, type, default_currency, simplify_debts, created_by, splitwise_group_id)
    values (
      left(coalesce(nullif(trim(p_group ->> 'name'), ''), 'Splitwise group'), 100),
      coalesce(nullif(p_group ->> 'type', '')::public.group_type, 'other'),
      coalesce(nullif(p_group ->> 'currency', ''), 'USD'),
      coalesce((p_group ->> 'simplify')::boolean, true),
      p_user, v_sw_group)
    returning * into v_group;
    v_created := true;
  end if;

  -- The importer: rejoin, claim their placeholder, or join.
  select * into v_me from public.group_members where group_id = v_group.id and user_id = p_user;
  if found then
    update public.group_members set left_at = null,
      splitwise_user_id = coalesce(splitwise_user_id, case when not exists (
        select 1 from public.group_members where group_id = v_group.id and splitwise_user_id = v_me_sw) then v_me_sw end)
    where id = v_me.id;
  else
    select * into v_me from public.group_members
    where group_id = v_group.id and splitwise_user_id = v_me_sw and user_id is null for update;
    if found then
      update public.group_members set user_id = p_user, left_at = null where id = v_me.id;
    else
      insert into public.group_members (group_id, user_id, role, splitwise_user_id)
      values (v_group.id, p_user, case when v_created then 'owner' else 'member' end::public.group_role, v_me_sw)
      returning * into v_me;
    end if;
  end if;

  for m in select * from jsonb_array_elements(coalesce(p_group -> 'members', '[]')) loop
    if (m ->> 'splitwise_user_id')::bigint = v_me_sw then
      v_member := v_me.id;
    else
      v_member := private.splitwise_member(v_group.id, (m ->> 'splitwise_user_id')::bigint, m ->> 'name', m ->> 'email');
    end if;
    v_out := v_out || jsonb_build_object(
      'splitwise_user_id', (m ->> 'splitwise_user_id')::bigint,
      'member_id', v_member,
      'registered', (select user_id is not null from public.group_members where id = v_member));
  end loop;

  perform private.befriend_group(p_user, v_group.id);
  if v_created then
    perform private.log_activity('group_created', v_group.id, null, null,
      jsonb_build_object('name', v_group.name, 'source', 'splitwise'));
  end if;
  return jsonb_build_object('group_id', v_group.id, 'created', v_created, 'members', v_out);
end;
$$;

-- ----------------------------------------------------------------- expenses
/*
  Imports one page of Splitwise expenses into a group (p_group_id) or as friend-only
  expenses (p_group_id null). Re-running is safe: rows are keyed by splitwise_expense_id /
  splitwise_comment_id. Expenses deleted in Splitwise are skipped, or soft-deleted if already imported.

  p_people:   [{splitwise_user_id, name, email}] for resolving participants
  p_expenses: [{splitwise_expense_id, description, category, date, currency, total_minor, notes,
                created_at, deleted, payment,
                payers: [{splitwise_user_id, amount}], shares: [{splitwise_user_id, amount}],
                comments: [{splitwise_comment_id, splitwise_user_id, author_name, body, created_at}]}]
  Returns counts: {created, payments, existing, deleted, skipped, comments, unresolved: [splitwise ids]}.
*/
create or replace function public.splitwise_import_expenses(p_user uuid, p_group_id uuid, p_people jsonb, p_expenses jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
  c jsonb;
  x jsonb;
  v_sw bigint;
  v_total bigint;
  v_expense uuid;
  v_settlement uuid;
  v_ids jsonb;          -- splitwise_user_id (text) → member_id / user_id
  v_pid uuid;
  v_person jsonb;
  v_missing bigint[];
  v_users uuid[];
  v_author uuid;
  v_created int := 0; v_payments int := 0; v_existing int := 0; v_deleted int := 0; v_skipped int := 0; v_comments int := 0;
  v_unresolved bigint[] := '{}';
  v_inserted int;
begin
  perform private.as_user(p_user);
  if p_group_id is not null and (not private.is_group_member(p_group_id)
     or not exists (select 1 from public.groups where id = p_group_id and deleted_at is null)) then
    perform private.fail('You are not a member of this group.');
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_expenses, '[]')) loop
    v_sw := (e ->> 'splitwise_expense_id')::bigint;
    v_expense := null; v_settlement := null;
    select id into v_expense from public.expenses where splitwise_expense_id = v_sw;
    if v_expense is null then select id into v_settlement from public.settlements where splitwise_expense_id = v_sw; end if;

    -- ----- already imported (by anyone): mirror deletes, add new comments
    if v_expense is not null or v_settlement is not null then
      if (v_expense is not null and not private.can_access_expense(v_expense))
         or (v_settlement is not null and not private.can_access_settlement(v_settlement)) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_existing := v_existing + 1;
      if coalesce((e ->> 'deleted')::boolean, false) then
        if v_expense is not null then
          update public.expenses set is_deleted = true, deleted_at = now(), deleted_by = p_user
          where id = v_expense and not is_deleted;
        else
          update public.settlements set is_deleted = true, deleted_at = now(), deleted_by = p_user
          where id = v_settlement and not is_deleted;
        end if;
        if found then v_deleted := v_deleted + 1; end if;
      end if;
    elsif coalesce((e ->> 'deleted')::boolean, false) then
      v_skipped := v_skipped + 1;
      continue;
    else
      -- ----- resolve everyone on the expense
      v_ids := '{}'; v_missing := '{}';
      for x in
        select distinct on (p ->> 'splitwise_user_id') p
        from jsonb_array_elements(coalesce(e -> 'payers', '[]') || coalesce(e -> 'shares', '[]')) p
      loop
        select value into v_person from jsonb_array_elements(coalesce(p_people, '[]'))
        where (value ->> 'splitwise_user_id') = (x ->> 'splitwise_user_id') limit 1;
        if p_group_id is not null then
          v_pid := private.splitwise_member(p_group_id, (x ->> 'splitwise_user_id')::bigint,
                                            coalesce(v_person ->> 'name', x ->> 'name'), v_person ->> 'email');
        else
          v_pid := private.splitwise_user((x ->> 'splitwise_user_id')::bigint, v_person ->> 'email');
        end if;
        if v_pid is null then v_missing := v_missing || (x ->> 'splitwise_user_id')::bigint;
        else v_ids := v_ids || jsonb_build_object(x ->> 'splitwise_user_id', v_pid);
        end if;
      end loop;

      v_total := (e ->> 'total_minor')::bigint;
      if cardinality(v_missing) > 0 then
        v_unresolved := v_unresolved || v_missing;
        v_skipped := v_skipped + 1;
        continue;
      end if;
      -- Friend-only expenses must include the importer; sums and signs must hold.
      if (p_group_id is null and not exists (select 1 from jsonb_each_text(v_ids) where value::uuid = p_user))
         or v_total is null or v_total <= 0
         or (select coalesce(sum((p ->> 'amount')::bigint), 0) from jsonb_array_elements(e -> 'payers') p) <> v_total
         or (select coalesce(sum((p ->> 'amount')::bigint), 0) from jsonb_array_elements(e -> 'shares') p) <> v_total
         or exists (select 1 from jsonb_array_elements(e -> 'payers') p where (p ->> 'amount')::bigint <= 0)
         or exists (select 1 from jsonb_array_elements(e -> 'shares') p where (p ->> 'amount')::bigint < 0) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if coalesce((e ->> 'payment')::boolean, false) then
        -- A Splitwise payment: one payer, one recipient.
        if jsonb_array_length(e -> 'payers') <> 1 or jsonb_array_length(e -> 'shares') <> 1
           or (e -> 'payers' -> 0 ->> 'splitwise_user_id') = (e -> 'shares' -> 0 ->> 'splitwise_user_id') then
          v_skipped := v_skipped + 1;
          continue;
        end if;
        insert into public.settlements (group_id, from_member_id, from_user_id, to_member_id, to_user_id, amount_minor,
                                        currency, settled_on, method, notes, created_by, splitwise_expense_id, created_at)
        values (
          p_group_id,
          case when p_group_id is not null then (v_ids ->> (e -> 'payers' -> 0 ->> 'splitwise_user_id'))::uuid end,
          case when p_group_id is null then (v_ids ->> (e -> 'payers' -> 0 ->> 'splitwise_user_id'))::uuid end,
          case when p_group_id is not null then (v_ids ->> (e -> 'shares' -> 0 ->> 'splitwise_user_id'))::uuid end,
          case when p_group_id is null then (v_ids ->> (e -> 'shares' -> 0 ->> 'splitwise_user_id'))::uuid end,
          v_total, e ->> 'currency', coalesce((e ->> 'date')::date, current_date), 'other',
          nullif(left(trim(e ->> 'notes'), 2000), ''), p_user, v_sw, coalesce((e ->> 'created_at')::timestamptz, now()))
        returning id into v_settlement;
        v_payments := v_payments + 1;
      else
        insert into public.expenses (group_id, description, category, expense_date, currency, total_minor, split_type,
                                     notes, created_by, updated_by, splitwise_expense_id, created_at)
        values (
          p_group_id, left(coalesce(nullif(trim(e ->> 'description'), ''), 'Splitwise expense'), 200),
          coalesce(nullif(e ->> 'category', ''), 'general'), coalesce((e ->> 'date')::date, current_date),
          e ->> 'currency', v_total, 'exact', nullif(left(trim(e ->> 'notes'), 2000), ''),
          p_user, p_user, v_sw, coalesce((e ->> 'created_at')::timestamptz, now()))
        returning id into v_expense;

        insert into public.expense_payers (expense_id, member_id, user_id, paid_minor)
        select v_expense,
               case when p_group_id is not null then (v_ids ->> (p ->> 'splitwise_user_id'))::uuid end,
               case when p_group_id is null then (v_ids ->> (p ->> 'splitwise_user_id'))::uuid end,
               (p ->> 'amount')::bigint
        from jsonb_array_elements(e -> 'payers') p;
        insert into public.expense_shares (expense_id, member_id, user_id, owed_minor, split_input)
        select v_expense,
               case when p_group_id is not null then (v_ids ->> (p ->> 'splitwise_user_id'))::uuid end,
               case when p_group_id is null then (v_ids ->> (p ->> 'splitwise_user_id'))::uuid end,
               (p ->> 'amount')::bigint, (p ->> 'amount')::bigint
        from jsonb_array_elements(e -> 'shares') p;
        v_created := v_created + 1;
      end if;

      -- Everyone on a friend-only expense becomes friends (as in Splitwise and save_expense).
      if p_group_id is null then
        select array_agg(value::uuid) into v_users from jsonb_each_text(v_ids);
        perform private.befriend(a, b) from unnest(v_users) a, unnest(v_users) b where a < b;
      end if;
    end if;

    -- ----- comments (new ones only)
    for c in select * from jsonb_array_elements(coalesce(e -> 'comments', '[]')) loop
      v_author := private.splitwise_user((c ->> 'splitwise_user_id')::bigint, null);
      insert into public.comments (expense_id, settlement_id, author_id, body, splitwise_comment_id, created_at)
      values (
        v_expense, v_settlement, v_author,
        left(case when v_author is null then coalesce(nullif(c ->> 'author_name', ''), 'Someone') || ': ' else '' end
             || coalesce(nullif(trim(c ->> 'body'), ''), '…'), 4000),
        (c ->> 'splitwise_comment_id')::bigint, coalesce((c ->> 'created_at')::timestamptz, now()))
      on conflict (splitwise_comment_id) do nothing;
      get diagnostics v_inserted = row_count;
      v_comments := v_comments + v_inserted;
    end loop;
  end loop;

  return jsonb_build_object('created', v_created, 'payments', v_payments, 'existing', v_existing, 'deleted', v_deleted,
    'skipped', v_skipped, 'comments', v_comments,
    'unresolved', (select coalesce(jsonb_agg(distinct u), '[]') from unnest(v_unresolved) u));
end;
$$;

-- One activity entry per finished import (not one per expense).
create or replace function public.splitwise_log_import(p_user uuid, p_group_id uuid, p_summary jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.as_user(p_user);
  if p_group_id is not null and not private.is_group_member(p_group_id) then
    perform private.fail('You are not a member of this group.');
  end if;
  perform private.log_activity('splitwise_import_completed', p_group_id, null,
    case when p_group_id is not null then private.group_user_ids(p_group_id) else
      array(select (value)::uuid from jsonb_array_elements_text(coalesce(p_summary -> 'user_ids', '[]'))) end,
    p_summary - 'user_ids');
end;
$$;

-- ------------------------------------------------------- friend invite links
-- invite_links with group_id null invite someone to become friends with the creator
-- (e.g. a Splitwise friend who isn't on SplitLens yet).
create or replace function public.get_invite(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_invite public.invite_links;
  v_group public.groups;
  v_reason text;
begin
  select * into v_invite from public.invite_links where token = p_token;
  if not found then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;

  if v_invite.group_id is null then
    v_reason := case
      when v_invite.revoked_at is not null then 'revoked'
      when v_invite.expires_at is not null and v_invite.expires_at < now() then 'expired'
      when v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then 'used_up'
    end;
    if v_reason is not null then return jsonb_build_object('valid', false, 'reason', v_reason); end if;
    return jsonb_build_object(
      'valid', true,
      'kind', 'friend',
      'inviter_id', v_invite.created_by,
      'inviter_name', (select display_name from public.profiles where id = v_invite.created_by),
      'self', v_invite.created_by = v_uid,
      'already_friends', private.is_friend(v_invite.created_by));
  end if;

  select * into v_group from public.groups where id = v_invite.group_id;
  v_reason := case
    when v_group.deleted_at is not null then 'group_deleted'
    when v_invite.revoked_at is not null then 'revoked'
    when v_invite.expires_at is not null and v_invite.expires_at < now() then 'expired'
    when v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then 'used_up'
  end;
  if v_reason is not null then return jsonb_build_object('valid', false, 'reason', v_reason); end if;

  return jsonb_build_object(
    'valid', true,
    'kind', 'group',
    'group', jsonb_build_object('id', v_group.id, 'name', v_group.name, 'type', v_group.type),
    'inviter_name', (select display_name from public.profiles where id = v_invite.created_by),
    'member_count', (select count(*) from public.group_members where group_id = v_group.id and left_at is null),
    'already_member', private.is_group_member(v_group.id),
    'claim_member_id', v_invite.member_id,
    'placeholders', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.placeholder_name) order by m.placeholder_name)
      from public.group_members m
      where m.group_id = v_group.id and m.user_id is null and m.left_at is null
        and (v_invite.member_id is null or m.id = v_invite.member_id)
    ), '[]')
  );
end;
$$;

-- Group links only (friend links go through redeem_friend_invite).
create or replace function public.redeem_invite(p_token text, p_claim_member_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_info jsonb := public.get_invite(p_token);
  v_invite public.invite_links;
  v_group uuid;
  v_existing public.group_members;
  v_claim public.group_members;
begin
  if not (v_info ->> 'valid')::boolean or v_info ->> 'kind' <> 'group' then
    perform private.fail('This invite link is no longer valid.');
  end if;
  select * into v_invite from public.invite_links where token = p_token for update;
  v_group := v_invite.group_id;

  select * into v_existing from public.group_members where group_id = v_group and user_id = v_uid;
  if found and v_existing.left_at is null then return v_group; end if;

  if v_invite.member_id is not null and p_claim_member_id is distinct from v_invite.member_id then
    perform private.fail('This invite is for a specific person.');
  end if;

  if p_claim_member_id is not null then
    select * into v_claim from public.group_members
    where id = p_claim_member_id and group_id = v_group and user_id is null and left_at is null for update;
    if not found then perform private.fail('That person has already been claimed.'); end if;
    if v_existing.id is not null then
      -- A former member can't also take over a placeholder (unique group/user).
      perform private.fail('You were previously in this group. Ask a member to re-add you.');
    end if;
    update public.group_members set user_id = v_uid where id = v_claim.id;
    perform private.log_activity('placeholder_claimed', v_group, null, private.group_user_ids(v_group),
      jsonb_build_object('member_id', v_claim.id, 'name', v_claim.placeholder_name));
  elsif v_existing.id is not null then
    update public.group_members set left_at = null, joined_at = now() where id = v_existing.id;
    perform private.log_activity('member_added', v_group, null, private.group_user_ids(v_group),
      jsonb_build_object('member_id', v_existing.id, 'via', 'invite'));
  else
    insert into public.group_members (group_id, user_id) values (v_group, v_uid) returning * into v_existing;
    perform private.log_activity('member_added', v_group, null, private.group_user_ids(v_group),
      jsonb_build_object('member_id', v_existing.id, 'via', 'invite'));
  end if;

  -- Links for a specific placeholder are single-use.
  update public.invite_links
  set use_count = use_count + 1,
      revoked_at = case when member_id is not null then now() else revoked_at end
  where id = v_invite.id;
  perform private.befriend_group(v_uid, v_group);
  return v_group;
end;
$$;

create or replace function public.redeem_friend_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_info jsonb := public.get_invite(p_token);
  v_invite public.invite_links;
begin
  if not (v_info ->> 'valid')::boolean or v_info ->> 'kind' <> 'friend' then
    perform private.fail('This invite link is no longer valid.');
  end if;
  select * into v_invite from public.invite_links where token = p_token for update;
  if v_invite.created_by = v_uid then perform private.fail('This is your own invite link.'); end if;
  if not private.is_friend(v_invite.created_by) then
    perform private.befriend(v_uid, v_invite.created_by);
    perform private.log_activity('friend_accepted', null, null, array[v_invite.created_by], jsonb_build_object('via', 'invite'));
  end if;
  update public.invite_links set use_count = use_count + 1 where id = v_invite.id;
  return v_invite.created_by;
end;
$$;

-- --------------------------------------------------------------- privileges
revoke all on function
  private.splitwise_user(bigint, text), private.splitwise_member(uuid, bigint, text, text)
from public, anon, authenticated;
revoke all on function
  public.splitwise_import_group(uuid, jsonb), public.splitwise_import_expenses(uuid, uuid, jsonb, jsonb),
  public.splitwise_log_import(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function
  public.splitwise_import_group(uuid, jsonb), public.splitwise_import_expenses(uuid, uuid, jsonb, jsonb),
  public.splitwise_log_import(uuid, uuid, jsonb)
to service_role;
revoke all on function public.redeem_friend_invite(text) from public, anon;
grant execute on function public.redeem_friend_invite(text) to authenticated;
