import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SplitError } from "./errors";
import { netBalances } from "./balances";
import { sumMinor } from "./money";
import { convertMinor, planCurrencyConversion } from "./convert";

describe("convertMinor", () => {
  it("converts between exponents exactly", () => {
    expect(convertMinor(15631, "JPY", "USD", "158.6")).toBe(9856); // ¥15,631 → $98.56
    expect(convertMinor(1000, "USD", "JPY", "0.0063")).toBe(1587); // $10 → ¥1,587
    expect(convertMinor(1000, "EUR", "KWD", "3")).toBe(3333);
    expect(convertMinor(-15631, "JPY", "USD", "158.6")).toBe(-9856);
    expect(convertMinor(0, "JPY", "USD", "158.6")).toBe(0);
  });

  it("rounds half away from zero", () => {
    expect(convertMinor(1, "USD", "USD", "2")).toBe(1); // 0.5 → 1
    expect(convertMinor(-1, "USD", "USD", "2")).toBe(-1);
    expect(convertMinor(1, "USD", "USD", "3")).toBe(0); // 0.33 → 0
  });

  it("rejects bad rates and currencies", () => {
    expect(() => convertMinor(100, "USD", "EUR", "0")).toThrow(SplitError);
    expect(() => convertMinor(100, "USD", "EUR", "-1")).toThrow(/valid exchange rate/);
    expect(() => convertMinor(100, "USD", "EUR", "1e3")).toThrow(/valid exchange rate/);
    expect(() => convertMinor(100, "ZZZ", "EUR", "1")).toThrow(/Unknown currency/);
  });
});

describe("planCurrencyConversion", () => {
  // The real "japan" group: ¥ and $ balances.
  const japan = {
    JPY: { shanthan: 15631, avaneesh: 3546, paze: -19177 },
    USD: { shanthan: 1650, avaneesh: -550, paze: -1100 },
  };

  it("converts everything into the target and keeps it zero-sum", () => {
    const plan = planCurrencyConversion(japan, "USD", { JPY: "158.6" });
    expect(plan.missingRates).toEqual([]);
    expect(plan.conversions).toHaveLength(1);
    const [c] = plan.conversions;
    expect(c!.clearLeg).toEqual({
      currency: "JPY",
      total: 19177,
      payers: [{ participantId: "paze", amount: 19177 }],
      shares: [
        { participantId: "shanthan", amount: 15631 },
        { participantId: "avaneesh", amount: 3546 },
      ],
    });
    expect(c!.addLeg.total).toBe(12091); // ¥19,177 → $120.91
    expect(sumMinor(c!.addLeg.payers.map((p) => p.amount))).toBe(12091);
    expect(sumMinor(c!.addLeg.shares.map((p) => p.amount))).toBe(12091);
    // $120.91 split 15631:3546 by largest remainder → $98.55 / $22.36 (each within a cent of exact).
    expect(plan.result).toEqual({ shanthan: 1650 + 9855, avaneesh: -550 + 2236, paze: -1100 - 12091 });
    expect(sumMinor(Object.values(plan.result))).toBe(0);
  });

  it("applying both legs leaves only target balances", () => {
    const plan = planCurrencyConversion(japan, "USD", { JPY: "158.6" });
    const after = netBalances([
      { kind: "expense", currency: "JPY", payers: [{ participantId: "shanthan", amount: 15631 }, { participantId: "avaneesh", amount: 3546 }], shares: [{ participantId: "paze", amount: 19177 }] },
      { kind: "expense", currency: "USD", payers: [{ participantId: "shanthan", amount: 1650 }], shares: [{ participantId: "avaneesh", amount: 550 }, { participantId: "paze", amount: 1100 }] },
      ...plan.conversions.flatMap((c) => [
        { kind: "expense" as const, ...c.clearLeg },
        { kind: "expense" as const, ...c.addLeg },
      ]),
    ]);
    expect(after.JPY).toBeUndefined();
    expect(after.USD).toEqual(plan.result);
  });

  it("reports currencies without a rate, skips dust and the target itself", () => {
    const plan = planCurrencyConversion({ USD: { a: 5, b: -5 }, XAF: { a: 1, b: -1 }, VND: { a: 1, b: -1 }, EUR: { a: 0 } }, "USD", { VND: "26000" });
    expect(plan.conversions).toEqual([]);
    expect(plan.missingRates.sort()).toEqual(["VND", "XAF"]);
    expect(plan.result).toEqual({ a: 5, b: -5 });
    expect(planCurrencyConversion({}, "JPY", {})).toEqual({ conversions: [], missingRates: [], result: {} });
  });

  it("drops participants whose converted share rounds to zero", () => {
    // ¥1,001 at ¥1,000/$ = $1.00; tiny's ¥1 is a tenth of a cent.
    const plan = planCurrencyConversion({ JPY: { a: 1000, tiny: 1, b: -1001 } }, "USD", { JPY: "1000" });
    expect(plan.conversions[0]!.addLeg.payers).toEqual([{ participantId: "a", amount: 100 }]);
    expect(plan.result).toEqual({ a: 100, b: -100 });
  });

  it("rejects unbalanced input and unknown targets", () => {
    expect(() => planCurrencyConversion({ JPY: { a: 5, b: -4 } }, "USD", { JPY: "1" })).toThrow(/sum to zero/);
    expect(() => planCurrencyConversion({}, "ZZZ", {})).toThrow(/Unknown currency/);
  });

  it("stays zero-sum for any balances (property)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -10_000_000, max: 10_000_000 }), { minLength: 1, maxLength: 8 }), fc.integer({ min: 1, max: 100000 }), (values, r) => {
        const nets: Record<string, number> = {};
        values.forEach((v, i) => (nets[`p${i}`] = v));
        nets.balance = -sumMinor(values);
        const plan = planCurrencyConversion({ JPY: nets }, "EUR", { JPY: (r / 100).toFixed(2) });
        expect(sumMinor(Object.values(plan.result))).toBe(0);
        for (const c of plan.conversions) {
          expect(sumMinor(c.addLeg.payers.map((p) => p.amount))).toBe(c.addLeg.total);
          expect(sumMinor(c.addLeg.shares.map((p) => p.amount))).toBe(c.addLeg.total);
        }
      }),
    );
  });
});
