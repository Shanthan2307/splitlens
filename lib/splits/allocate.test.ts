import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocate, allocateEqually } from "./allocate";

describe("allocate", () => {
  it("splits evenly with largest-remainder rounding", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(200, [1, 1, 1])).toEqual([67, 67, 66]);
  });

  it("gives leftover units to the largest remainders, not just the first index", () => {
    // Exact: 10*1/6=1.67, 10*2/6=3.33, 10*3/6=5 → floors 1,3,5 (sum 9); largest remainder is index 0.
    expect(allocate(10, [1, 2, 3])).toEqual([2, 3, 5]);
  });

  it("breaks ties by earlier index", () => {
    expect(allocate(1, [1, 1])).toEqual([1, 0]);
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it("mirrors negative totals (refunds)", () => {
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });

  it("gives zero-weight parts nothing", () => {
    expect(allocate(101, [0, 1, 0, 1])).toEqual([0, 51, 0, 50]);
  });

  it("returns zeros for a zero total, even with zero weights", () => {
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(0, [0, 0])).toEqual([0, 0]);
    expect(Object.is(allocate(0, [1])[0], 0)).toBe(true);
  });

  it("does not overflow on large amounts and weights", () => {
    const total = Number.MAX_SAFE_INTEGER;
    const parts = allocate(total, [1_000_000_000_000, 3_000_000_000_000]);
    expect(parts[0] + parts[1]).toBe(total);
  });

  it("rejects invalid input", () => {
    expect(() => allocate(100, [])).toThrow(expect.objectContaining({ code: "NO_PARTICIPANTS" }));
    expect(() => allocate(100, [0, 0])).toThrow(expect.objectContaining({ code: "ZERO_WEIGHTS" }));
    expect(() => allocate(100, [1, -1])).toThrow(expect.objectContaining({ code: "INVALID_WEIGHT" }));
    expect(() => allocate(100, [1.5])).toThrow(expect.objectContaining({ code: "INVALID_WEIGHT" }));
    expect(() => allocate(1.5, [1])).toThrow(expect.objectContaining({ code: "INVALID_AMOUNT" }));
  });

  it("property: parts sum to total, share its sign, and are within one unit of exact", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e9, max: 1e9 }),
        fc.array(fc.integer({ min: 0, max: 1e6 }), { minLength: 1, maxLength: 20 }).filter((w) => w.some((x) => x > 0)),
        (total, weights) => {
          const parts = allocate(total, weights);
          const weightSum = weights.reduce((a, b) => a + b, 0);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          parts.forEach((p, i) => {
            if (weights[i] === 0) expect(p).toBe(0);
            if (p !== 0) expect(Math.sign(p)).toBe(Math.sign(total));
            expect(Math.abs(p - (total * weights[i]) / weightSum)).toBeLessThan(1);
          });
        },
      ),
    );
  });
});

describe("allocateEqually", () => {
  it("splits a zero-decimal amount (JPY) to the yen", () => {
    expect(allocateEqually(1000, 3)).toEqual([334, 333, 333]);
  });
  it("rejects zero people", () => {
    expect(() => allocateEqually(100, 0)).toThrow(expect.objectContaining({ code: "NO_PARTICIPANTS" }));
  });
});
