-- SplitLens: shared types and helpers.
-- Money everywhere is BIGINT minor units + currency_code. Never floats.

create extension if not exists pg_trgm with schema extensions;

create domain public.currency_code as text
  check (value ~ '^[A-Z]{3}$');

create domain public.language_tag as text
  check (value ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');

create type public.friendship_status as enum ('pending', 'accepted');
create type public.group_type as enum ('home', 'trip', 'couple', 'other');
create type public.group_role as enum ('owner', 'member');
create type public.split_type as enum ('equal', 'exact', 'percentage', 'shares', 'adjustment', 'itemized');
create type public.expense_item_kind as enum ('item', 'tax', 'tip', 'service', 'discount', 'fee');
create type public.receipt_status as enum ('uploaded', 'processing', 'parsed', 'failed');
create type public.settlement_method as enum ('cash', 'bank_transfer', 'external_app', 'other');
create type public.recurrence_frequency as enum ('daily', 'weekly', 'biweekly', 'monthly', 'yearly');
create type public.sync_status as enum ('idle', 'running', 'succeeded', 'failed');
create type public.activity_action as enum (
  'expense_created', 'expense_updated', 'expense_deleted', 'expense_restored',
  'settlement_created', 'settlement_updated', 'settlement_deleted', 'settlement_restored',
  'comment_added', 'comment_deleted',
  'group_created', 'group_updated', 'group_deleted',
  'member_added', 'member_removed', 'member_left', 'placeholder_claimed',
  'friend_requested', 'friend_accepted', 'friend_removed',
  'receipt_parsed', 'recurring_expense_created',
  'splitwise_import_completed'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
