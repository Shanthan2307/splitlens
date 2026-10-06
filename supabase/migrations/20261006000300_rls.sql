-- SplitLens: Row Level Security on every table.
-- Helper functions are SECURITY DEFINER so policies can consult other tables
-- without recursive RLS evaluation. They only ever answer about auth.uid().

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id and m.user_id = (select auth.uid()) and m.left_at is null
  );
$$;

create or replace function private.is_friend(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = (select auth.uid()) and f.addressee_id = p_user_id)
        or (f.addressee_id = (select auth.uid()) and f.requester_id = p_user_id))
  );
$$;

-- Can the current user see this profile? (self, any friendship incl. pending, or a shared group)
create or replace function private.can_see_profile(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id = (select auth.uid())
    or exists (
      select 1 from public.friendships f
      where (f.requester_id = (select auth.uid()) and f.addressee_id = p_user_id)
         or (f.addressee_id = (select auth.uid()) and f.requester_id = p_user_id))
    or exists (
      select 1 from public.group_members a
      join public.group_members b on b.group_id = a.group_id
      where a.user_id = (select auth.uid()) and a.left_at is null and b.user_id = p_user_id);
$$;

create or replace function private.can_access_expense(p_expense_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.expenses e
    where e.id = p_expense_id
      and (
        (e.group_id is not null and private.is_group_member(e.group_id))
        or (e.group_id is null and (
          e.created_by = (select auth.uid())
          or exists (select 1 from public.expense_payers p where p.expense_id = e.id and p.user_id = (select auth.uid()))
          or exists (select 1 from public.expense_shares s where s.expense_id = e.id and s.user_id = (select auth.uid()))
        ))
      )
  );
$$;

create or replace function private.can_access_settlement(p_settlement_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.settlements s
    where s.id = p_settlement_id
      and (
        (s.group_id is not null and private.is_group_member(s.group_id))
        or (s.group_id is null and (select auth.uid()) in (s.created_by, s.from_user_id, s.to_user_id))
      )
  );
$$;

create or replace function private.can_access_receipt(p_receipt_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.receipts r
    where r.id = p_receipt_id
      and (
        r.uploaded_by = (select auth.uid())
        or (r.group_id is not null and private.is_group_member(r.group_id))
        or exists (select 1 from public.expenses e where e.receipt_id = r.id and private.can_access_expense(e.id))
      )
  );
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

alter table public.profiles              enable row level security;
alter table public.friendships           enable row level security;
alter table public.groups                enable row level security;
alter table public.group_members         enable row level security;
alter table public.receipts              enable row level security;
alter table public.recurring_rules       enable row level security;
alter table public.expenses              enable row level security;
alter table public.expense_payers        enable row level security;
alter table public.expense_shares        enable row level security;
alter table public.expense_items         enable row level security;
alter table public.item_assignments      enable row level security;
alter table public.settlements           enable row level security;
alter table public.comments              enable row level security;
alter table public.activity_log          enable row level security;
alter table public.notifications         enable row level security;
alter table public.attachments           enable row level security;
alter table public.invite_links          enable row level security;
alter table public.notification_settings enable row level security;
alter table public.splitwise_connections enable row level security;
alter table public.exchange_rates        enable row level security;

-- Nothing is readable anonymously.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------- profiles
-- Rows are created by the auth trigger (security definer); never inserted by clients.
create policy profiles_select on public.profiles for select to authenticated
  using (private.can_see_profile(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ------------------------------------------------------------- friendships
create policy friendships_select on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
create policy friendships_insert on public.friendships for insert to authenticated
  with check (requester_id = (select auth.uid()) and status = 'pending');
-- Only the addressee accepts.
create policy friendships_update on public.friendships for update to authenticated
  using (addressee_id = (select auth.uid()))
  with check (addressee_id = (select auth.uid()));
create policy friendships_delete on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- ------------------------------------------------------------------ groups
create policy groups_select on public.groups for select to authenticated
  using (private.is_group_member(id) or created_by = (select auth.uid()));
create policy groups_insert on public.groups for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy groups_update on public.groups for update to authenticated
  using (private.is_group_member(id)) with check (private.is_group_member(id));
create policy groups_delete on public.groups for delete to authenticated
  using (created_by = (select auth.uid()));

-- ----------------------------------------------------------- group_members
create policy group_members_select on public.group_members for select to authenticated
  using (private.is_group_member(group_id) or user_id = (select auth.uid()));
-- Members add others; the creator bootstraps their own membership.
create policy group_members_insert on public.group_members for insert to authenticated
  with check (
    private.is_group_member(group_id)
    or (user_id = (select auth.uid())
        and exists (select 1 from public.groups g where g.id = group_id and g.created_by = (select auth.uid())))
  );
create policy group_members_update on public.group_members for update to authenticated
  using (private.is_group_member(group_id)) with check (private.is_group_member(group_id));
create policy group_members_delete on public.group_members for delete to authenticated
  using (private.is_group_member(group_id));

-- ---------------------------------------------------------------- receipts
create policy receipts_select on public.receipts for select to authenticated
  using (private.can_access_receipt(id));
create policy receipts_insert on public.receipts for insert to authenticated
  with check (uploaded_by = (select auth.uid())
              and (group_id is null or private.is_group_member(group_id)));
create policy receipts_update on public.receipts for update to authenticated
  using (private.can_access_receipt(id))
  with check (group_id is null or private.is_group_member(group_id));
create policy receipts_delete on public.receipts for delete to authenticated
  using (uploaded_by = (select auth.uid()));

-- --------------------------------------------------------- recurring_rules
create policy recurring_rules_select on public.recurring_rules for select to authenticated
  using (created_by = (select auth.uid()) or (group_id is not null and private.is_group_member(group_id)));
create policy recurring_rules_insert on public.recurring_rules for insert to authenticated
  with check (created_by = (select auth.uid()) and (group_id is null or private.is_group_member(group_id)));
create policy recurring_rules_update on public.recurring_rules for update to authenticated
  using (created_by = (select auth.uid()) or (group_id is not null and private.is_group_member(group_id)))
  with check (group_id is null or private.is_group_member(group_id));
create policy recurring_rules_delete on public.recurring_rules for delete to authenticated
  using (created_by = (select auth.uid()) or (group_id is not null and private.is_group_member(group_id)));

-- ---------------------------------------------------------------- expenses
-- Hard deletes are not allowed; use is_deleted.
create policy expenses_select on public.expenses for select to authenticated
  using (private.can_access_expense(id) or created_by = (select auth.uid()));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (created_by = (select auth.uid()) and (group_id is null or private.is_group_member(group_id)));
create policy expenses_update on public.expenses for update to authenticated
  using (private.can_access_expense(id))
  with check (group_id is null or private.is_group_member(group_id));

-- ------------------------------------- expense children (payers, shares, items)
create policy expense_payers_all on public.expense_payers for all to authenticated
  using (private.can_access_expense(expense_id)) with check (private.can_access_expense(expense_id));
create policy expense_shares_all on public.expense_shares for all to authenticated
  using (private.can_access_expense(expense_id)) with check (private.can_access_expense(expense_id));
create policy expense_items_all on public.expense_items for all to authenticated
  using (private.can_access_expense(expense_id)) with check (private.can_access_expense(expense_id));
create policy item_assignments_all on public.item_assignments for all to authenticated
  using (exists (select 1 from public.expense_items i where i.id = item_id and private.can_access_expense(i.expense_id)))
  with check (exists (select 1 from public.expense_items i where i.id = item_id and private.can_access_expense(i.expense_id)));

-- ------------------------------------------------------------- settlements
create policy settlements_select on public.settlements for select to authenticated
  using (private.can_access_settlement(id));
create policy settlements_insert on public.settlements for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (group_id is not null and private.is_group_member(group_id))
      or (group_id is null and (select auth.uid()) in (from_user_id, to_user_id))
    )
  );
create policy settlements_update on public.settlements for update to authenticated
  using (private.can_access_settlement(id))
  with check (
    (group_id is not null and private.is_group_member(group_id))
    or (group_id is null and (select auth.uid()) in (from_user_id, to_user_id))
  );

-- ---------------------------------------------------------------- comments
create policy comments_select on public.comments for select to authenticated
  using ((expense_id is not null and private.can_access_expense(expense_id))
      or (settlement_id is not null and private.can_access_settlement(settlement_id)));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid())
    and ((expense_id is not null and private.can_access_expense(expense_id))
      or (settlement_id is not null and private.can_access_settlement(settlement_id))));
create policy comments_update on public.comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

-- ------------------------------------------------------------ activity_log
-- Append-only.
create policy activity_log_select on public.activity_log for select to authenticated
  using (actor_id = (select auth.uid())
      or (select auth.uid()) = any (involved_user_ids)
      or (group_id is not null and private.is_group_member(group_id)));
create policy activity_log_insert on public.activity_log for insert to authenticated
  with check (actor_id = (select auth.uid())
    and (group_id is null or private.is_group_member(group_id)));

-- ----------------------------------------------------------- notifications
-- Created server-side; users read and mark read.
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------- attachments
create policy attachments_select on public.attachments for select to authenticated
  using (private.can_access_expense(expense_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and private.can_access_expense(expense_id));
create policy attachments_delete on public.attachments for delete to authenticated
  using (uploaded_by = (select auth.uid()));

-- ------------------------------------------------------------ invite_links
-- Redemption by token goes through a security-definer RPC (phase 4), not direct select.
create policy invite_links_select on public.invite_links for select to authenticated
  using (created_by = (select auth.uid()) or (group_id is not null and private.is_group_member(group_id)));
create policy invite_links_insert on public.invite_links for insert to authenticated
  with check (created_by = (select auth.uid()) and (group_id is null or private.is_group_member(group_id)));
create policy invite_links_update on public.invite_links for update to authenticated
  using (created_by = (select auth.uid()) or (group_id is not null and private.is_group_member(group_id)))
  with check (group_id is null or private.is_group_member(group_id));
create policy invite_links_delete on public.invite_links for delete to authenticated
  using (created_by = (select auth.uid()) or (group_id is not null and private.is_group_member(group_id)));

-- --------------------------------------------------- notification_settings
create policy notification_settings_select on public.notification_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_settings_insert on public.notification_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy notification_settings_update on public.notification_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- -------------------------------------------------- splitwise_connections
-- Clients may read their own connection status but never the token columns.
-- All writes happen server-side with the service role.
revoke all on public.splitwise_connections from authenticated;
grant select (user_id, splitwise_user_id, token_expires_at, scope, sync_status, sync_error,
              last_synced_at, created_at, updated_at)
  on public.splitwise_connections to authenticated;
grant delete on public.splitwise_connections to authenticated;
create policy splitwise_connections_select on public.splitwise_connections for select to authenticated
  using (user_id = (select auth.uid()));
create policy splitwise_connections_delete on public.splitwise_connections for delete to authenticated
  using (user_id = (select auth.uid()));

-- --------------------------------------------------------- exchange_rates
-- Read-only cache for users; written by the server with the service role.
create policy exchange_rates_select on public.exchange_rates for select to authenticated
  using (true);
revoke insert, update, delete on public.exchange_rates from authenticated;

-- ------------------------------------------------------ column-level grants
-- A table-level UPDATE grant covers every column, so restrict UPDATE to the
-- columns users may change directly. Identity/ownership columns (ids, created_by,
-- user_id links, splitwise ids, counters) change only via security-definer RPCs
-- or the service role.
revoke update on
  public.profiles, public.friendships, public.groups, public.group_members, public.receipts,
  public.recurring_rules, public.expenses, public.settlements, public.comments,
  public.notifications, public.invite_links, public.notification_settings
from authenticated;

grant update (display_name, avatar_url, default_currency, preferred_language)
  on public.profiles to authenticated;
grant update (status, accepted_at)
  on public.friendships to authenticated;
grant update (name, type, cover_image_path, default_currency, default_split_type, simplify_debts, deleted_at)
  on public.groups to authenticated;
grant update (placeholder_name, placeholder_email, role, default_split_weight, left_at)
  on public.group_members to authenticated;
grant update (group_id, source_language, target_language, status, model, raw_model_json, parsed,
              merchant_name, receipt_date, currency, total_minor, error_message)
  on public.receipts to authenticated;
grant update (template, frequency, interval_count, start_date, end_date, next_run_on, timezone, is_active)
  on public.recurring_rules to authenticated;
grant update (group_id, description, category, expense_date, currency, total_minor, split_type, notes,
              updated_by, is_deleted, deleted_at, deleted_by, receipt_id)
  on public.expenses to authenticated;
grant update (amount_minor, currency, settled_on, method, notes, is_deleted, deleted_at, deleted_by)
  on public.settlements to authenticated;
grant update (body, is_deleted)
  on public.comments to authenticated;
grant update (read_at)
  on public.notifications to authenticated;
grant update (email, max_uses, expires_at, revoked_at)
  on public.invite_links to authenticated;
grant update (email_expense_added, email_expense_updated, email_comment_added, email_settlement,
              email_friend_added, email_group_added, email_monthly_summary, push_enabled)
  on public.notification_settings to authenticated;
