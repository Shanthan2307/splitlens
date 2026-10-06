import { allocate, allocateEqually } from "./allocate";
import { SplitError } from "./errors";
import { computeItemizedSplit, type ItemizedLine } from "./itemized";
import { assertMinor, normalizeZero, sumMinor, type Minor } from "./money";
import type { ParticipantAmount, ParticipantId } from "./types";
import { assertNonZeroTotal, assertSignsMatch, assertUniqueIds } from "./validate";

export const BASIS_POINTS_100_PERCENT = 10_000;

export type SplitInput =
  /** Equal among the selected people. */
  | { type: "equal"; total: Minor; participants: ParticipantId[] }
  /** Explicit amounts that must sum to the total. */
  | { type: "exact"; total: Minor; amounts: ParticipantAmount[] }
  /** Percentages in basis points (2500 = 25%), summing to 10000. */
  | { type: "percentage"; total: Minor; percentages: { participantId: ParticipantId; basisPoints: number }[] }
  /** Integer share counts, e.g. 2:1:1. Callers scale fractional shares (1.5 → 15 with 10 for others). */
  | { type: "shares"; total: Minor; shares: { participantId: ParticipantId; shares: number }[] }
  /** Equal split of (total − adjustments), then each person's +/- adjustment added back. */
  | { type: "adjustment"; total: Minor; adjustments: ParticipantAmount[] }
  /** Line items assigned to people; charges/discounts distributed proportionally. Total = sum of lines. */
  | { type: "itemized"; lines: ItemizedLine[] };

export type SplitResult = { total: Minor; shares: ParticipantAmount[] };

/**
 * Computes what each participant owes. Shares always sum exactly to the total
 * and are zero or the same sign as the total. Output order follows input order.
 */
export function computeSplit(input: SplitInput): SplitResult {
  switch (input.type) {
    case "equal":
      return splitEqual(input.total, input.participants);
    case "exact":
      return splitExact(input.total, input.amounts);
    case "percentage":
      return splitPercentage(input.total, input.percentages);
    case "shares":
      return splitShares(input.total, input.shares);
    case "adjustment":
      return splitAdjustment(input.total, input.adjustments);
    case "itemized": {
      const { total, shares } = computeItemizedSplit(input.lines);
      return { total, shares };
    }
  }
}

function zip(ids: readonly ParticipantId[], amounts: readonly Minor[]): ParticipantAmount[] {
  return ids.map((participantId, i) => ({ participantId, amount: amounts[i] }));
}

function splitEqual(total: Minor, participants: ParticipantId[]): SplitResult {
  assertNonZeroTotal(total);
  assertUniqueIds(participants);
  return { total, shares: zip(participants, allocateEqually(total, participants.length)) };
}

function splitExact(total: Minor, amounts: ParticipantAmount[]): SplitResult {
  assertNonZeroTotal(total);
  assertUniqueIds(amounts.map((a) => a.participantId));
  amounts.forEach((a) => assertMinor(a.amount, `amount for ${a.participantId}`));
  const sum = sumMinor(amounts.map((a) => a.amount));
  if (sum !== total) {
    throw new SplitError("SUM_MISMATCH", `Exact amounts sum to ${sum} but the total is ${total}`);
  }
  assertSignsMatch(total, amounts, "Amount");
  return { total, shares: amounts.map((a) => ({ participantId: a.participantId, amount: normalizeZero(a.amount) })) };
}

function splitPercentage(
  total: Minor,
  percentages: { participantId: ParticipantId; basisPoints: number }[],
): SplitResult {
  assertNonZeroTotal(total);
  const ids = percentages.map((p) => p.participantId);
  assertUniqueIds(ids);
  const weights = percentages.map((p) => p.basisPoints);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum !== BASIS_POINTS_100_PERCENT) {
    throw new SplitError("PERCENT_SUM", `Percentages sum to ${sum / 100}% instead of 100%`);
  }
  // allocate() rejects negative or fractional basis points.
  return { total, shares: zip(ids, allocate(total, weights)) };
}

function splitShares(total: Minor, shares: { participantId: ParticipantId; shares: number }[]): SplitResult {
  assertNonZeroTotal(total);
  const ids = shares.map((s) => s.participantId);
  assertUniqueIds(ids);
  return { total, shares: zip(ids, allocate(total, shares.map((s) => s.shares))) };
}

function splitAdjustment(total: Minor, adjustments: ParticipantAmount[]): SplitResult {
  assertNonZeroTotal(total);
  const ids = adjustments.map((a) => a.participantId);
  assertUniqueIds(ids);
  adjustments.forEach((a) => assertMinor(a.amount, `adjustment for ${a.participantId}`));
  const remainder = total - sumMinor(adjustments.map((a) => a.amount));
  const equalParts = allocateEqually(remainder, adjustments.length);
  const shares = adjustments.map((a, i) => ({
    participantId: a.participantId,
    amount: normalizeZero(equalParts[i] + a.amount),
  }));
  assertSignsMatch(total, shares, "Share");
  return { total, shares };
}
