import { isCurrencyCode, minorUnitExponent } from "@/lib/currencies";
import { SplitError } from "./errors";

/** An amount in integer minor units (cents, yen, fils). Never a float. */
export type Minor = number;

export function assertMinor(value: number, label = "amount"): asserts value is Minor {
  if (!Number.isSafeInteger(value)) {
    throw new SplitError("INVALID_AMOUNT", `${label} must be a safe integer in minor units, got ${value}`);
  }
}

export function sumMinor(values: readonly Minor[]): Minor {
  let total = 0;
  for (const v of values) total += v;
  assertMinor(total, "sum");
  return total;
}

/** Sign of an amount: -1, 0 or 1. */
export function sign(value: Minor): -1 | 0 | 1 {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/** -0 → 0, so results compare and serialize cleanly. */
export function normalizeZero(value: Minor): Minor {
  return value === 0 ? 0 : value;
}

function exponentFor(currency: string): number {
  if (!isCurrencyCode(currency)) throw new SplitError("UNKNOWN_CURRENCY", `Unknown currency ${currency}`);
  return minorUnitExponent(currency);
}

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Parses a major-unit decimal string into minor units without floating point.
 * "12.5" USD → 1250, "1000" JPY → 1000, "1.234" KWD → 1234.
 * Rejects more decimals than the currency allows.
 */
export function parseMajor(input: string, currency: string): Minor {
  const exponent = exponentFor(currency);
  const match = DECIMAL.exec(input.trim());
  if (!match) throw new SplitError("INVALID_MONEY_STRING", `"${input}" is not a decimal amount`);
  const [, negative, whole, fraction = ""] = match;
  if (fraction.length > exponent) {
    throw new SplitError("INVALID_MONEY_STRING", `${currency} allows at most ${exponent} decimal places`);
  }
  const minor = Number(whole + fraction.padEnd(exponent, "0"));
  assertMinor(minor);
  return normalizeZero(negative ? -minor : minor);
}

/** Minor units → exact decimal string in major units: 1250 USD → "12.50", -5 KWD → "-0.005". */
export function toMajorString(amount: Minor, currency: string): string {
  assertMinor(amount);
  const exponent = exponentFor(currency);
  const digits = Math.abs(amount).toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return (amount < 0 ? "-" : "") + whole + (exponent > 0 ? `.${fraction}` : "");
}

/** Locale-aware display, e.g. 123456 EUR (de) → "1.234,56 €". Uses exact string input, never floats. */
export function formatMinor(amount: Minor, currency: string, locale = "en"): string {
  const exponent = exponentFor(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(toMajorString(amount, currency) as Intl.StringNumericLiteral);
}

const UNSIGNED_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** Parses a non-negative decimal into an integer scaled by 10^decimals: ("33.33", 2) → 3333. */
export function parseScaled(input: string, decimals: number): number {
  const match = UNSIGNED_DECIMAL.exec(input.trim());
  if (!match) throw new SplitError("INVALID_MONEY_STRING", `"${input}" is not a valid number`);
  const [, whole, fraction = ""] = match;
  if (fraction.length > decimals) {
    throw new SplitError("INVALID_MONEY_STRING", `Use at most ${decimals} decimal places`);
  }
  const value = Number(whole + fraction.padEnd(decimals, "0"));
  assertMinor(value, "value");
  return value;
}

/** Inverse of parseScaled, without trailing zeros: (3333, 2) → "33.33", (15000, 4) → "1.5", (20000, 4) → "2". */
export function formatScaled(value: number, decimals: number): string {
  assertMinor(value, "value");
  const digits = Math.abs(value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return (value < 0 ? "-" : "") + whole + (fraction ? `.${fraction}` : "");
}

/** Percent string → basis points: "12.5" → 1250. Max two decimals. */
export function parseBasisPoints(input: string): number {
  return parseScaled(input, 2);
}

/** Share counts allow 4 decimals and are stored ×10000: "1.5" → 15000. */
export const SHARE_DECIMALS = 4;
export function parseShareWeight(input: string): number {
  return parseScaled(input, SHARE_DECIMALS);
}
