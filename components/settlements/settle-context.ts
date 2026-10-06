import type { SettlePerson, SettleUpInitial } from "@/components/settlements/settle-up-dialog";
import type { Person } from "@/lib/db/people";
import { toMajorString, type Debt } from "@/lib/splits";

export const toSettlePerson = (p: Person): SettlePerson => ({
  id: p.id,
  name: p.name,
  avatarUrl: p.avatarUrl,
  venmoUsername: p.venmoUsername ?? null,
  paypalUsername: p.paypalUsername ?? null,
});

/** Dialog defaults from a suggested debt, or a blank payment from me. */
export function initialFromDebt(debt: Debt | undefined, fallback: { from: string; to: string; currency: string }): SettleUpInitial {
  if (!debt) return { ...fallback, amount: "" };
  return { from: debt.from, to: debt.to, currency: debt.currency, amount: toMajorString(debt.amount, debt.currency) };
}
