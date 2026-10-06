import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeItemizedSplit, type ItemizedLine } from "./itemized";

const owed = (lines: ItemizedLine[]) =>
  Object.fromEntries(computeItemizedSplit(lines).shares.map((s) => [s.participantId, s.amount]));

describe("computeItemizedSplit", () => {
  it("distributes tax and tip proportionally to item subtotals", () => {
    // a: $30 of items, b: $10. Tax $4 → 3/1, tip $8 → 6/2.
    const result = computeItemizedSplit([
      { kind: "item", amount: 3000, assignments: [{ participantId: "a" }] },
      { kind: "item", amount: 1000, assignments: [{ participantId: "b" }] },
      { kind: "tax", amount: 400 },
      { kind: "tip", amount: 800 },
    ]);
    expect(result.total).toBe(5200);
    expect(result.breakdown).toEqual([
      { participantId: "a", items: 3000, charges: 900, discounts: 0, owed: 3900 },
      { participantId: "b", items: 1000, charges: 300, discounts: 0, owed: 1300 },
    ]);
  });

  it("splits shared items by weight", () => {
    // Pizza $12 shared a:2, b:1; salad $5 for b only.
    expect(
      owed([
        { kind: "item", amount: 1200, assignments: [{ participantId: "a", weight: 2 }, { participantId: "b" }] },
        { kind: "item", amount: 500, assignments: [{ participantId: "b" }] },
      ]),
    ).toEqual({ a: 800, b: 900 });
  });

  it("applies discounts proportionally and service charges too", () => {
    const result = computeItemizedSplit([
      { kind: "item", amount: 2000, assignments: [{ participantId: "a" }] },
      { kind: "item", amount: 1000, assignments: [{ participantId: "b" }] },
      { kind: "service", amount: 300 },
      { kind: "discount", amount: -600 },
    ]);
    expect(result.breakdown).toEqual([
      { participantId: "a", items: 2000, charges: 200, discounts: -400, owed: 1800 },
      { participantId: "b", items: 1000, charges: 100, discounts: -200, owed: 900 },
    ]);
    expect(result.total).toBe(2700);
  });

  it("handles negative item lines (a returned item or per-item coupon)", () => {
    expect(
      owed([
        { kind: "item", amount: 1500, assignments: [{ participantId: "a" }] },
        { kind: "item", amount: -500, assignments: [{ participantId: "a" }] },
        { kind: "item", amount: 1000, assignments: [{ participantId: "b" }] },
        { kind: "tax", amount: 200 },
      ]),
    ).toEqual({ a: 1100, b: 1100 });
  });

  it("charges assigned to specific people apply only to them", () => {
    expect(
      owed([
        { kind: "item", amount: 1000, assignments: [{ participantId: "a" }] },
        { kind: "item", amount: 1000, assignments: [{ participantId: "b" }] },
        { kind: "fee", amount: 299, assignments: [{ participantId: "b" }] },
        { kind: "discount", amount: -100, assignments: [{ participantId: "a" }] },
      ]),
    ).toEqual({ a: 900, b: 1299 });
  });

  it("can distribute a charge equally instead of proportionally", () => {
    expect(
      owed([
        { kind: "item", amount: 3000, assignments: [{ participantId: "a" }] },
        { kind: "item", amount: 1000, assignments: [{ participantId: "b" }] },
        { kind: "tip", amount: 1001, distribution: "equal" },
      ]),
    ).toEqual({ a: 3501, b: 1500 });
  });

  it("rounds with largest remainder so everything sums to the receipt total", () => {
    // Three equal people, 10¢ tax → 4/3/3.
    const result = computeItemizedSplit([
      { kind: "item", amount: 100, assignments: [{ participantId: "a" }] },
      { kind: "item", amount: 100, assignments: [{ participantId: "b" }] },
      { kind: "item", amount: 100, assignments: [{ participantId: "c" }] },
      { kind: "tax", amount: 10 },
    ]);
    expect(result.shares.map((s) => s.amount)).toEqual([104, 103, 103]);
  });

  it("works with zero-decimal currencies (JPY receipt)", () => {
    // ¥1,280 ramen + ¥980 gyoza shared, 10% tax ¥226.
    expect(
      owed([
        { kind: "item", amount: 1280, assignments: [{ participantId: "a" }] },
        { kind: "item", amount: 980, assignments: [{ participantId: "a" }, { participantId: "b" }] },
        { kind: "tax", amount: 226 },
      ]),
    ).toEqual({ a: 1947, b: 539 });
  });

  it("works with three-decimal currencies (KWD)", () => {
    const result = computeItemizedSplit([
      { kind: "item", amount: 2750, assignments: [{ participantId: "a" }] },
      { kind: "item", amount: 1250, assignments: [{ participantId: "b" }] },
      { kind: "service", amount: 400 },
    ]);
    expect(result.shares).toEqual([
      { participantId: "a", amount: 3025 },
      { participantId: "b", amount: 1375 },
    ]);
  });

  it("handles a full refund receipt (all lines negative)", () => {
    expect(
      owed([
        { kind: "item", amount: -3000, assignments: [{ participantId: "a" }] },
        { kind: "item", amount: -1000, assignments: [{ participantId: "b" }] },
        { kind: "tax", amount: -400 },
      ]),
    ).toEqual({ a: -3300, b: -1100 });
  });

  it("lets a person's items be fully discounted to zero", () => {
    expect(
      owed([
        { kind: "item", amount: 1000, assignments: [{ participantId: "a" }] },
        { kind: "item", amount: 500, assignments: [{ participantId: "b" }] },
        { kind: "discount", amount: -500, assignments: [{ participantId: "b" }] },
      ]),
    ).toEqual({ a: 1000, b: 0 });
  });

  it("rejects invalid receipts", () => {
    const err = (code: string) => expect.objectContaining({ code });
    expect(() => computeItemizedSplit([])).toThrow(err("NO_PARTICIPANTS"));
    expect(() => computeItemizedSplit([{ kind: "item", amount: 100 }])).toThrow(err("UNASSIGNED_ITEM"));
    expect(() => computeItemizedSplit([{ kind: "item", amount: 100, assignments: [] }])).toThrow(err("UNASSIGNED_ITEM"));
    expect(() => computeItemizedSplit([{ kind: "tax", amount: 100 }])).toThrow(err("UNASSIGNED_ITEM"));
    expect(() =>
      computeItemizedSplit([{ kind: "item", amount: 1.5, assignments: [{ participantId: "a" }] }]),
    ).toThrow(err("INVALID_AMOUNT"));
    expect(() =>
      computeItemizedSplit([
        { kind: "item", amount: 100, assignments: [{ participantId: "a" }, { participantId: "a" }] },
      ]),
    ).toThrow(err("DUPLICATE_PARTICIPANT"));
    expect(() =>
      computeItemizedSplit([{ kind: "item", amount: 100, assignments: [{ participantId: "a", weight: 0 }] }]),
    ).toThrow(err("ZERO_WEIGHTS"));
    // Someone ends up owed money on a normal receipt.
    expect(() =>
      computeItemizedSplit([
        { kind: "item", amount: 1000, assignments: [{ participantId: "a" }] },
        { kind: "item", amount: -200, assignments: [{ participantId: "b" }] },
      ]),
    ).toThrow(err("SIGN_MISMATCH"));
    // Proportional charge can't be spread when subtotals have mixed signs.
    expect(() =>
      computeItemizedSplit([
        { kind: "item", amount: 1000, assignments: [{ participantId: "a" }] },
        { kind: "item", amount: -200, assignments: [{ participantId: "b" }] },
        { kind: "tax", amount: 80 },
      ]),
    ).toThrow(err("MIXED_SIGN_SUBTOTALS"));
    // ...or when everyone's items net to zero.
    expect(() =>
      computeItemizedSplit([
        { kind: "item", amount: 500, assignments: [{ participantId: "a" }] },
        { kind: "item", amount: -500, assignments: [{ participantId: "a" }] },
        { kind: "tax", amount: 80 },
      ]),
    ).toThrow(err("ZERO_WEIGHTS"));
    // A receipt that totals zero isn't an expense.
    expect(() =>
      computeItemizedSplit([
        { kind: "item", amount: 500, assignments: [{ participantId: "a" }] },
        { kind: "discount", amount: -500 },
      ]),
    ).toThrow(err("ZERO_TOTAL"));
  });

  it("property: shares sum to the receipt total and breakdown adds up", () => {
    const person = fc.constantFrom("a", "b", "c", "d", "e");
    const item = fc.record({
      amount: fc.integer({ min: 1, max: 1_000_000 }),
      assignments: fc.uniqueArray(
        fc.record({ participantId: person, weight: fc.integer({ min: 1, max: 5 }) }),
        { minLength: 1, maxLength: 5, selector: (a) => a.participantId },
      ),
    });
    const charge = fc.record({
      kind: fc.constantFrom("tax" as const, "tip" as const, "service" as const, "fee" as const),
      amount: fc.integer({ min: 0, max: 100_000 }),
      distribution: fc.constantFrom("proportional" as const, "equal" as const),
    });
    fc.assert(
      fc.property(
        fc.array(item, { minLength: 1, maxLength: 15 }),
        fc.array(charge, { maxLength: 4 }),
        fc.integer({ min: 0, max: 50 }),
        (items, charges, discountPercent) => {
          const itemLines: ItemizedLine[] = items.map((i) => ({ kind: "item", ...i }));
          const itemTotal = items.reduce((s, i) => s + i.amount, 0);
          const lines: ItemizedLine[] = [
            ...itemLines,
            ...charges,
            { kind: "discount", amount: -Math.floor((itemTotal * discountPercent) / 100) },
          ];
          const result = computeItemizedSplit(lines);
          expect(result.shares.reduce((s, x) => s + x.amount, 0)).toBe(result.total);
          expect(result.total).toBe(lines.reduce((s, l) => s + l.amount, 0));
          for (const b of result.breakdown) {
            expect(b.items + b.charges + b.discounts).toBe(b.owed);
            expect(b.owed).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});
