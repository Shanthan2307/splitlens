-- SplitLens phase 4: transactional RPCs for friends, groups, invites and expenses.
--
-- All are SECURITY DEFINER with explicit access checks (they write rows that RLS /
-- column grants deliberately keep clients from writing directly, e.g. claiming a
-- placeholder or auto-accepting friendships). Errors raised with SQLSTATE P0001 carry
-- user-facing messages; the data layer surfaces those verbatim.
-- Split math is done in lib/splits; these functions only re-check integrity
-- (sums match the total, signs are consistent, participants are allowed).

-- ------------------------------------------------------------------ helpers
create or replace function private.require_auth()
returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return v;
end;
$$;

create or replace function private.fail(p_message text)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_message using errcode = 'P0001';
end;
$$;

create or replace function private.log_activity(
  p_action public.activity_action,
  p_group_id uuid,
  p_expense_id uuid,
  p_involved uuid[],
  p_payload jsonb
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.activity_log (actor_id, action, group_id, expense_id, involved_user_ids, payload)
  values (
    auth.uid(), p_action, p_group_id, p_expense_id,
    array(select distinct u from unnest(coalesce(p_involved, '{}') || auth.uid()) u where u is not null),
    coalesce(p_payload, '{}')
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Accepted friendship between two users (creates or upgrades a pending one).
create or replace function private.befriend(p_a uuid, p_b uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_a is null or p_b is null or p_a = p_b then return; end if;
  insert into public.friendships (requester_id, addressee_id, status, accepted_at)
  values (p_a, p_b, 'accepted', now())
  on conflict (least(requester_id, addressee_id), greatest(requester_id, addressee_id))
  do update set status = 'accepted', accepted_at = coalesce(public.friendships.accepted_at, now());
end;
$$;

-- Makes p_user friends with every active registered member of a group.
create or replace function private.befriend_group(p_user uuid, p_group_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select user_id from public.group_members
    where group_id = p_group_id and user_id is not null and user_id <> p_user and left_at is null
  loop
    perform private.befriend(p_user, r.user_id);
  end loop;
end;
$$;

create or replace function private.member_name(p_member_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(p.display_name, ''), m.placeholder_name, 'Someone')
  from public.group_members m left join public.profiles p on p.id = m.user_id
  where m.id = p_member_id;
$$;

create or replace function private.group_user_ids(p_group_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(user_id), '{}') from public.group_members
  where group_id = p_group_id and user_id is not null and left_at is null;
$$;

-- ------------------------------------------------------- auth trigger update
-- New users automatically claim placeholders that were invited by their email.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    left(coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ), 80),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  );
  insert into public.notification_settings (user_id) values (new.id);

  if new.email is not null then
    for r in
      select distinct on (group_id) id, group_id from public.group_members
      where user_id is null and left_at is null and lower(placeholder_email) = lower(new.email)
      order by group_id, created_at
    loop
      update public.group_members set user_id = new.id where id = r.id;
      perform private.befriend_group(new.id, r.group_id);
    end loop;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------- friends
create or replace function public.send_friend_request(p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_other uuid;
  v_existing public.friendships;
begin
  select id into v_other from public.profiles where lower(email) = lower(trim(p_email));
  if v_other is null then return 'not_found'; end if;
  if v_other = v_uid then return 'self'; end if;

  select * into v_existing from public.friendships
  where least(requester_id, addressee_id) = least(v_uid, v_other)
    and greatest(requester_id, addressee_id) = greatest(v_uid, v_other);

  if found then
    if v_existing.status = 'accepted' then return 'already_friends'; end if;
    if v_existing.requester_id = v_uid then return 'already_requested'; end if;
    -- They already asked us: accept.
    update public.friendships set status = 'accepted', accepted_at = now() where id = v_existing.id;
    perform private.log_activity('friend_accepted', null, null, array[v_other], '{}');
    return 'accepted';
  end if;

  insert into public.friendships (requester_id, addressee_id) values (v_uid, v_other);
  perform private.log_activity('friend_requested', null, null, array[v_other], '{}');
  return 'requested';
end;
$$;

create or replace function public.respond_friend_request(p_friendship_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_row public.friendships;
begin
  select * into v_row from public.friendships
  where id = p_friendship_id and addressee_id = v_uid and status = 'pending' for update;
  if not found then perform private.fail('That friend request no longer exists.'); end if;

  if p_accept then
    update public.friendships set status = 'accepted', accepted_at = now() where id = v_row.id;
    perform private.log_activity('friend_accepted', null, null, array[v_row.requester_id], '{}');
  else
    delete from public.friendships where id = v_row.id;
  end if;
end;
$$;

-- ------------------------------------------------------------------ groups
create or replace function public.create_group(
  p_name text,
  p_type public.group_type,
  p_default_currency text,
  p_simplify_debts boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_group uuid;
begin
  insert into public.groups (name, type, default_currency, simplify_debts, created_by)
  values (trim(p_name), p_type, p_default_currency, p_simplify_debts, v_uid)
  returning id into v_group;
  insert into public.group_members (group_id, user_id, role) values (v_group, v_uid, 'owner');
  perform private.log_activity('group_created', v_group, null, null, jsonb_build_object('name', trim(p_name)));
  return v_group;
end;
$$;

-- p_patch keys (all optional): name, type, default_currency, default_split_type,
-- simplify_debts, cover_image_path, member_weights: [{member_id, weight|null}]
create or replace function public.update_group(p_group_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_before public.groups;
  v_after public.groups;
  v_split public.split_type;
  v_weight_sum bigint;
begin
  if not private.is_group_member(p_group_id) then perform private.fail('You are not a member of this group.'); end if;
  select * into v_before from public.groups where id = p_group_id and deleted_at is null for update;
  if not found then perform private.fail('Group not found.'); end if;

  update public.groups set
    name = coalesce(nullif(trim(p_patch ->> 'name'), ''), name),
    type = coalesce((p_patch ->> 'type')::public.group_type, type),
    default_currency = coalesce(p_patch ->> 'default_currency', default_currency),
    default_split_type = coalesce((p_patch ->> 'default_split_type')::public.split_type, default_split_type),
    simplify_debts = coalesce((p_patch ->> 'simplify_debts')::boolean, simplify_debts),
    cover_image_path = case when p_patch ? 'cover_image_path' then p_patch ->> 'cover_image_path' else cover_image_path end
  where id = p_group_id
  returning * into v_after;

  if p_patch ? 'member_weights' then
    update public.group_members m set default_split_weight = (w ->> 'weight')::integer
    from jsonb_array_elements(p_patch -> 'member_weights') w
    where m.id = (w ->> 'member_id')::uuid and m.group_id = p_group_id;
  end if;

  v_split := v_after.default_split_type;
  if v_split = 'percentage' then
    select coalesce(sum(default_split_weight), 0) into v_weight_sum
    from public.group_members where group_id = p_group_id and left_at is null;
    if v_weight_sum <> 10000 then perform private.fail('Default percentages must add up to 100%.'); end if;
  elsif v_split = 'shares' then
    if exists (select 1 from public.group_members where group_id = p_group_id and left_at is null
               and default_split_weight is null) then
      perform private.fail('Every member needs a default share.');
    end if;
  end if;

  perform private.log_activity('group_updated', p_group_id, null, null, jsonb_build_object(
    'before', jsonb_build_object('name', v_before.name, 'type', v_before.type, 'default_currency', v_before.default_currency,
                                 'default_split_type', v_before.default_split_type, 'simplify_debts', v_before.simplify_debts),
    'after', jsonb_build_object('name', v_after.name, 'type', v_after.type, 'default_currency', v_after.default_currency,
                                'default_split_type', v_after.default_split_type, 'simplify_debts', v_after.simplify_debts)
  ));
end;
$$;

-- Adds a member by email (registered user, or an email placeholder auto-claimed at signup)
-- or a named placeholder. Returns {member_id, status: added|rejoined|invited|placeholder|already_member}.
create or replace function public.add_group_member(p_group_id uuid, p_email text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_email text := lower(nullif(trim(p_email), ''));
  v_name text := nullif(trim(p_name), '');
  v_user uuid;
  v_member public.group_members;
  v_status text;
begin
  if not private.is_group_member(p_group_id) then perform private.fail('You are not a member of this group.'); end if;
  if not exists (select 1 from public.groups where id = p_group_id and deleted_at is null) then
    perform private.fail('Group not found.');
  end if;
  if v_email is null and v_name is null then perform private.fail('Enter an email or a name.'); end if;

  if v_email is not null then
    select id into v_user from public.profiles where lower(email) = v_email;
  end if;

  if v_user is not null then
    select * into v_member from public.group_members where group_id = p_group_id and user_id = v_user;
    if found and v_member.left_at is null then
      return jsonb_build_object('member_id', v_member.id, 'status', 'already_member');
    elsif found then
      update public.group_members set left_at = null, joined_at = now() where id = v_member.id;
      v_status := 'rejoined';
    else
      insert into public.group_members (group_id, user_id) values (p_group_id, v_user) returning * into v_member;
      v_status := 'added';
    end if;
    perform private.befriend_group(v_user, p_group_id);
  else
    if v_email is not null and exists (
      select 1 from public.group_members
      where group_id = p_group_id and left_at is null and lower(placeholder_email) = v_email
    ) then
      perform private.fail('That email has already been invited to this group.');
    end if;
    insert into public.group_members (group_id, placeholder_name, placeholder_email)
    values (p_group_id, left(coalesce(v_name, split_part(v_email, '@', 1)), 80), v_email)
    returning * into v_member;
    v_status := case when v_email is null then 'placeholder' else 'invited' end;
  end if;

  perform private.log_activity('member_added', p_group_id, null, private.group_user_ids(p_group_id),
    jsonb_build_object('member_id', v_member.id, 'name', private.member_name(v_member.id)));
  return jsonb_build_object('member_id', v_member.id, 'status', v_status);
end;
$$;

-- Removes (or, for yourself, leaves). Balance must be settled first: checked by the
-- server action with lib/splits before calling.
create or replace function public.remove_group_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_member public.group_members;
  v_self boolean;
begin
  select * into v_member from public.group_members where id = p_member_id and left_at is null for update;
  if not found or not private.is_group_member(v_member.group_id) then
    perform private.fail('Member not found.');
  end if;
  v_self := v_member.user_id = v_uid;
  update public.group_members set left_at = now() where id = p_member_id;
  perform private.log_activity(
    case when v_self then 'member_left'::public.activity_action else 'member_removed'::public.activity_action end,
    v_member.group_id, null, private.group_user_ids(v_member.group_id) || v_member.user_id,
    jsonb_build_object('member_id', p_member_id, 'name', private.member_name(p_member_id)));
end;
$$;

create or replace function public.delete_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_auth();
begin
  if not private.is_group_member(p_group_id) then perform private.fail('You are not a member of this group.'); end if;
  update public.groups set deleted_at = now() where id = p_group_id and deleted_at is null;
  perform private.log_activity('group_deleted', p_group_id, null, private.group_user_ids(p_group_id),
    jsonb_build_object('name', (select name from public.groups where id = p_group_id)));
end;
$$;

-- ----------------------------------------------------------------- invites
create or replace function public.get_invite(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_invite public.invite_links;
  v_group public.groups;
  v_reason text;
begin
  select * into v_invite from public.invite_links where token = p_token;
  if not found or v_invite.group_id is null then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
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
  if not (v_info ->> 'valid')::boolean then perform private.fail('This invite link is no longer valid.'); end if;
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

-- ---------------------------------------------------------------- expenses
-- Point-in-time snapshot used for edit history (names captured as of the change).
create or replace function private.expense_snapshot(p_expense_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'description', e.description,
    'category', e.category,
    'expense_date', e.expense_date,
    'currency', e.currency,
    'total_minor', e.total_minor,
    'split_type', e.split_type,
    'notes', e.notes,
    'payers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id', coalesce(p.member_id, p.user_id),
        'user_id', coalesce(m.user_id, p.user_id),
        'name', coalesce(nullif(pr.display_name, ''), m.placeholder_name),
        'amount', p.paid_minor) order by p.paid_minor desc)
      from public.expense_payers p
      left join public.group_members m on m.id = p.member_id
      left join public.profiles pr on pr.id = coalesce(m.user_id, p.user_id)
      where p.expense_id = e.id), '[]'),
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id', coalesce(s.member_id, s.user_id),
        'user_id', coalesce(m.user_id, s.user_id),
        'name', coalesce(nullif(pr.display_name, ''), m.placeholder_name),
        'amount', s.owed_minor) order by s.owed_minor desc)
      from public.expense_shares s
      left join public.group_members m on m.id = s.member_id
      left join public.profiles pr on pr.id = coalesce(m.user_id, s.user_id)
      where s.expense_id = e.id), '[]')
  )
  from public.expenses e where e.id = p_expense_id;
$$;

create or replace function private.snapshot_user_ids(p_snapshot jsonb)
returns uuid[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct (x ->> 'user_id')::uuid) filter (where x ->> 'user_id' is not null), '{}')
  from jsonb_array_elements(coalesce(p_snapshot -> 'payers', '[]') || coalesce(p_snapshot -> 'shares', '[]')) x;
$$;

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
              trim(v_item.value ->> 'name'), v_item.value ->> 'original_name',
              coalesce((v_item.value ->> 'quantity')::int, 1), (v_item.value ->> 'unit_price_minor')::bigint,
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

create or replace function public.set_expense_deleted(p_expense_id uuid, p_deleted boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_row public.expenses;
  v_snapshot jsonb;
begin
  select * into v_row from public.expenses where id = p_expense_id for update;
  if not found or not private.can_access_expense(p_expense_id) then perform private.fail('Expense not found.'); end if;
  if v_row.is_deleted = p_deleted then return; end if;
  if not p_deleted and v_row.group_id is not null
     and not exists (select 1 from public.groups where id = v_row.group_id and deleted_at is null) then
    perform private.fail('The group for this expense was deleted.');
  end if;

  update public.expenses set
    is_deleted = p_deleted,
    deleted_at = case when p_deleted then now() end,
    deleted_by = case when p_deleted then v_uid end
  where id = p_expense_id;

  v_snapshot := private.expense_snapshot(p_expense_id);
  perform private.log_activity(
    case when p_deleted then 'expense_deleted'::public.activity_action else 'expense_restored'::public.activity_action end,
    v_row.group_id, p_expense_id, private.snapshot_user_ids(v_snapshot), jsonb_build_object('after', v_snapshot));
end;
$$;

-- --------------------------------------------------------------- privileges
revoke all on function
  public.send_friend_request(text), public.respond_friend_request(uuid, boolean),
  public.create_group(text, public.group_type, text, boolean), public.update_group(uuid, jsonb),
  public.add_group_member(uuid, text, text), public.remove_group_member(uuid), public.delete_group(uuid),
  public.get_invite(text), public.redeem_invite(text, uuid),
  public.save_expense(jsonb), public.set_expense_deleted(uuid, boolean)
from public, anon;
grant execute on function
  public.send_friend_request(text), public.respond_friend_request(uuid, boolean),
  public.create_group(text, public.group_type, text, boolean), public.update_group(uuid, jsonb),
  public.add_group_member(uuid, text, text), public.remove_group_member(uuid), public.delete_group(uuid),
  public.get_invite(text), public.redeem_invite(text, uuid),
  public.save_expense(jsonb), public.set_expense_deleted(uuid, boolean)
to authenticated;

-- Only the helpers referenced by RLS/storage policies need to be executable by users.
-- Everything else in `private` runs inside security-definer RPCs as the owner.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_group_member(uuid), private.is_friend(uuid), private.can_see_profile(uuid),
  private.can_access_expense(uuid), private.can_access_settlement(uuid), private.can_access_receipt(uuid),
  private.try_uuid(text)
to authenticated;

-- Activity is written only through these functions now.
drop policy activity_log_insert on public.activity_log;
revoke insert on public.activity_log from authenticated;
