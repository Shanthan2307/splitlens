-- SplitLens phase 5: settlements, comments, payment handles, activity for both.

-- ------------------------------------------------------------ payment handles
-- Used only to build Venmo / PayPal.me links; never verified or charged by SplitLens.
alter table public.profiles
  add column venmo_username text check (venmo_username ~ '^[A-Za-z0-9_-]{5,30}$'),
  add column paypal_username text check (paypal_username ~ '^[A-Za-z0-9]{1,20}$');
grant update (venmo_username, paypal_username) on public.profiles to authenticated;

alter table public.settlements
  add column external_provider text check (external_provider in ('venmo', 'paypal', 'other')),
  add constraint settlements_provider_matches_method
    check (external_provider is null or method = 'external_app');

-- All settlement and comment writes go through the RPCs below (so every change is logged).
revoke insert, update on public.settlements, public.comments from authenticated;
drop policy settlements_insert on public.settlements;
drop policy settlements_update on public.settlements;
drop policy comments_insert on public.comments;
drop policy comments_update on public.comments;

-- ------------------------------------------------------------------ helpers
create or replace function private.log_event(
  p_action public.activity_action,
  p_group_id uuid,
  p_expense_id uuid,
  p_settlement_id uuid,
  p_comment_id uuid,
  p_involved uuid[],
  p_payload jsonb
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.activity_log (actor_id, action, group_id, expense_id, settlement_id, comment_id, involved_user_ids, payload)
  values (
    auth.uid(), p_action, p_group_id, p_expense_id, p_settlement_id, p_comment_id,
    array(select distinct u from unnest(coalesce(p_involved, '{}') || auth.uid()) u where u is not null),
    coalesce(p_payload, '{}')
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Resolves a participant (member id or user id) to {user_id, name}.
create or replace function private.participant(p_member_id uuid, p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when p_member_id is not null then (
      select jsonb_build_object('participant_id', m.id, 'user_id', m.user_id,
                                'name', coalesce(nullif(p.display_name, ''), m.placeholder_name))
      from public.group_members m left join public.profiles p on p.id = m.user_id where m.id = p_member_id)
    else (
      select jsonb_build_object('participant_id', p.id, 'user_id', p.id, 'name', p.display_name)
      from public.profiles p where p.id = p_user_id)
  end;
$$;

create or replace function private.settlement_snapshot(p_settlement_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'from', private.participant(s.from_member_id, s.from_user_id),
    'to', private.participant(s.to_member_id, s.to_user_id),
    'amount_minor', s.amount_minor,
    'currency', s.currency,
    'settled_on', s.settled_on,
    'method', s.method,
    'external_provider', s.external_provider,
    'notes', s.notes
  )
  from public.settlements s where s.id = p_settlement_id;
$$;

create or replace function private.settlement_user_ids(p_snapshot jsonb)
returns uuid[] language sql immutable set search_path = '' as $$
  select array_remove(array[(p_snapshot -> 'from' ->> 'user_id')::uuid, (p_snapshot -> 'to' ->> 'user_id')::uuid], null);
$$;

-- -------------------------------------------------------------- settlements
/*
  p_settlement: {id?, group_id?, from_member_id | from_user_id, to_member_id | to_user_id,
                 amount_minor, currency, settled_on?, method, external_provider?, notes?}
  Group settlements use member ids; others use user ids (caller must be one side, the other a friend).
*/
create or replace function public.save_settlement(p_settlement jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_id uuid := nullif(p_settlement ->> 'id', '')::uuid;
  v_group uuid := nullif(p_settlement ->> 'group_id', '')::uuid;
  v_from_m uuid := nullif(p_settlement ->> 'from_member_id', '')::uuid;
  v_to_m uuid := nullif(p_settlement ->> 'to_member_id', '')::uuid;
  v_from_u uuid := nullif(p_settlement ->> 'from_user_id', '')::uuid;
  v_to_u uuid := nullif(p_settlement ->> 'to_user_id', '')::uuid;
  v_amount bigint := (p_settlement ->> 'amount_minor')::bigint;
  v_method public.settlement_method := coalesce((p_settlement ->> 'method')::public.settlement_method, 'cash');
  v_provider text := case when v_method = 'external_app' then nullif(p_settlement ->> 'external_provider', '') end;
  v_existing public.settlements;
  v_before jsonb;
  v_after jsonb;
begin
  if v_amount is null or v_amount <= 0 then perform private.fail('The payment amount must be more than zero.'); end if;

  if v_id is not null then
    select * into v_existing from public.settlements where id = v_id for update;
    if not found or v_existing.is_deleted or not private.can_access_settlement(v_id) then
      perform private.fail('Payment not found.');
    end if;
    if v_existing.group_id is distinct from v_group then perform private.fail('A payment cannot be moved between groups.'); end if;
    v_before := private.settlement_snapshot(v_id);
  end if;

  if coalesce(v_from_m, v_from_u) = coalesce(v_to_m, v_to_u) then
    perform private.fail('Someone can''t pay themselves.');
  end if;

  if v_group is not null then
    if not private.is_group_member(v_group)
       or not exists (select 1 from public.groups where id = v_group and deleted_at is null) then
      perform private.fail('You are not a member of this group.');
    end if;
    if v_from_u is not null or v_to_u is not null or v_from_m is null or v_to_m is null then
      perform private.fail('Choose who paid and who was paid.');
    end if;
    if (select count(*) from public.group_members
        where id in (v_from_m, v_to_m) and group_id = v_group and left_at is null) <> 2 then
      perform private.fail('Both people must be current group members.');
    end if;
  else
    if v_from_m is not null or v_to_m is not null or v_from_u is null or v_to_u is null then
      perform private.fail('Choose who paid and who was paid.');
    end if;
    if v_uid not in (v_from_u, v_to_u) then perform private.fail('You must be part of a payment outside a group.'); end if;
    if not private.is_friend(case when v_from_u = v_uid then v_to_u else v_from_u end) then
      perform private.fail('You can only record payments with friends.');
    end if;
  end if;

  if v_id is null then
    insert into public.settlements (group_id, from_member_id, from_user_id, to_member_id, to_user_id, amount_minor,
                                    currency, settled_on, method, external_provider, notes, created_by)
    values (v_group, v_from_m, v_from_u, v_to_m, v_to_u, v_amount, p_settlement ->> 'currency',
            coalesce((p_settlement ->> 'settled_on')::date, current_date), v_method, v_provider,
            nullif(trim(p_settlement ->> 'notes'), ''), v_uid)
    returning id into v_id;
  else
    update public.settlements set
      from_member_id = v_from_m, from_user_id = v_from_u, to_member_id = v_to_m, to_user_id = v_to_u,
      amount_minor = v_amount, currency = p_settlement ->> 'currency',
      settled_on = coalesce((p_settlement ->> 'settled_on')::date, settled_on),
      method = v_method, external_provider = v_provider, notes = nullif(trim(p_settlement ->> 'notes'), '')
    where id = v_id;
  end if;

  v_after := private.settlement_snapshot(v_id);
  perform private.log_event(
    case when v_before is null then 'settlement_created'::public.activity_action else 'settlement_updated'::public.activity_action end,
    v_group, null, v_id, null,
    private.settlement_user_ids(v_after) || private.settlement_user_ids(v_before),
    jsonb_build_object('before', v_before, 'after', v_after));
  return v_id;
end;
$$;

create or replace function public.set_settlement_deleted(p_settlement_id uuid, p_deleted boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_row public.settlements;
  v_snapshot jsonb;
begin
  select * into v_row from public.settlements where id = p_settlement_id for update;
  if not found or not private.can_access_settlement(p_settlement_id) then perform private.fail('Payment not found.'); end if;
  if v_row.is_deleted = p_deleted then return; end if;
  update public.settlements set
    is_deleted = p_deleted,
    deleted_at = case when p_deleted then now() end,
    deleted_by = case when p_deleted then v_uid end
  where id = p_settlement_id;
  v_snapshot := private.settlement_snapshot(p_settlement_id);
  perform private.log_event(
    case when p_deleted then 'settlement_deleted'::public.activity_action else 'settlement_restored'::public.activity_action end,
    v_row.group_id, null, p_settlement_id, null, private.settlement_user_ids(v_snapshot), jsonb_build_object('after', v_snapshot));
end;
$$;

-- ----------------------------------------------------------------- comments
create or replace function public.add_comment(p_expense_id uuid, p_settlement_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_body text := trim(p_body);
  v_id uuid;
  v_group uuid;
  v_involved uuid[];
  v_subject text;
begin
  if num_nonnulls(p_expense_id, p_settlement_id) <> 1 then perform private.fail('Comment on an expense or a payment.'); end if;
  if v_body is null or v_body = '' then perform private.fail('Write a comment first.'); end if;
  if char_length(v_body) > 4000 then perform private.fail('Comments can be at most 4000 characters.'); end if;

  if p_expense_id is not null then
    if not private.can_access_expense(p_expense_id) then perform private.fail('Expense not found.'); end if;
    select group_id, description into v_group, v_subject from public.expenses where id = p_expense_id;
    v_involved := private.snapshot_user_ids(private.expense_snapshot(p_expense_id));
  else
    if not private.can_access_settlement(p_settlement_id) then perform private.fail('Payment not found.'); end if;
    select group_id into v_group from public.settlements where id = p_settlement_id;
    v_involved := private.settlement_user_ids(private.settlement_snapshot(p_settlement_id));
    v_subject := 'a payment';
  end if;

  insert into public.comments (expense_id, settlement_id, author_id, body)
  values (p_expense_id, p_settlement_id, v_uid, v_body)
  returning id into v_id;

  perform private.log_event('comment_added', v_group, p_expense_id, p_settlement_id, v_id, v_involved,
    jsonb_build_object('body', left(v_body, 280), 'subject', v_subject));
  return v_id;
end;
$$;

create or replace function public.delete_comment(p_comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_row public.comments;
  v_group uuid;
begin
  select * into v_row from public.comments where id = p_comment_id and author_id = v_uid and not is_deleted for update;
  if not found then perform private.fail('You can only delete your own comments.'); end if;
  update public.comments set is_deleted = true where id = p_comment_id;
  select coalesce(
    (select group_id from public.expenses where id = v_row.expense_id),
    (select group_id from public.settlements where id = v_row.settlement_id)) into v_group;
  perform private.log_event('comment_deleted', v_group, v_row.expense_id, v_row.settlement_id, p_comment_id, null, '{}');
end;
$$;

-- --------------------------------------------------------------- privileges
revoke all on function
  public.save_settlement(jsonb), public.set_settlement_deleted(uuid, boolean),
  public.add_comment(uuid, uuid, text), public.delete_comment(uuid)
from public, anon;
grant execute on function
  public.save_settlement(jsonb), public.set_settlement_deleted(uuid, boolean),
  public.add_comment(uuid, uuid, text), public.delete_comment(uuid)
to authenticated;
revoke all on function
  private.log_event(public.activity_action, uuid, uuid, uuid, uuid, uuid[], jsonb),
  private.participant(uuid, uuid), private.settlement_snapshot(uuid), private.settlement_user_ids(jsonb)
from public, anon, authenticated;
