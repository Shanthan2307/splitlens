-- SplitLens: auth hooks, storage buckets + policies, realtime publication.

-- ------------------------------------------------------- new user bootstrap
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
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
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- Storage path segments are user-controlled; never let a bad uuid raise inside a policy.
create or replace function private.try_uuid(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;
grant execute on function private.try_uuid(text) to authenticated;

-- ----------------------------------------------------------------- storage
-- Path conventions:
--   avatars/{user_id}/{file}            public read, owner write
--   group-covers/{group_id}/{file}      public read, member write
--   receipts/{user_id}/{file}           private; uploader + anyone who can access the receipt row
--   attachments/{expense_id}/{file}     private; anyone who can access the expense
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',      'avatars',      true,  2 * 1024 * 1024,  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('group-covers', 'group-covers', true,  5 * 1024 * 1024,  array['image/jpeg', 'image/png', 'image/webp']),
  ('receipts',     'receipts',     false, 10 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']),
  ('attachments',  'attachments',  false, 10 * 1024 * 1024, null)
on conflict (id) do nothing;

-- Upserts need SELECT on the existing object; public URLs don't go through RLS.
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy group_covers_read on storage.objects for select to authenticated
  using (bucket_id = 'group-covers'
    and private.is_group_member(private.try_uuid((storage.foldername(name))[1])));
create policy group_covers_write on storage.objects for insert to authenticated
  with check (bucket_id = 'group-covers'
    and private.is_group_member(private.try_uuid((storage.foldername(name))[1])));
create policy group_covers_update on storage.objects for update to authenticated
  using (bucket_id = 'group-covers'
    and private.is_group_member(private.try_uuid((storage.foldername(name))[1])));
create policy group_covers_delete on storage.objects for delete to authenticated
  using (bucket_id = 'group-covers'
    and private.is_group_member(private.try_uuid((storage.foldername(name))[1])));

create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.receipts r
               where r.storage_path = name and private.can_access_receipt(r.id))));
create policy receipts_write on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments'
    and private.can_access_expense(private.try_uuid((storage.foldername(name))[1])));
create policy attachments_write on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments'
    and private.can_access_expense(private.try_uuid((storage.foldername(name))[1])));
create policy attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and owner_id = (select auth.uid())::text);

-- ---------------------------------------------------------------- realtime
-- postgres_changes respects RLS, so subscribers only receive rows they can select.
alter publication supabase_realtime add table
  public.expenses, public.expense_shares, public.expense_payers, public.settlements,
  public.comments, public.activity_log, public.notifications, public.group_members,
  public.receipts, public.friendships;
