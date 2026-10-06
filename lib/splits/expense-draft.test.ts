import { describe, expect, it } from "vitest";
import {
  buildExpense,
  defaultSplitDraft,
  draftFromExpense,
  type BuiltExpense,
  type DraftSplit,
  type ExpenseDraft,
} from "./expense-draft";

const draft = (split: DraftSplit, overrides: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  currency: "USD",
  total: "30.00",
  paidBy: { mode: "single", participantId: "a" },
  split,
  ...overrides,
});

function ok(d: ExpenseDraft): BuiltExpense {
  const result = buildExpense(d);
  if (!result.ok) throw new Error(`expected ok, got ${result.field}: ${result.message}`);
  return result.expense;
}

function fail(d: ExpenseDraft) {
  const result = buildExpense(d);
  if (result.ok) throw new Error("expected failure");
  return { field: result.field, message: result.message };
}

const v = (participantId: string, value: string) => ({ participantId, value });

describe("buildExpense: totals and payers", () => {
  it("single payer pays the whole total", () => {
    const e = ok(draft({ type: "equal", participants: ["a", "b", "c"] }, { total: "10" }));
    expect(e.total).toBe(1000);
    expect(e.payers).toEqual([{ participantId: "a", amount: 1000 }]);
    expect(e.shares.map((s) => s.amount)).toEqual([334, 333, 333]);
    expect(e.shares.every((s) => s.splitInput === null)).toBe(true);
    expect(e.items).toEqual([]);
    expect(e.breakdown).toBeNull();
  });

  it("multiple payers, ignoring blanks and zeros", () => {
    const e = ok(
      draft(
        { type: "equal", participants: ["a", "b"] },
        { paidBy: { mode: "multiple", amounts: [v("a", "20"), v("b", "10.00"), v("c", ""), v("d", "0")] } },
      ),
    );
    expect(e.payers).toEqual([
      { participantId: "a", amount: 2000 },
      { participantId: "b", amount: 1000 },
    ]);
  });

  it("reports how much is left or over for multiple payers", () => {
    const left = fail(draft({ type: "equal", participants: ["a"] }, { paidBy: { mode: "multiple", amounts: [v("a", "20")] } }));
    expect(left).toEqual({ field: "paidBy", message: "Paid amounts add up to $20.00: $10.00 left" });
    const over = fail(draft({ type: "equal", participants: ["a"] }, { paidBy: { mode: "multiple", amounts: [v("a", "35")] } }));
    expect(over.message).toBe("Paid amounts add up to $35.00: $5.00 over");
  });

  it("rejects empty or wrong-sign payers", () => {
    expect(fail(draft({ type: "equal", participants: ["a"] }, { paidBy: { mode: "multiple", amounts: [v("a", "")] } }))).toEqual({
      field: "paidBy",
      message: "Enter how much each person paid",
    });
    expect(
      fail(
        draft(
          { type: "equal", participants: ["a"] },
          { paidBy: { mode: "multiple", amounts: [v("a", "40"), v("b", "-10")] } },
        ),
      ).message,
    ).toBe("Each paid amount must match the sign of the total");
    expect(fail(draft({ type: "equal", participants: ["a"] }, { paidBy: { mode: "multiple", amounts: [v("a", "x")] } })).field).toBe(
      "paidBy",
    );
  });

  it("validates the total", () => {
    expect(fail(draft({ type: "equal", participants: ["a"] }, { total: " " }))).toEqual({ field: "total", message: "Enter an amount" });
    expect(fail(draft({ type: "equal", participants: ["a"] }, { total: "0.00" })).message).toBe("The amount must not be zero");
    expect(fail(draft({ type: "equal", participants: ["a"] }, { total: "1.234" }))).toEqual({
      field: "total",
      message: "Amount: USD allows at most 2 decimal places",
    });
    expect(fail(draft({ type: "equal", participants: ["a"] }, { currency: "XYZ" }))).toEqual({
      field: "total",
      message: "Choose a currency",
    });
  });

  it("supports zero- and three-decimal currencies and refunds", () => {
    expect(ok(draft({ type: "equal", participants: ["a", "b", "c"] }, { currency: "JPY", total: "1000" })).shares.map((s) => s.amount)).toEqual([
      334, 333, 333,
    ]);
    expect(ok(draft({ type: "equal", participants: ["a", "b"] }, { currency: "KWD", total: "1.005" })).shares.map((s) => s.amount)).toEqual([
      503, 502,
    ]);
    const refund = ok(draft({ type: "equal", participants: ["a", "b"] }, { total: "-40" }));
    expect(refund.payers).toEqual([{ participantId: "a", amount: -4000 }]);
    expect(refund.shares.map((s) => s.amount)).toEqual([-2000, -2000]);
  });
});

describe("buildExpense: split types", () => {
  it("equal requires someone", () => {
    expect(fail(draft({ type: "equal", participants: [] }))).toEqual({
      field: "split",
      message: "Choose at least one person to split with",
    });
  });

  it("exact", () => {
    const e = ok(draft({ type: "exact", values: [v("a", "10"), v("b", "20"), v("c", "")] }));
    expect(e.shares).toEqual([
      { participantId: "a", amount: 1000, splitInput: 1000 },
      { participantId: "b", amount: 2000, splitInput: 2000 },
    ]);
    expect(fail(draft({ type: "exact", values: [v("a", "10")] })).message).toBe("The amounts add up to $10.00: $20.00 left");
    expect(fail(draft({ type: "exact", values: [v("a", "40")] })).message).toBe("The amounts add up to $40.00: $10.00 over");
    expect(fail(draft({ type: "exact", values: [v("a", "40"), v("b", "-10")] })).message).toBe(
      "Each amount must match the sign of the total",
    );
    expect(fail(draft({ type: "exact", values: [v("a", "")] })).message).toBe("Enter how to split the amount");
    expect(fail(draft({ type: "exact", values: [v("a", "1.2.3")] })).message).toMatch(/^Amount: /);
  });

  it("percentage", () => {
    const e = ok(draft({ type: "percentage", values: [v("a", "50"), v("b", "33.33"), v("c", "16.67")] }));
    expect(e.shares.map((s) => [s.amount, s.splitInput])).toEqual([
      [1500, 5000],
      [1000, 3333],
      [500, 1667],
    ]);
    expect(fail(draft({ type: "percentage", values: [v("a", "50"), v("b", "40")] })).message).toBe(
      "Percentages add up to 90%: 10% left",
    );
    expect(fail(draft({ type: "percentage", values: [v("a", "60"), v("b", "40.5")] })).message).toBe(
      "Percentages add up to 100.5%: 0.5% over",
    );
    expect(fail(draft({ type: "percentage", values: [v("a", "33.333")] })).message).toBe(
      "Percentages: Use at most 2 decimal places",
    );
  });

  it("shares, including fractional shares", () => {
    const e = ok(draft({ type: "shares", values: [v("a", "2"), v("b", "1"), v("c", "1")] }, { total: "40" }));
    expect(e.shares.map((s) => [s.amount, s.splitInput])).toEqual([
      [2000, 20000],
      [1000, 10000],
      [1000, 10000],
    ]);
    expect(ok(draft({ type: "shares", values: [v("a", "1.5"), v("b", "0.5")] }, { total: "20" })).shares.map((s) => s.amount)).toEqual([
      1500, 500,
    ]);
    expect(fail(draft({ type: "shares", values: [v("a", "0"), v("b", "0")] })).message).toBe("Give at least one person a share");
    expect(fail(draft({ type: "shares", values: [v("a", "-1")] })).message).toMatch(/^Shares: /);
  });

  it("adjustment", () => {
    const e = ok(draft({ type: "adjustment", values: [v("a", "6"), v("b", ""), v("c", "-3")] }, { total: "90" }));
    expect(e.shares.map((s) => [s.amount, s.splitInput])).toEqual([
      [3500, 600],
      [2900, 0],
      [2600, -300],
    ]);
    // All blank = plain equal split.
    expect(ok(draft({ type: "adjustment", values: [v("a", ""), v("b", "")] })).shares.map((s) => s.amount)).toEqual([1500, 1500]);
    expect(fail(draft({ type: "adjustment", values: [v("a", "50"), v("b", "")] })).message).toBe(
      "The adjustments are larger than the amount",
    );
  });

  it("surfaces other split errors as split-field messages", () => {
    expect(fail(draft({ type: "equal", participants: ["a", "a"] }))).toEqual({
      field: "split",
      message: "Each participant may appear only once",
    });
    expect(fail(draft({ type: "exact", values: [v("a", "15"), v("a", "15")] })).message).toBe(
      "Each participant may appear only once",
    );
  });

  it("rethrows programming errors (malformed drafts)", () => {
    expect(() => buildExpense({ ...draft({ type: "exact", values: [] }), split: { type: "exact" } as never })).toThrow(TypeError);
  });
});

describe("buildExpense: itemized", () => {
  const lines = (overrides: Partial<ExpenseDraft> = {}) =>
    draft(
      {
        type: "itemized",
        lines: [
          { kind: "item", name: "Burger", amount: "12", assignments: [{ participantId: "a" }] },
          { kind: "item", name: " Fries ", amount: "6", assignments: [{ participantId: "a" }, { participantId: "b", weight: 2 }] },
          { kind: "tax", name: "", amount: "1.80", assignments: [] },
          { kind: "tip", name: "Tip", amount: "3.01", assignments: [], distribution: "equal" },
        ],
      },
      { total: "ignored", ...overrides },
    );

  it("computes totals, shares, items and breakdown", () => {
    const e = ok(lines());
    expect(e.total).toBe(2281);
    expect(e.shares).toEqual([
      { participantId: "a", amount: 1691, splitInput: null },
      { participantId: "b", amount: 590, splitInput: null },
    ]);
    expect(e.items).toEqual([
      { kind: "item", name: "Burger", amount: 1200, assignments: [{ participantId: "a", weight: 1 }] },
      {
        kind: "item",
        name: "Fries",
        amount: 600,
        assignments: [
          { participantId: "a", weight: 1 },
          { participantId: "b", weight: 2 },
        ],
      },
      { kind: "tax", name: "tax", amount: 180, assignments: [] },
      // Equal charges are stored as an assignment to everyone with items.
      {
        kind: "tip",
        name: "Tip",
        amount: 301,
        assignments: [
          { participantId: "a", weight: 1 },
          { participantId: "b", weight: 1 },
        ],
      },
    ]);
    expect(e.breakdown?.[1]).toEqual({ participantId: "b", items: 400, charges: 190, discounts: 0, owed: 590 });
  });

  it("validates lines", () => {
    expect(fail(draft({ type: "itemized", lines: [] })).message).toBe("Add at least one item");
    expect(
      fail(draft({ type: "itemized", lines: [{ kind: "item", name: " ", amount: "1", assignments: [{ participantId: "a" }] }] })).message,
    ).toBe("Item 1 needs a name");
    expect(fail(draft({ type: "itemized", lines: [{ kind: "item", name: "X", amount: "1", assignments: [] }] })).message).toBe(
      "Assign every item to at least one person",
    );
    expect(
      fail(draft({ type: "itemized", lines: [{ kind: "item", name: "X", amount: "1.001", assignments: [{ participantId: "a" }] }] }))
        .message,
    ).toMatch(/^Line 1: /);
    expect(
      fail(
        draft({
          type: "itemized",
          lines: [
            { kind: "item", name: "X", amount: "5", assignments: [{ participantId: "a" }] },
            { kind: "item", name: "Y", amount: "-2", assignments: [{ participantId: "b" }] },
          ],
        }),
      ).message,
    ).toBe("Someone would end up being owed money; check discounts and negative lines");
    expect(
      fail(
        draft({
          type: "itemized",
          lines: [
            { kind: "item", name: "X", amount: "5", assignments: [{ participantId: "a" }] },
            { kind: "discount", name: "", amount: "-5", assignments: [] },
          ],
        }),
      ).message,
    ).toBe("The receipt adds up to zero");
    expect(fail(draft({ type: "itemized", lines: [{ kind: "tax", name: "", amount: "1", assignments: [], distribution: "equal" }] })).message).toBe(
      "Assign every item to at least one person",
    );
    expect(
      fail(
        draft({
          type: "itemized",
          lines: [
            { kind: "item", name: "X", amount: "5", assignments: [{ participantId: "a" }] },
            { kind: "item", name: "Y", amount: "-2", assignments: [{ participantId: "b" }] },
            { kind: "tax", name: "", amount: "1", assignments: [] },
          ],
        }),
      ).message,
    ).toBe("Tax and tip can't be split when some people's items are negative");
    expect(
      fail(
        draft({
          type: "itemized",
          lines: [
            { kind: "item", name: "X", amount: "5", assignments: [{ participantId: "a" }] },
            { kind: "item", name: "Y", amount: "-5", assignments: [{ participantId: "a" }] },
            { kind: "tax", name: "", amount: "1", assignments: [] },
          ],
        }),
      ).message,
    ).toBe("Tax and tip need someone with items to split across");
    expect(
      fail(draft({ type: "itemized", lines: [{ kind: "item", name: "X", amount: "5", assignments: [{ participantId: "a", weight: -1 }] }] }))
        .message,
    ).toMatch(/Weights must be non-negative/);
  });
});

describe("draftFromExpense round-trips", () => {
  const cases: ExpenseDraft[] = [
    draft({ type: "equal", participants: ["a", "b", "c"] }, { total: "10.00" }),
    draft({ type: "exact", values: [v("a", "10.00"), v("b", "20.00")] }, { paidBy: { mode: "multiple", amounts: [v("a", "25.00"), v("b", "5.00")] } }),
    draft({ type: "percentage", values: [v("a", "50"), v("b", "33.33"), v("c", "16.67")] }),
    draft({ type: "shares", values: [v("a", "1.5"), v("b", "1")] }),
    draft({ type: "adjustment", values: [v("a", "6.00"), v("b", "")] }, { total: "90.00" }),
    draft(
      {
        type: "itemized",
        lines: [
          { kind: "item", name: "A", originalName: "Ä", quantity: "0.5", unitPrice: "24.00", amount: "12.00", assignments: [{ participantId: "a", weight: 1 }] },
          { kind: "item", name: "B", amount: "8.00", assignments: [{ participantId: "b", weight: 1 }] },
          { kind: "tax", name: "Tax", amount: "2.00", assignments: [] },
        ],
      },
      { total: "22.00" },
    ),
  ];

  it.each(cases.map((c) => [c.split.type, c]))("%s", (_type, original) => {
    const built = ok(original);
    const back = draftFromExpense({
      currency: original.currency,
      total: built.total,
      splitType: original.split.type,
      payers: built.payers,
      shares: built.shares,
      items: built.items,
    });
    expect(back).toEqual(original);
    expect(ok(back)).toEqual(built);
  });

  it("treats a missing split input as zero", () => {
    const back = draftFromExpense({
      currency: "USD",
      total: 100,
      splitType: "percentage",
      payers: [{ participantId: "a", amount: 100 }],
      shares: [{ participantId: "a", amount: 100, splitInput: null }],
      items: [],
    });
    expect(back.split).toEqual({ type: "percentage", values: [v("a", "0")] });
    const shares = draftFromExpense({
      currency: "USD",
      total: 100,
      splitType: "shares",
      payers: [{ participantId: "a", amount: 100 }],
      shares: [{ participantId: "a", amount: 100, splitInput: null }],
      items: [],
    });
    expect(shares.split).toEqual({ type: "shares", values: [v("a", "0")] });
  });
});

describe("defaultSplitDraft", () => {
  const members = [
    { participantId: "a", weight: 6000 },
    { participantId: "b", weight: null },
  ];
  it("equal includes everyone", () => {
    expect(defaultSplitDraft("equal", members)).toEqual({ type: "equal", participants: ["a", "b"] });
  });
  it("percentage formats basis points", () => {
    expect(defaultSplitDraft("percentage", members)).toEqual({ type: "percentage", values: [v("a", "60"), v("b", "")] });
  });
  it("shares uses share counts", () => {
    expect(defaultSplitDraft("shares", [{ participantId: "a", weight: 2 }])).toEqual({ type: "shares", values: [v("a", "2")] });
  });
});

import { sumDraftLines } from "./expense-draft";

describe("sumDraftLines", () => {
  it("sums lines regardless of assignment, treating blanks as zero", () => {
    expect(
      sumDraftLines(
        [
          { kind: "item", name: "A", amount: "980", assignments: [] },
          { kind: "item", name: "B", amount: "", assignments: [] },
          { kind: "discount", name: "C", amount: "-80", assignments: [] },
        ],
        "JPY",
      ),
    ).toBe(900);
  });
  it("returns null for invalid amounts", () => {
    expect(sumDraftLines([{ kind: "item", name: "A", amount: "9.5", assignments: [] }], "JPY")).toBeNull();
  });
});

import { lineTotalFromUnit, previewItemized } from "./expense-draft";

describe("item quantities", () => {
  it("stores quantity and unit price on built items", () => {
    const e = ok(
      draft({
        type: "itemized",
        lines: [{ kind: "item", name: "Apples", quantity: " 0.452 ", unitPrice: "2.99", amount: "1.35", assignments: [{ participantId: "a" }] }],
      }),
    );
    expect(e.items[0]).toMatchObject({ quantity: "0.452", unitPrice: 299, amount: 135 });
  });

  it("treats a blank quantity/unit price as absent and rejects bad ones", () => {
    const e = ok(
      draft({ type: "itemized", lines: [{ kind: "item", name: "A", quantity: " ", unitPrice: "", amount: "1", assignments: [{ participantId: "a" }] }] }),
    );
    expect(e.items[0]).not.toHaveProperty("quantity");
    expect(e.items[0]).not.toHaveProperty("unitPrice");
    for (const quantity of ["0", "-1", "abc", "1.2345"]) {
      expect(
        fail(draft({ type: "itemized", lines: [{ kind: "item", name: "A", quantity, amount: "1", assignments: [{ participantId: "a" }] }] })).message,
      ).toBe("Line 1: quantity must be a positive number");
    }
    expect(
      fail(draft({ type: "itemized", lines: [{ kind: "item", name: "A", unitPrice: "x", amount: "1", assignments: [{ participantId: "a" }] }] })).message,
    ).toMatch(/^Line 1 unit price: /);
  });
});

describe("lineTotalFromUnit", () => {
  it.each([
    ["3.25", "2", "USD", "6.50"],
    ["1.99", "0.452", "EUR", "0.90"],
    ["600", "3", "JPY", "1800"],
    ["0.125", "1.5", "KWD", "0.188"],
  ])("%s × %s %s = %s", (unit, qty, currency, expected) => {
    expect(lineTotalFromUnit(unit, qty, currency)).toBe(expected);
  });
  it("returns null for invalid input", () => {
    expect(lineTotalFromUnit("x", "1", "USD")).toBeNull();
    expect(lineTotalFromUnit("1", "0", "USD")).toBeNull();
    expect(lineTotalFromUnit("1", "", "USD")).toBeNull();
  });
});

describe("previewItemized", () => {
  const lines = [
    { kind: "item" as const, name: "Ramen", amount: "980", assignments: [{ participantId: "a" }] },
    { kind: "item" as const, name: "Gyoza", amount: "480", assignments: [] },
    { kind: "item" as const, name: "Beer", amount: "1200", assignments: [{ participantId: "b" }] },
    { kind: "service" as const, name: "Service", amount: "218", assignments: [] },
  ];

  it("computes totals over assigned items and reports what's left", () => {
    const p = previewItemized(lines, "JPY");
    expect(p.unassigned).toEqual([1]);
    expect(p.unassignedTotal).toBe(480);
    expect(p.total).toBe(2878);
    expect(p.error).toBeNull();
    expect(p.breakdown.map((b) => [b.participantId, b.owed])).toEqual([
      ["a", 1078],
      ["b", 1320],
    ]);
  });

  it("is empty before anything is assigned", () => {
    expect(previewItemized(lines.map((l) => ({ ...l, assignments: [] })), "JPY")).toEqual({
      breakdown: [],
      unassigned: [0, 1, 2],
      unassignedTotal: 2660,
      total: 2878,
      error: null,
    });
    expect(previewItemized([{ ...lines[3], assignments: [{ participantId: "a" }] }], "JPY").breakdown).toEqual([]);
  });

  it("reports errors in the assigned part", () => {
    const p = previewItemized([{ ...lines[0], amount: "9.5" }], "JPY");
    expect(p.total).toBeNull();
    expect(p.unassignedTotal).toBe(0);
    expect(p.error).toMatch(/^Line 1: /);
    expect(previewItemized([lines[0], { ...lines[1], amount: "4.5" }], "JPY").unassignedTotal).toBe(0);
  });
});
