-- SplitLens phase 6: linking receipts to expenses safely.

-- Only link a receipt the current user can access; otherwise drop the link rather than
-- failing the whole save (e.g. a scan that never completed) or linking someone else's receipt.
create or replace function private.check_expense_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.receipt_id is not null
     and (tg_op = 'INSERT' or new.receipt_id is distinct from old.receipt_id)
     and not exists (select 1 from public.receipts r where r.id = new.receipt_id and private.can_access_receipt(r.id)) then
    new.receipt_id := null;
  end if;
  return new;
end;
$$;

create trigger check_expense_receipt
  before insert or update of receipt_id on public.expenses
  for each row execute function private.check_expense_receipt();

-- A receipt used for a group expense becomes visible to that group's members.
create or replace function private.share_receipt_with_group()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.receipt_id is not null and new.group_id is not null then
    update public.receipts set group_id = new.group_id where id = new.receipt_id and group_id is null;
  end if;
  return new;
end;
$$;

create trigger share_receipt_with_group
  after insert or update of receipt_id on public.expenses
  for each row execute function private.share_receipt_with_group();

revoke all on function private.check_expense_receipt(), private.share_receipt_with_group() from public, anon, authenticated;
