import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeSplit, type SplitInput } from "./split";

const amounts = (input: SplitInput) => computeSplit(input).shares.map((s) => s.amount);

describe("equal", () => {
  it("splits among the selected people only", () => {
    expect(computeSplit({ type: "equal", total: 1000, participants: ["a", "c"] })).toEqual({
      total: 1000,
      shares: [
        { participantId: "a", amount: 500 },
        { participantId: "c", amount: 500 },
      ],
    });
  });
  it("rounds so the shares sum exactly", () => {
    expect(amounts({ type: "equal", total: 1000, participants: ["a", "b", "c"] })).toEqual([334, 333, 333]);
  });
  it("handles zero-decimal currencies (JPY/KRW amounts are whole units)", () => {
    expect(amounts({ type: "equal", total: 10000, participants: ["a", "b", "c"] })).toEqual([3334, 3333, 3333]);
    expect(amounts({ type: "equal", total: 7, participants: ["a", "b"] })).toEqual([4, 3]);
  });
  it("handles three-decimal currencies (KWD 10.000 / 3)", () => {
    expect(amounts({ type: "equal", total: 10000, participants: ["a", "b", "c"] })).toEqual([3334, 3333, 3333]);
  });
  it("splits refunds (negative totals)", () => {
    expect(amounts({ type: "equal", total: -1000, participants: ["a", "b", "c"] })).toEqual([-334, -333, -333]);
  });
  it("supports a single person", () => {
    expect(amounts({ type: "equal", total: 999, participants: ["a"] })).toEqual([999]);
  });
  it("rejects bad input", () => {
    expect(() => computeSplit({ type: "equal", total: 0, participants: ["a"] })).toThrow(
      expect.objectContaining({ code: "ZERO_TOTAL" }),
    );
    expect(() => computeSplit({ type: "equal", total: 10, participants: [] })).toThrow(
      expect.objectContaining({ code: "NO_PARTICIPANTS" }),
    );
    expect(() => computeSplit({ type: "equal", total: 10, participants: ["a", "a"] })).toThrow(
      expect.objectContaining({ code: "DUPLICATE_PARTICIPANT" }),
    );
    expect(() => computeSplit({ type: "equal", total: 10.5, participants: ["a"] })).toThrow(
      expect.objectContaining({ code: "INVALID_AMOUNT" }),
    );
  });
});

describe("exact", () => {
  it("accepts amounts that sum to the total, including zero", () => {
    expect(
      amounts({
        type: "exact",
        total: 1000,
        amounts: [
          { participantId: "a", amount: 700 },
          { participantId: "b", amount: 300 },
          { participantId: "c", amount: 0 },
        ],
      }),
    ).toEqual([700, 300, 0]);
  });
  it("accepts refunds", () => {
    expect(
      amounts({
        type: "exact",
        total: -500,
        amounts: [
          { participantId: "a", amount: -200 },
          { participantId: "b", amount: -300 },
        ],
      }),
    ).toEqual([-200, -300]);
  });
  it("rejects a sum mismatch", () => {
    expect(() =>
      computeSplit({ type: "exact", total: 1000, amounts: [{ participantId: "a", amount: 999 }] }),
    ).toThrow(expect.objectContaining({ code: "SUM_MISMATCH" }));
  });
  it("rejects amounts with the wrong sign", () => {
    expect(() =>
      computeSplit({
        type: "exact",
        total: 100,
        amounts: [
          { participantId: "a", amount: 150 },
          { participantId: "b", amount: -50 },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "SIGN_MISMATCH" }));
  });
  it("rejects non-integer amounts", () => {
    expect(() =>
      computeSplit({ type: "exact", total: 100, amounts: [{ participantId: "a", amount: 100.5 }] }),
    ).toThrow(expect.objectContaining({ code: "INVALID_AMOUNT" }));
  });
});

describe("percentage", () => {
  it("splits by basis points", () => {
    expect(
      amounts({
        type: "percentage",
        total: 10000,
        percentages: [
          { participantId: "a", basisPoints: 5000 },
          { participantId: "b", basisPoints: 2500 },
          { participantId: "c", basisPoints: 2500 },
        ],
      }),
    ).toEqual([5000, 2500, 2500]);
  });
  it("rounds 33.33/33.33/33.34% of ¥1000 to whole yen", () => {
    expect(
      amounts({
        type: "percentage",
        total: 1000,
        percentages: [
          { participantId: "a", basisPoints: 3333 },
          { participantId: "b", basisPoints: 3333 },
          { participantId: "c", basisPoints: 3334 },
        ],
      }),
    ).toEqual([333, 333, 334]);
  });
  it("rejects percentages that don't total 100%", () => {
    expect(() =>
      computeSplit({ type: "percentage", total: 100, percentages: [{ participantId: "a", basisPoints: 9999 }] }),
    ).toThrow(expect.objectContaining({ code: "PERCENT_SUM" }));
  });
  it("rejects negative or fractional basis points", () => {
    expect(() =>
      computeSplit({
        type: "percentage",
        total: 100,
        percentages: [
          { participantId: "a", basisPoints: 10001 },
          { participantId: "b", basisPoints: -1 },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_WEIGHT" }));
  });
});

describe("shares", () => {
  it("splits 2:1:1", () => {
    expect(
      amounts({
        type: "shares",
        total: 1000,
        shares: [
          { participantId: "a", shares: 2 },
          { participantId: "b", shares: 1 },
          { participantId: "c", shares: 1 },
        ],
      }),
    ).toEqual([500, 250, 250]);
  });
  it("rounds uneven shares exactly (KWD 1.000 split 2:2:3)", () => {
    expect(
      amounts({
        type: "shares",
        total: 1000,
        shares: [
          { participantId: "a", shares: 2 },
          { participantId: "b", shares: 2 },
          { participantId: "c", shares: 3 },
        ],
      }),
    ).toEqual([286, 286, 428]);
  });
  it("allows a zero share but not all zeros", () => {
    expect(
      amounts({
        type: "shares",
        total: 10,
        shares: [
          { participantId: "a", shares: 0 },
          { participantId: "b", shares: 1 },
        ],
      }),
    ).toEqual([0, 10]);
    expect(() =>
      computeSplit({ type: "shares", total: 10, shares: [{ participantId: "a", shares: 0 }] }),
    ).toThrow(expect.objectContaining({ code: "ZERO_WEIGHTS" }));
  });
});

describe("adjustment", () => {
  it("splits the remainder equally, then applies adjustments", () => {
    // $90 dinner; a had a $15 extra drink, c gets $3 off: (9000 - 1500 + 300) / 3 = 2600 each.
    expect(
      amounts({
        type: "adjustment",
        total: 9000,
        adjustments: [
          { participantId: "a", amount: 1500 },
          { participantId: "b", amount: 0 },
          { participantId: "c", amount: -300 },
        ],
      }),
    ).toEqual([4100, 2600, 2300]);
  });
  it("rounds the equal part exactly", () => {
    const result = amounts({
      type: "adjustment",
      total: 1001,
      adjustments: [
        { participantId: "a", amount: 1 },
        { participantId: "b", amount: 0 },
        { participantId: "c", amount: 0 },
      ],
    });
    expect(result).toEqual([335, 333, 333]);
    expect(result.reduce((x, y) => x + y)).toBe(1001);
  });
  it("supports refunds", () => {
    expect(
      amounts({
        type: "adjustment",
        total: -600,
        adjustments: [
          { participantId: "a", amount: -100 },
          { participantId: "b", amount: 0 },
        ],
      }),
    ).toEqual([-350, -250]);
  });
  it("rejects adjustments that push someone below zero", () => {
    expect(() =>
      computeSplit({
        type: "adjustment",
        total: 100,
        adjustments: [
          { participantId: "a", amount: 200 },
          { participantId: "b", amount: 0 },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "SIGN_MISMATCH" }));
  });
  it("rejects non-integer adjustments", () => {
    expect(() =>
      computeSplit({ type: "adjustment", total: 100, adjustments: [{ participantId: "a", amount: 0.5 }] }),
    ).toThrow(expect.objectContaining({ code: "INVALID_AMOUNT" }));
  });
});

describe("itemized via computeSplit", () => {
  it("returns total and shares", () => {
    expect(
      computeSplit({
        type: "itemized",
        lines: [
          { kind: "item", amount: 600, assignments: [{ participantId: "a" }] },
          { kind: "item", amount: 400, assignments: [{ participantId: "b" }] },
          { kind: "tax", amount: 100 },
        ],
      }),
    ).toEqual({
      total: 1100,
      shares: [
        { participantId: "a", amount: 660 },
        { participantId: "b", amount: 440 },
      ],
    });
  });
});

describe("property: every split sums exactly to its total", () => {
  const total = fc.integer({ min: -1e9, max: 1e9 }).filter((t) => t !== 0);
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
  const sum = (input: SplitInput) => amounts(input).reduce((a, b) => a + b, 0);

  it("equal", () => {
    fc.assert(
      fc.property(total, fc.integer({ min: 1, max: 30 }), (t, n) => {
        expect(sum({ type: "equal", total: t, participants: ids(n) })).toBe(t);
      }),
    );
  });

  it("shares", () => {
    fc.assert(
      fc.property(
        total,
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 30 }),
        (t, weights) => {
          const shares = weights.map((shares, i) => ({ participantId: `p${i}`, shares }));
          expect(sum({ type: "shares", total: t, shares })).toBe(t);
        },
      ),
    );
  });

  it("percentage", () => {
    fc.assert(
      fc.property(total, fc.array(fc.integer({ min: 0, max: 10000 }), { minLength: 1, maxLength: 10 }), (t, cuts) => {
        // Turn sorted cut points into basis points that total exactly 10000.
        const points = [0, ...cuts.sort((a, b) => a - b), 10000];
        const percentages = points.slice(1).map((p, i) => ({ participantId: `p${i}`, basisPoints: p - points[i] }));
        expect(sum({ type: "percentage", total: t, percentages })).toBe(t);
      }),
    );
  });
});
