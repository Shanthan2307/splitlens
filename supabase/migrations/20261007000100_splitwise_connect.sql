-- SplitLens phase 9a: connecting a Splitwise account.
--
-- The server (service role) calls these after completing OAuth, so the Splitwise user id
-- is verified: it came from Splitwise's get_current_user with the user's own token.
-- They are executable by service_role only; the acting SplitLens user is passed in and
-- impersonated for the transaction so auth.uid()-based helpers and activity work as usual.

create or replace function private.as_user(p_user uuid)
returns void language plpgsql set search_path = '' as $$
begin
  if p_user is null then raise exception 'Missing user' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

-- Links a verified Splitwise account and claims group placeholders imported for it.
-- Returns the number of placeholders claimed.
create or replace function public.splitwise_link_account(p_user uuid, p_splitwise_user_id bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_claimed integer := 0;
begin
  perform private.as_user(p_user);
  if exists (select 1 from public.profiles where splitwise_user_id = p_splitwise_user_id and id <> p_user) then
    perform private.fail('This Splitwise account is already connected to another SplitLens account.');
  end if;
  update public.profiles set splitwise_user_id = p_splitwise_user_id where id = p_user;

  for r in
    select m.id, m.group_id, m.placeholder_name from public.group_members m
    join public.groups g on g.id = m.group_id and g.deleted_at is null
    where m.splitwise_user_id = p_splitwise_user_id and m.user_id is null and m.left_at is null
      and not exists (select 1 from public.group_members x where x.group_id = m.group_id and x.user_id = p_user)
    for update of m
  loop
    update public.group_members set user_id = p_user where id = r.id;
    perform private.befriend_group(p_user, r.group_id);
    perform private.log_activity('placeholder_claimed', r.group_id, null, private.group_user_ids(r.group_id),
      jsonb_build_object('member_id', r.id, 'name', r.placeholder_name, 'via', 'splitwise'));
    v_claimed := v_claimed + 1;
  end loop;
  return v_claimed;
end;
$$;

create or replace function public.splitwise_unlink_account(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.splitwise_connections where user_id = p_user;
  update public.profiles set splitwise_user_id = null where id = p_user;
end;
$$;

revoke all on function private.as_user(uuid) from public, anon, authenticated;
revoke all on function public.splitwise_link_account(uuid, bigint), public.splitwise_unlink_account(uuid)
  from public, anon, authenticated;
grant execute on function public.splitwise_link_account(uuid, bigint), public.splitwise_unlink_account(uuid)
  to service_role;
