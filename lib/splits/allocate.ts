import { SplitError } from "./errors";
import { assertMinor, normalizeZero, type Minor } from "./money";

/**
 * Splits `total` into integer parts proportional to `weights` using the
 * largest-remainder method. Parts always sum exactly to `total`.
 *
 * - Weights are non-negative safe integers; a zero weight always gets 0.
 * - Negative totals are allocated by magnitude and negated (refunds mirror charges).
 * - Leftover units go to the largest fractional remainders; ties go to the earlier index,
 *   so results are deterministic.
 * - Uses BigInt internally so total × weight can't overflow.
 */
export function allocate(total: Minor, weights: readonly number[]): Minor[] {
  assertMinor(total, "total");
  if (weights.length === 0) throw new SplitError("NO_PARTICIPANTS", "Cannot allocate among zero parts");
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new SplitError("INVALID_WEIGHT", `Weights must be non-negative integers, got ${w}`);
    }
  }

  const weightSum = weights.reduce((acc, w) => acc + BigInt(w), 0n);
  if (weightSum === 0n) {
    if (total === 0) return weights.map(() => 0);
    throw new SplitError("ZERO_WEIGHTS", "Cannot allocate a non-zero total when all weights are zero");
  }

  const magnitude = BigInt(Math.abs(total));
  const parts: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let allocated = 0n;

  weights.forEach((w, index) => {
    const product = magnitude * BigInt(w);
    const part = product / weightSum;
    parts.push(part);
    allocated += part;
    remainders.push({ index, remainder: product % weightSum });
  });

  // Fewer than weights.length units are left over, and only parts with a non-zero remainder receive one.
  let leftover = Number(magnitude - allocated);
  remainders.sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const { index } of remainders) {
    if (leftover === 0) break;
    parts[index] += 1n;
    leftover -= 1;
  }

  return parts.map((p) => normalizeZero(total < 0 ? -Number(p) : Number(p)));
}

/** Equal split with largest-remainder rounding: allocateEqually(100, 3) → [34, 33, 33]. */
export function allocateEqually(total: Minor, count: number): Minor[] {
  return allocate(
    total,
    Array.from({ length: count }, () => 1),
  );
}
