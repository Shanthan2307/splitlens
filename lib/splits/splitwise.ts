import { isCurrencyCode, minorUnitExponent } from "@/lib/currencies";
import { assertMinor, normalizeZero, sumMinor, toMajorString, type Minor } from "./money";

/**
 * Conversions between Splitwise's decimal-string amounts and SplitLens minor units.
 * Splitwise sends strings like "25.0" or "8.33" (and "100.0" for JPY), so parsing is
 * lenient about trailing digits: extra decimals are rounded half away from zero.
 */

const DECIMAL = /^\s*(-)?(\d+)(?:\.(\d*))?\s*$/;

/** "12.345" USD → 1235; "100.0" JPY → 100. Null for anything that isn't a plain decimal. */
export function parseSplitwiseAmount(input: string, currency: string): Minor | null {
  if (!isCurrencyCode(currency)) return null;
  const match = DECIMAL.exec(input);
  if (!match) return null;
  const [, negative, whole, fraction = ""] = match;
  const exponent = minorUnitExponent(currency);
  const kept = fraction.slice(0, exponent).padEnd(exponent, "0");
  let minor = Number(whole + kept);
  if ((fraction[exponent] ?? "0") >= "5") minor += 1;
  if (!Number.isSafeInteger(minor)) return null;
  return normalizeZero(negative ? -minor : minor);
}

export type SplitwiseShareInput = { userId: number; paidShare: string; owedShare: string };
export type SplitwiseAmount = { userId: number; amount: Minor };

export type ConvertedSplitwiseExpense =
  | { ok: true; total: Minor; payers: SplitwiseAmount[]; shares: SplitwiseAmount[] }
  | { ok: false; reason: "currency" | "amount" | "zero" | "mismatch" };

/**
 * Splitwise expense → exact payers/shares in minor units that sum to the total.
 * Per-person shares can lose a unit to rounding (e.g. "3.333"); up to one unit per person
 * is absorbed, largest amounts first. Bigger gaps mean the data is inconsistent.
 */
export function convertSplitwiseExpense(cost: string, currency: string, users: readonly SplitwiseShareInput[]): ConvertedSplitwiseExpense {
  if (!isCurrencyCode(currency)) return { ok: false, reason: "currency" };
  const total = parseSplitwiseAmount(cost, currency);
  if (total === null) return { ok: false, reason: "amount" };
  if (total <= 0) return { ok: false, reason: "zero" };

  const read = (pick: (u: SplitwiseShareInput) => string): SplitwiseAmount[] | "amount" | "mismatch" => {
    const out: SplitwiseAmount[] = [];
    for (const u of users) {
      const amount = parseSplitwiseAmount(pick(u), currency);
      if (amount === null || amount < 0) return "amount";
      if (amount > 0) out.push({ userId: u.userId, amount });
    }
    return reconcile(out, total) ?? "mismatch";
  };

  const payers = read((u) => u.paidShare);
  if (typeof payers === "string") return { ok: false, reason: payers };
  const shares = read((u) => u.owedShare);
  if (typeof shares === "string") return { ok: false, reason: shares };
  return { ok: true, total, payers, shares };
}

function reconcile(parts: SplitwiseAmount[], total: Minor): SplitwiseAmount[] | null {
  if (parts.length === 0) return null;
  let diff = total - sumMinor(parts.map((p) => p.amount));
  if (Math.abs(diff) > parts.length) return null;
  const order = parts.map((_, i) => i).sort((a, b) => parts[b]!.amount - parts[a]!.amount || a - b);
  const result = parts.map((p) => ({ ...p }));
  for (const i of order) {
    if (diff === 0) break;
    const step = diff > 0 ? 1 : -1;
    if (result[i]!.amount + step <= 0) continue;
    result[i]!.amount += step;
    diff -= step;
  }
  return diff === 0 ? result : null;
}

/**
 * SplitLens payers/shares (minor units, keyed by Splitwise user id) → Splitwise's
 * users__N__paid_share / owed_share decimal strings. Everyone appears once.
 */
export function toSplitwiseUsers(
  currency: string,
  payers: readonly SplitwiseAmount[],
  shares: readonly SplitwiseAmount[],
): { userId: number; paidShare: string; owedShare: string }[] {
  const ids = [...new Set([...payers, ...shares].map((p) => p.userId))];
  const amountFor = (list: readonly SplitwiseAmount[], id: number) => {
    const total = sumMinor(list.filter((p) => p.userId === id).map((p) => p.amount));
    assertMinor(total);
    return toMajorString(total, currency);
  };
  return ids.map((userId) => ({ userId, paidShare: amountFor(payers, userId), owedShare: amountFor(shares, userId) }));
}
