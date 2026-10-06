import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EXACT_SIMPLIFY_LIMIT, simplifyDebts } from "./simplify";
import type { Debt } from "./types";

const err = (code: string) => expect.objectContaining({ code });

/** Applies transfers to balances and returns what's left (should be all zero). */
function apply(balances: Record<string, number>, debts: Debt[]) {
  const left = { ...balances };
  for (const d of debts) {
    expect(d.amount).toBeGreaterThan(0);
    left[d.from] += d.amount;
    left[d.to] -= d.amount;
  }
  return Object.values(left).filter((v) => v !== 0);
}

/** Independent brute force: max number of disjoint zero-sum groups. */
function maxZeroSumGroups(values: number[]): number {
  if (values.length === 0) return 0;
  const [first, ...rest] = values;
  let best = 0;
  // `first` belongs to some zero-sum subset S; try every subset of the rest to complete it.
  for (let mask = 0; mask < 1 << rest.length; mask++) {
    let sum = first;
    const remaining: number[] = [];
    rest.forEach((v, i) => (mask & (1 << i) ? (sum += v) : remaining.push(v)));
    if (sum === 0) best = Math.max(best, 1 + maxZeroSumGroups(remaining));
  }
  return best;
}

describe("simplifyDebts", () => {
  it("collapses a chain into one transfer", () => {
    expect(simplifyDebts({ USD: { a: 1000, b: 0, c: -1000 } })).toEqual([
      { from: "c", to: "a", amount: 1000, currency: "USD" },
    ]);
  });

  it("one person paid for everyone: everyone pays them directly", () => {
    expect(simplifyDebts({ EUR: { a: 3000, b: -1000, c: -1000, d: -1000 } })).toEqual([
      { from: "b", to: "a", amount: 1000, currency: "EUR" },
      { from: "c", to: "a", amount: 1000, currency: "EUR" },
      { from: "d", to: "a", amount: 1000, currency: "EUR" },
    ]);
  });

  it("finds the true minimum where greedy matching would use more transfers", () => {
    // Greedy (largest↔largest) takes 4 transfers; optimal pairs a↔b and settles {c,d,e} in 2.
    const balances = { a: 500, b: -500, c: 300, d: 400, e: -700 };
    const debts = simplifyDebts({ USD: balances });
    expect(debts).toHaveLength(3);
    expect(apply(balances, debts)).toEqual([]);
    expect(debts).toContainEqual({ from: "b", to: "a", amount: 500, currency: "USD" });
  });

  it("simplifies each currency separately, including JPY and KWD", () => {
    const debts = simplifyDebts({
      JPY: { a: 1000, b: -1000 },
      KWD: { a: -1234, c: 1234 },
    });
    expect(debts).toEqual([
      { from: "b", to: "a", amount: 1000, currency: "JPY" },
      { from: "a", to: "c", amount: 1234, currency: "KWD" },
    ]);
  });

  it("returns nothing when everyone is settled", () => {
    expect(simplifyDebts({})).toEqual([]);
    expect(simplifyDebts({ USD: { a: 0, b: 0 } })).toEqual([]);
  });

  it("is deterministic regardless of key order", () => {
    const x = simplifyDebts({ USD: { a: 5, b: 3, c: -4, d: -4 } });
    const y = simplifyDebts({ USD: { d: -4, c: -4, b: 3, a: 5 } });
    expect(x).toEqual(y);
  });

  it("rejects balances that don't sum to zero", () => {
    expect(() => simplifyDebts({ USD: { a: 10, b: -9 } })).toThrow(err("SUM_MISMATCH"));
    expect(() => simplifyDebts({ USD: { a: 0.5, b: -0.5 } })).toThrow(err("INVALID_AMOUNT"));
  });

  it("falls back to greedy (≤ n−1 transfers) above the exact limit", () => {
    const n = EXACT_SIMPLIFY_LIMIT + 4;
    const balances: Record<string, number> = {};
    for (let i = 0; i < n - 1; i++) balances[`p${String(i).padStart(2, "0")}`] = (i % 2 ? -1 : 1) * (100 + i * 37);
    balances.last = -Object.values(balances).reduce((a, b) => a + b, 0);
    const debts = simplifyDebts({ USD: balances });
    expect(debts.length).toBeLessThanOrEqual(n - 1);
    expect(apply(balances, debts)).toEqual([]);
  });

  it("property: settles everyone with the minimum possible number of transfers", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -50, max: 50 }), { minLength: 1, maxLength: 7 }), (values) => {
        const balances: Record<string, number> = {};
        values.forEach((v, i) => (balances[`p${i}`] = v));
        balances.last = -values.reduce((a, b) => a + b, 0);

        const debts = simplifyDebts({ USD: balances });
        expect(apply(balances, debts)).toEqual([]);

        const nonZero = Object.values(balances).filter((v) => v !== 0);
        expect(debts).toHaveLength(nonZero.length - maxZeroSumGroups(nonZero));
      }),
    );
  });
});
