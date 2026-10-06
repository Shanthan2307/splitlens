import { SplitError } from "./errors";
import { parseMajor, type Minor } from "./money";

export type SettlementAmountResult = { ok: true; amount: Minor } | { ok: false; message: string };

/** Parses a payment amount typed in major units; must be positive. */
export function parseSettlementAmount(input: string, currency: string): SettlementAmountResult {
  if (input.trim() === "") return { ok: false, message: "Enter an amount" };
  let amount: Minor;
  try {
    amount = parseMajor(input, currency);
  } catch (error) {
    return { ok: false, message: (error as SplitError).message };
  }
  if (amount <= 0) return { ok: false, message: "The amount must be more than zero" };
  return { ok: true, amount };
}
