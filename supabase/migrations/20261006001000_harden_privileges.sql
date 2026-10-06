-- SplitLens v1 hardening (pre-production RLS review).
--
-- Principle: clients may write directly only where the app does so and RLS fully
-- describes what's allowed. Everything with cross-row integrity (sums, balances,
-- membership, activity logging) is writable only through the SECURITY DEFINER RPCs.
--
-- Direct client writes that remain (all RLS-checked):
--   profiles (update own, column-limited) · friendships (delete own) · invite_links ·
--   receipts · attachments · notifications (mark read) · notification_settings ·
--   recurring_rules (phase 10) · splitwise_connections (delete own)

-- 1. Never needed through the API; RLS doesn't apply to TRUNCATE.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- 2. Expenses and their children: only save_expense / set_expense_deleted may write.
--    (Direct writes could make shares stop summing to the total and corrupt balances.)
revoke insert, update, delete on public.expenses, public.expense_payers, public.expense_shares,
  public.expense_items, public.item_assignments from authenticated;
drop policy expenses_insert on public.expenses;
drop policy expenses_update on public.expenses;
drop policy expense_payers_all on public.expense_payers;
drop policy expense_shares_all on public.expense_shares;
drop policy expense_items_all on public.expense_items;
drop policy item_assignments_all on public.item_assignments;
create policy expense_payers_select on public.expense_payers for select to authenticated
  using (private.can_access_expense(expense_id));
create policy expense_shares_select on public.expense_shares for select to authenticated
  using (private.can_access_expense(expense_id));
create policy expense_items_select on public.expense_items for select to authenticated
  using (private.can_access_expense(expense_id));
create policy item_assignments_select on public.item_assignments for select to authenticated
  using (exists (select 1 from public.expense_items i where i.id = item_id and private.can_access_expense(i.expense_id)));

-- 3. Groups and members: create_group / update_group / add_group_member / remove_group_member /
--    delete_group / redeem_invite only. A hard DELETE on groups would cascade away every
--    member's expenses; direct member edits would skip balance checks and the activity log.
revoke insert, update, delete on public.groups, public.group_members from authenticated;
drop policy groups_insert on public.groups;
drop policy groups_update on public.groups;
drop policy groups_delete on public.groups;
drop policy group_members_insert on public.group_members;
drop policy group_members_update on public.group_members;
drop policy group_members_delete on public.group_members;

-- 4. Friend requests are created/accepted via RPCs (which log activity); deleting your own
--    friendship row (cancel / decline / unfriend) stays direct.
revoke insert, update on public.friendships from authenticated;
drop policy friendships_insert on public.friendships;
drop policy friendships_update on public.friendships;

-- 5. Tables with no client write path at all.
revoke insert, update, delete on public.activity_log, public.exchange_rates from authenticated;
revoke insert, delete on public.profiles, public.notification_settings from authenticated;
revoke insert on public.notifications from authenticated;
revoke delete on public.comments, public.settlements from authenticated;

-- 6. Attachments are served from Storage: allow only inert types (no HTML/SVG/JS).
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf', 'text/plain', 'text/csv']
where id = 'attachments';
