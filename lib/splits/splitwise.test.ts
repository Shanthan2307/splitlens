import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sumMinor } from "./money";
import { convertSplitwiseExpense, parseSplitwiseAmount, toSplitwiseUsers } from "./splitwise";

describe("parseSplitwiseAmount", () => {
  it("parses Splitwise decimal strings per currency", () => {
    expect(parseSplitwiseAmount("25.0", "USD")).toBe(2500);
    expect(parseSplitwiseAmount("8.33", "EUR")).toBe(833);
    expect(parseSplitwiseAmount("100.0", "JPY")).toBe(100);
    expect(parseSplitwiseAmount("1.5", "KWD")).toBe(1500);
    expect(parseSplitwiseAmount("7", "USD")).toBe(700);
    expect(parseSplitwiseAmount("7.", "USD")).toBe(700);
    expect(parseSplitwiseAmount(" 0.00 ", "USD")).toBe(0);
  });

  it("rounds extra decimals half away from zero", () => {
    expect(parseSplitwiseAmount("3.335", "USD")).toBe(334);
    expect(parseSplitwiseAmount("3.334", "USD")).toBe(333);
    expect(parseSplitwiseAmount("-3.335", "USD")).toBe(-334);
    expect(parseSplitwiseAmount("99.5", "JPY")).toBe(100);
    expect(parseSplitwiseAmount("-0.001", "USD")).toBe(0);
  });

  it("rejects unknown currencies and malformed or huge amounts", () => {
    expect(parseSplitwiseAmount("1.00", "XBT")).toBeNull();
    expect(parseSplitwiseAmount("1,00", "USD")).toBeNull();
    expect(parseSplitwiseAmount("", "USD")).toBeNull();
    expect(parseSplitwiseAmount("1e5", "USD")).toBeNull();
    expect(parseSplitwiseAmount("99999999999999999999", "USD")).toBeNull();
  });
});

describe("convertSplitwiseExpense", () => {
  it("converts paid and owed shares, dropping zero entries", () => {
    expect(
      convertSplitwiseExpense("30.0", "USD", [
        { userId: 1, paidShare: "30.0", owedShare: "10.0" },
        { userId: 2, paidShare: "0.0", owedShare: "10.0" },
        { userId: 3, paidShare: "0.0", owedShare: "10.0" },
        { userId: 4, paidShare: "0.0", owedShare: "0.0" },
      ]),
    ).toEqual({
      ok: true,
      total: 3000,
      payers: [{ userId: 1, amount: 3000 }],
      shares: [
        { userId: 1, amount: 1000 },
        { userId: 2, amount: 1000 },
        { userId: 3, amount: 1000 },
      ],
    });
  });

  it("absorbs per-person rounding, largest share first", () => {
    const r = convertSplitwiseExpense("10.0", "USD", [
      { userId: 1, paidShare: "10.0", owedShare: "3.333" },
      { userId: 2, paidShare: "0", owedShare: "3.333" },
      { userId: 3, paidShare: "0", owedShare: "3.334" },
    ]);
    // 3.334 rounds to 333 too; the missing unit goes to the first of the tied largest.
    expect(r.ok && r.shares.map((s) => s.amount)).toEqual([334, 333, 333]);
    const up = convertSplitwiseExpense("10.0", "USD", [
      { userId: 1, paidShare: "10.0", owedShare: "3.33" },
      { userId: 2, paidShare: "0", owedShare: "3.33" },
      { userId: 3, paidShare: "0", owedShare: "3.33" },
    ]);
    expect(up.ok && up.shares.map((s) => s.amount)).toEqual([334, 333, 333]);
    const down = convertSplitwiseExpense("0.02", "USD", [
      { userId: 1, paidShare: "0.02", owedShare: "0.01" },
      { userId: 2, paidShare: "0", owedShare: "0.02" },
    ]);
    // Reducing the 0.01 share would zero it, so the larger one gives.
    expect(down.ok && down.shares.map((s) => s.amount)).toEqual([1, 1]);
  });

  it("rejects inconsistent data", () => {
    expect(convertSplitwiseExpense("1", "ZZZ", [])).toEqual({ ok: false, reason: "currency" });
    expect(convertSplitwiseExpense("x", "USD", [])).toEqual({ ok: false, reason: "amount" });
    expect(convertSplitwiseExpense("0.0", "USD", [])).toEqual({ ok: false, reason: "zero" });
    expect(convertSplitwiseExpense("5", "USD", [{ userId: 1, paidShare: "-5", owedShare: "5" }])).toEqual({ ok: false, reason: "amount" });
    expect(convertSplitwiseExpense("5", "USD", [{ userId: 1, paidShare: "5", owedShare: "abc" }])).toEqual({ ok: false, reason: "amount" });
    expect(convertSplitwiseExpense("5", "USD", [{ userId: 1, paidShare: "4", owedShare: "5" }])).toEqual({ ok: false, reason: "mismatch" });
    expect(convertSplitwiseExpense("5", "USD", [{ userId: 1, paidShare: "5", owedShare: "0" }])).toEqual({ ok: false, reason: "mismatch" });
    expect(
      convertSplitwiseExpense("0.03", "USD", [
        { userId: 1, paidShare: "0.03", owedShare: "0.01" },
        { userId: 2, paidShare: "0", owedShare: "0.01" },
        { userId: 3, paidShare: "0", owedShare: "0.02" },
      ]),
    ).toEqual({ ok: true, total: 3, payers: [{ userId: 1, amount: 3 }], shares: [{ userId: 1, amount: 1 }, { userId: 2, amount: 1 }, { userId: 3, amount: 1 }] });
    // -2 units, but neither 1-unit share can drop to zero and the third only absorbs one.
    expect(
      convertSplitwiseExpense("0.03", "USD", [
        { userId: 1, paidShare: "0.03", owedShare: "0.01" },
        { userId: 2, paidShare: "0", owedShare: "0.01" },
        { userId: 3, paidShare: "0", owedShare: "0.03" },
      ]),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("always sums exactly when it succeeds (property)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 100000 }), { minLength: 1, maxLength: 8 }), (cents) => {
        const total = cents.reduce((a, b) => a + b, 0);
        fc.pre(total > 0);
        const users = cents.map((c, i) => ({ userId: i, paidShare: i === 0 ? (total / 100).toFixed(2) : "0", owedShare: (c / 100).toFixed(2) }));
        const r = convertSplitwiseExpense((total / 100).toFixed(2), "USD", users);
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(sumMinor(r.shares.map((s) => s.amount))).toBe(total);
          expect(sumMinor(r.payers.map((s) => s.amount))).toBe(total);
        }
      }),
    );
  });
});

describe("toSplitwiseUsers", () => {
  it("merges payers and shares into one entry per person", () => {
    expect(
      toSplitwiseUsers(
        "USD",
        [{ userId: 1, amount: 1000 }],
        [
          { userId: 1, amount: 500 },
          { userId: 2, amount: 500 },
        ],
      ),
    ).toEqual([
      { userId: 1, paidShare: "10.00", owedShare: "5.00" },
      { userId: 2, paidShare: "0.00", owedShare: "5.00" },
    ]);
    expect(toSplitwiseUsers("JPY", [{ userId: 3, amount: 900 }], [{ userId: 3, amount: 900 }])).toEqual([
      { userId: 3, paidShare: "900", owedShare: "900" },
    ]);
  });
});
