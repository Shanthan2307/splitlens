import { netBalances, pairwiseDebts, type LedgerEntry } from "./balances";
import { simplifyDebts } from "./simplify";
import type { Debt } from "./types";

/** A group's outstanding debts, simplified or not according to the group's simplify_debts flag. */
export function groupDebts(entries: readonly LedgerEntry[], options: { simplify: boolean }): Debt[] {
  return options.simplify ? simplifyDebts(netBalances(entries)) : pairwiseDebts(entries);
}
