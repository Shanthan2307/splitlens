import { isCurrencyCode, minorUnitExponent } from "@/lib/currencies";
import { allocate } from "./allocate";
import type { CurrencyBalances } from "./balances";
import { SplitError } from "./errors";
import { assertMinor, normalizeZero, sumMinor, type Minor } from "./money";
import type { ParticipantAmount, ParticipantId } from "./types";

/**
 * Currency conversion without floats. A rate is an exact decimal string saying how many
 * units of the source currency make one unit of the target ("158.6" JPY per 1 USD).
 */

const RATE = /^(\d+)(?:\.(\d+))?$/;

function parseRate(rate: string): { scaled: bigint; scale: bigint } {
  const match = RATE.exec(rate.trim());
  if (!match) throw new SplitError("INVALID_RATE", `"${rate}" is not a valid exchange rate`);
  const [, whole, fraction = ""] = match;
  const scaled = BigInt(whole + fraction);
  if (scaled === 0n) throw new SplitError("INVALID_RATE", "Exchange rate must be positive");
  return { scaled, scale: 10n ** BigInt(fraction.length) };
}

function exponent(currency: string): bigint {
  if (!isCurrencyCode(currency)) throw new SplitError("UNKNOWN_CURRENCY", `Unknown currency ${currency}`);
  return 10n ** BigInt(minorUnitExponent(currency));
}

/**
 * Converts minor units of `from` into minor units of `to`, rounding half away from zero.
 * `fromPerTo` = units of `from` per 1 `to`. ¥15,631 at "158.6" JPY/USD → 9856 ($98.56).
 */
export function convertMinor(amount: Minor, from: string, to: string, fromPerTo: string): Minor {
  assertMinor(amount);
  const { scaled, scale } = parseRate(fromPerTo);
  const numerator = BigInt(Math.abs(amount)) * exponent(to) * scale;
  const denominator = scaled * exponent(from);
  let result = numerator / denominator;
  if ((numerator % denominator) * 2n >= denominator) result += 1n;
  const value = Number(result);
  assertMinor(value, "converted amount");
  return normalizeZero(amount < 0 ? -value : value);
}

/** One side of a conversion, shaped like an exact-split expense (payers and shares sum to `total`). */
export type ConversionLeg = { currency: string; total: Minor; payers: ParticipantAmount[]; shares: ParticipantAmount[] };

export type CurrencyConversion = {
  from: string;
  to: string;
  /** Units of `from` per 1 `to`. */
  rate: string;
  /** In `from`: everyone who owes "pays" what they owe and everyone owed "owes" it back, so `from` balances become zero. */
  clearLeg: ConversionLeg;
  /** In `to`: the same balances, converted, so nobody gains or loses beyond rounding. */
  addLeg: ConversionLeg;
};

export type ConversionPlan = {
  conversions: CurrencyConversion[];
  /** Currencies with balances but no rate available: left as they are. */
  missingRates: string[];
  /** Per-participant balances in `target` after converting (includes existing `target` balances). */
  result: Record<ParticipantId, Minor>;
};

/**
 * Plans converting every non-`target` balance in a group into `target`, the way Splitwise's
 * "convert to one currency" does: two exact-split entries per currency. Converted credits and
 * debts are each allocated by largest remainder from the same converted total, so the
 * `target` balances still sum to exactly zero and each person is within one unit of exact.
 * `rates[c]` = units of `c` per 1 `target`.
 */
export function planCurrencyConversion(balances: CurrencyBalances, target: string, rates: Readonly<Record<string, string>>): ConversionPlan {
  exponent(target);
  const result: Record<ParticipantId, Minor> = { ...(balances[target] ?? {}) };
  const conversions: CurrencyConversion[] = [];
  const missingRates: string[] = [];

  for (const [currency, byId] of Object.entries(balances)) {
    if (currency === target) continue;
    const owed = Object.entries(byId).filter(([, v]) => v > 0);
    const owing = Object.entries(byId).filter(([, v]) => v < 0);
    if (owed.length === 0) continue;
    const rate = rates[currency];
    if (rate === undefined) {
      missingRates.push(currency);
      continue;
    }

    const total = sumMinor(owed.map(([, v]) => v));
    if (total !== -sumMinor(owing.map(([, v]) => v))) {
      throw new SplitError("SUM_MISMATCH", `${currency} balances don't sum to zero`);
    }
    const converted = convertMinor(total, currency, target, rate);
    if (converted === 0) {
      // Too small to be worth a cent in the target: leave it rather than lose it silently.
      missingRates.push(currency);
      continue;
    }

    const credits = allocate(converted, owed.map(([, v]) => v));
    const debits = allocate(converted, owing.map(([, v]) => -v));
    owed.forEach(([id], i) => (result[id] = (result[id] ?? 0) + credits[i]!));
    owing.forEach(([id], i) => (result[id] = (result[id] ?? 0) - debits[i]!));

    conversions.push({
      from: currency,
      to: target,
      rate,
      clearLeg: {
        currency,
        total,
        payers: owing.map(([id, v]) => ({ participantId: id, amount: -v })),
        shares: owed.map(([id, v]) => ({ participantId: id, amount: v })),
      },
      addLeg: {
        currency: target,
        total: converted,
        payers: owed.map(([id], i) => ({ participantId: id, amount: credits[i]! })).filter((p) => p.amount > 0),
        shares: owing.map(([id], i) => ({ participantId: id, amount: debits[i]! })).filter((p) => p.amount > 0),
      },
    });
  }

  for (const id of Object.keys(result)) if (result[id] === 0) delete result[id];
  return { conversions, missingRates, result };
}
