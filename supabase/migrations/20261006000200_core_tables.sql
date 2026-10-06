-- SplitLens: all tables for phases 2–12.
--
-- Participants: an expense/settlement participant is EITHER a group member
-- (member_id, for group expenses; may be a placeholder with no account) OR a
-- user (user_id, for friend-only expenses with group_id null). Exactly one is set.

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  display_name       text not null default '' check (char_length(display_name) <= 80),
  email              text,
  avatar_url         text,
  default_currency   public.currency_code not null default 'USD',
  preferred_language public.language_tag not null default 'en',
  splitwise_user_id  bigint unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));

-- ------------------------------------------------------------- friendships
create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status       public.friendship_status not null default 'pending',
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  updated_at   timestamptz not null default now(),
  check (requester_id <> addressee_id),
  check ((status = 'accepted') = (accepted_at is not null))
);
-- One friendship per unordered pair.
create unique index friendships_pair_uidx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id, status);
create index friendships_requester_idx on public.friendships (requester_id, status);

-- ------------------------------------------------------------------ groups
create table public.groups (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 1 and 100),
  type               public.group_type not null default 'other',
  cover_image_path   text,
  default_currency   public.currency_code not null default 'USD',
  default_split_type public.split_type not null default 'equal'
                     check (default_split_type in ('equal', 'percentage', 'shares')),
  simplify_debts     boolean not null default true,
  created_by         uuid references public.profiles (id) on delete set null,
  splitwise_group_id bigint unique,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index groups_created_by_idx on public.groups (created_by);

-- ----------------------------------------------------------- group_members
create table public.group_members (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.groups (id) on delete cascade,
  user_id           uuid references public.profiles (id) on delete restrict,
  -- Placeholder members (no account yet): name required, email optional for invites.
  placeholder_name  text check (char_length(placeholder_name) between 1 and 80),
  placeholder_email text,
  splitwise_user_id bigint,
  role              public.group_role not null default 'member',
  -- Per-member weight for the group's default_split_type
  -- (percentage: basis points, 10000 = 100%; shares: share count). Null = equal.
  default_split_weight integer check (default_split_weight >= 0),
  joined_at         timestamptz not null default now(),
  left_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (user_id is not null or placeholder_name is not null)
);
create unique index group_members_group_user_uidx
  on public.group_members (group_id, user_id) where user_id is not null;
create unique index group_members_group_splitwise_uidx
  on public.group_members (group_id, splitwise_user_id) where splitwise_user_id is not null;
create index group_members_user_idx on public.group_members (user_id) where left_at is null;

-- ---------------------------------------------------------------- receipts
create table public.receipts (
  id              uuid primary key default gen_random_uuid(),
  uploaded_by     uuid not null references public.profiles (id) on delete cascade,
  group_id        uuid references public.groups (id) on delete set null,
  storage_path    text not null unique,
  mime_type       text not null,
  source_language public.language_tag,
  target_language public.language_tag,
  status          public.receipt_status not null default 'uploaded',
  model           text,
  raw_model_json  jsonb,
  -- Zod-validated parse result (merchant, date, currency, items in minor units).
  parsed          jsonb,
  merchant_name   text,
  receipt_date    date,
  currency        public.currency_code,
  total_minor     bigint,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index receipts_uploaded_by_idx on public.receipts (uploaded_by, created_at desc);
create index receipts_group_idx on public.receipts (group_id) where group_id is not null;

-- --------------------------------------------------------- recurring_rules
create table public.recurring_rules (
  id           uuid primary key default gen_random_uuid(),
  created_by   uuid not null references public.profiles (id) on delete cascade,
  group_id     uuid references public.groups (id) on delete cascade,
  -- Zod-validated expense draft: description, category, currency, total, payers, shares.
  template     jsonb not null,
  frequency    public.recurrence_frequency not null,
  interval_count integer not null default 1 check (interval_count between 1 and 365),
  start_date   date not null,
  end_date     date check (end_date is null or end_date >= start_date),
  next_run_on  date not null,
  timezone     text not null default 'UTC',
  is_active    boolean not null default true,
  last_run_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index recurring_rules_due_idx on public.recurring_rules (next_run_on) where is_active;
create index recurring_rules_group_idx on public.recurring_rules (group_id);
create index recurring_rules_created_by_idx on public.recurring_rules (created_by);

-- ---------------------------------------------------------------- expenses
create table public.expenses (
  id                   uuid primary key default gen_random_uuid(),
  group_id             uuid references public.groups (id) on delete cascade,
  description          text not null check (char_length(description) between 1 and 200),
  category             text not null default 'general' check (char_length(category) <= 50),
  expense_date         date not null default current_date,
  currency             public.currency_code not null,
  total_minor          bigint not null check (total_minor > 0),
  split_type           public.split_type not null default 'equal',
  notes                text check (char_length(notes) <= 2000),
  created_by           uuid references public.profiles (id) on delete set null,
  updated_by           uuid references public.profiles (id) on delete set null,
  is_deleted           boolean not null default false,
  deleted_at           timestamptz,
  deleted_by           uuid references public.profiles (id) on delete set null,
  receipt_id           uuid references public.receipts (id) on delete set null,
  recurring_rule_id    uuid references public.recurring_rules (id) on delete set null,
  splitwise_expense_id bigint unique,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (is_deleted = (deleted_at is not null))
);
create index expenses_group_date_idx on public.expenses (group_id, expense_date desc) where not is_deleted;
create index expenses_created_by_idx on public.expenses (created_by);
create index expenses_receipt_idx on public.expenses (receipt_id) where receipt_id is not null;
create index expenses_recurring_idx on public.expenses (recurring_rule_id) where recurring_rule_id is not null;
create index expenses_description_trgm_idx on public.expenses using gin (description extensions.gin_trgm_ops);

-- --------------------------------------------------------- expense_payers
create table public.expense_payers (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references public.expenses (id) on delete cascade,
  member_id   uuid references public.group_members (id) on delete restrict,
  user_id     uuid references public.profiles (id) on delete restrict,
  paid_minor  bigint not null check (paid_minor > 0),
  check (num_nonnulls(member_id, user_id) = 1)
);
create unique index expense_payers_member_uidx on public.expense_payers (expense_id, member_id) where member_id is not null;
create unique index expense_payers_user_uidx on public.expense_payers (expense_id, user_id) where user_id is not null;
create index expense_payers_member_idx on public.expense_payers (member_id) where member_id is not null;
create index expense_payers_user_idx on public.expense_payers (user_id) where user_id is not null;

-- --------------------------------------------------------- expense_shares
-- Final amount each participant owes. Sum of owed_minor = expense total (enforced in RPC).
create table public.expense_shares (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references public.expenses (id) on delete cascade,
  member_id    uuid references public.group_members (id) on delete restrict,
  user_id      uuid references public.profiles (id) on delete restrict,
  owed_minor   bigint not null check (owed_minor >= 0),
  -- The raw input that produced owed_minor, interpreted by split_type:
  -- exact/adjustment: minor units; percentage: basis points; shares: share count (x10000).
  split_input  bigint,
  check (num_nonnulls(member_id, user_id) = 1)
);
create unique index expense_shares_member_uidx on public.expense_shares (expense_id, member_id) where member_id is not null;
create unique index expense_shares_user_uidx on public.expense_shares (expense_id, user_id) where user_id is not null;
create index expense_shares_member_idx on public.expense_shares (member_id) where member_id is not null;
create index expense_shares_user_idx on public.expense_shares (user_id) where user_id is not null;

-- ---------------------------------------------------------- expense_items
create table public.expense_items (
  id             uuid primary key default gen_random_uuid(),
  expense_id     uuid not null references public.expenses (id) on delete cascade,
  position       integer not null default 0,
  kind           public.expense_item_kind not null default 'item',
  name           text not null check (char_length(name) between 1 and 200),
  -- Name as printed on the receipt, before translation.
  original_name  text,
  quantity       integer not null default 1 check (quantity > 0),
  unit_price_minor bigint,
  -- Signed: discounts are negative.
  total_minor    bigint not null,
  created_at     timestamptz not null default now()
);
create index expense_items_expense_idx on public.expense_items (expense_id, position);

-- -------------------------------------------------------- item_assignments
create table public.item_assignments (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.expense_items (id) on delete cascade,
  member_id  uuid references public.group_members (id) on delete restrict,
  user_id    uuid references public.profiles (id) on delete restrict,
  -- Relative weight within the item (1 = one equal portion).
  share_weight integer not null default 1 check (share_weight > 0),
  check (num_nonnulls(member_id, user_id) = 1)
);
create unique index item_assignments_member_uidx on public.item_assignments (item_id, member_id) where member_id is not null;
create unique index item_assignments_user_uidx on public.item_assignments (item_id, user_id) where user_id is not null;
create index item_assignments_member_idx on public.item_assignments (member_id) where member_id is not null;
create index item_assignments_user_idx on public.item_assignments (user_id) where user_id is not null;

-- ------------------------------------------------------------- settlements
create table public.settlements (
  id                   uuid primary key default gen_random_uuid(),
  group_id             uuid references public.groups (id) on delete cascade,
  from_member_id       uuid references public.group_members (id) on delete restrict,
  from_user_id         uuid references public.profiles (id) on delete restrict,
  to_member_id         uuid references public.group_members (id) on delete restrict,
  to_user_id           uuid references public.profiles (id) on delete restrict,
  amount_minor         bigint not null check (amount_minor > 0),
  currency             public.currency_code not null,
  settled_on           date not null default current_date,
  method               public.settlement_method not null default 'cash',
  notes                text check (char_length(notes) <= 2000),
  created_by           uuid references public.profiles (id) on delete set null,
  is_deleted           boolean not null default false,
  deleted_at           timestamptz,
  deleted_by           uuid references public.profiles (id) on delete set null,
  splitwise_expense_id bigint unique,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (num_nonnulls(from_member_id, from_user_id) = 1),
  check (num_nonnulls(to_member_id, to_user_id) = 1),
  check ((group_id is null) = (from_member_id is null and to_member_id is null)),
  check (is_deleted = (deleted_at is not null))
);
create index settlements_group_idx on public.settlements (group_id, settled_on desc) where not is_deleted;
create index settlements_from_user_idx on public.settlements (from_user_id) where from_user_id is not null;
create index settlements_to_user_idx on public.settlements (to_user_id) where to_user_id is not null;
create index settlements_from_member_idx on public.settlements (from_member_id) where from_member_id is not null;
create index settlements_to_member_idx on public.settlements (to_member_id) where to_member_id is not null;

-- ---------------------------------------------------------------- comments
create table public.comments (
  id                   uuid primary key default gen_random_uuid(),
  expense_id           uuid references public.expenses (id) on delete cascade,
  settlement_id        uuid references public.settlements (id) on delete cascade,
  author_id            uuid references public.profiles (id) on delete set null,
  body                 text not null check (char_length(body) between 1 and 4000),
  is_deleted           boolean not null default false,
  splitwise_comment_id bigint unique,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (num_nonnulls(expense_id, settlement_id) = 1)
);
create index comments_expense_idx on public.comments (expense_id, created_at) where expense_id is not null;
create index comments_settlement_idx on public.comments (settlement_id, created_at) where settlement_id is not null;

-- ------------------------------------------------------------ activity_log
create table public.activity_log (
  id                bigint generated always as identity primary key,
  actor_id          uuid references public.profiles (id) on delete set null,
  action            public.activity_action not null,
  group_id          uuid references public.groups (id) on delete cascade,
  expense_id        uuid references public.expenses (id) on delete cascade,
  settlement_id     uuid references public.settlements (id) on delete cascade,
  comment_id        uuid references public.comments (id) on delete set null,
  -- Everyone who should see this entry (participants), for friend-only items.
  involved_user_ids uuid[] not null default '{}',
  -- Snapshot for rendering (description, amounts, before/after diffs).
  payload           jsonb not null default '{}',
  created_at        timestamptz not null default now()
);
create index activity_log_group_idx on public.activity_log (group_id, created_at desc) where group_id is not null;
create index activity_log_involved_idx on public.activity_log using gin (involved_user_ids);
create index activity_log_actor_idx on public.activity_log (actor_id, created_at desc);
create index activity_log_expense_idx on public.activity_log (expense_id) where expense_id is not null;

-- ----------------------------------------------------------- notifications
create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  activity_id bigint references public.activity_log (id) on delete cascade,
  kind        text not null,
  payload     jsonb not null default '{}',
  read_at     timestamptz,
  emailed_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ------------------------------------------------------------- attachments
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references public.expenses (id) on delete cascade,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   integer not null check (size_bytes > 0),
  created_at   timestamptz not null default now()
);
create index attachments_expense_idx on public.attachments (expense_id);

-- ------------------------------------------------------------ invite_links
create table public.invite_links (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  created_by  uuid not null references public.profiles (id) on delete cascade,
  -- null group_id = invite to become friends with created_by.
  group_id    uuid references public.groups (id) on delete cascade,
  -- Optional: redeeming claims this placeholder member.
  member_id   uuid references public.group_members (id) on delete cascade,
  email       text,
  max_uses    integer check (max_uses is null or max_uses > 0),
  use_count   integer not null default 0 check (use_count >= 0),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (member_id is null or group_id is not null)
);
create index invite_links_group_idx on public.invite_links (group_id) where group_id is not null;
create index invite_links_created_by_idx on public.invite_links (created_by);

-- --------------------------------------------------- notification_settings
create table public.notification_settings (
  user_id               uuid primary key references public.profiles (id) on delete cascade,
  email_expense_added   boolean not null default true,
  email_expense_updated boolean not null default true,
  email_comment_added   boolean not null default true,
  email_settlement      boolean not null default true,
  email_friend_added    boolean not null default true,
  email_group_added     boolean not null default true,
  email_monthly_summary boolean not null default false,
  push_enabled          boolean not null default false,
  updated_at            timestamptz not null default now()
);

-- -------------------------------------------------- splitwise_connections
-- Tokens are AES-256-GCM encrypted by the server before insert; never readable by clients.
create table public.splitwise_connections (
  user_id                 uuid primary key references public.profiles (id) on delete cascade,
  splitwise_user_id       bigint not null,
  access_token_encrypted  text not null,
  refresh_token_encrypted text,
  token_expires_at        timestamptz,
  scope                   text,
  sync_status             public.sync_status not null default 'idle',
  sync_error              text,
  last_synced_at          timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- --------------------------------------------------------- exchange_rates
-- 1 base = rate quote, as an exact decimal. Conversion math happens in lib/splits.
create table public.exchange_rates (
  base_currency  public.currency_code not null,
  quote_currency public.currency_code not null,
  rate_date      date not null,
  rate           numeric(24, 12) not null check (rate > 0),
  source         text not null,
  fetched_at     timestamptz not null default now(),
  primary key (base_currency, quote_currency, rate_date)
);
create index exchange_rates_lookup_idx on public.exchange_rates (base_currency, quote_currency, rate_date desc);

-- ------------------------------------------------------- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'friendships', 'groups', 'group_members', 'receipts', 'recurring_rules',
    'expenses', 'settlements', 'comments', 'notification_settings', 'splitwise_connections'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;
