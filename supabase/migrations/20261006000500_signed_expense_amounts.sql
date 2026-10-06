-- Refunds are stored as expenses with a negative total: payers "paid" a negative
-- amount and shares are negative. Every amount on an expense has the total's sign
-- (or is zero for shares); lib/splits produces this and the write RPC (phase 4) re-checks it.

alter table public.expenses drop constraint expenses_total_minor_check;
alter table public.expenses add constraint expenses_total_minor_check check (total_minor <> 0);

alter table public.expense_payers drop constraint expense_payers_paid_minor_check;
alter table public.expense_payers add constraint expense_payers_paid_minor_check check (paid_minor <> 0);

-- Sign must match the parent expense total; enforced in the write RPC (needs the parent row).
alter table public.expense_shares drop constraint expense_shares_owed_minor_check;
