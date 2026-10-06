import { allocate, allocateEqually } from "./allocate";
import { SplitError } from "./errors";
import { assertMinor, normalizeZero, sign, sumMinor, type Minor } from "./money";
import type { ParticipantAmount, ParticipantId } from "./types";
import { assertNonZeroTotal, assertSignsMatch, assertUniqueIds } from "./validate";

export type ItemizedLineKind = "item" | "tax" | "tip" | "service" | "fee" | "discount";

export type ItemAssignment = {
  participantId: ParticipantId;
  /** Relative portion of the line (default 1). 2 = twice as much as weight 1. */
  weight?: number;
};

export type ItemizedLine = {
  kind: ItemizedLineKind;
  /** Signed minor units. Discounts, returns and refunds are negative. */
  amount: Minor;
  /**
   * Who shares this line. Required for items. For charges/discounts, assigning
   * applies the line to just those people; leaving it empty distributes it
   * across everyone with items.
   */
  assignments?: ItemAssignment[];
  /** How an unassigned charge/discount is spread: by item subtotal (default) or equally. */
  distribution?: "proportional" | "equal";
};

export type ItemizedBreakdown = {
  participantId: ParticipantId;
  /** Sum of item lines (including negative item lines). */
  items: Minor;
  /** Tax + tip + service + fees. */
  charges: Minor;
  /** Discounts (usually negative). */
  discounts: Minor;
  /** items + charges + discounts. */
  owed: Minor;
};

export type ItemizedResult = {
  total: Minor;
  shares: ParticipantAmount[];
  breakdown: ItemizedBreakdown[];
};

type Bucket = "items" | "charges" | "discounts";

function bucketFor(kind: ItemizedLineKind): Bucket {
  if (kind === "item") return "items";
  if (kind === "discount") return "discounts";
  return "charges";
}

/**
 * Itemized split.
 * 1. Each assigned line is split among its assignees by weight (largest remainder).
 * 2. Each unassigned charge/discount is spread over everyone with items, in proportion to
 *    their item subtotal (or equally if requested), again with largest-remainder rounding.
 * Every line is allocated exactly, so shares sum to the receipt total.
 * Participants appear in order of first assignment.
 */
export function computeItemizedSplit(lines: readonly ItemizedLine[]): ItemizedResult {
  if (lines.length === 0) throw new SplitError("NO_PARTICIPANTS", "An itemized split needs at least one line");

  const order: ParticipantId[] = [];
  const totals = new Map<ParticipantId, Record<Bucket, Minor>>();
  const row = (id: ParticipantId) => {
    let r = totals.get(id);
    if (!r) {
      r = { items: 0, charges: 0, discounts: 0 };
      totals.set(id, r);
      order.push(id);
    }
    return r;
  };

  const unassigned: ItemizedLine[] = [];

  for (const line of lines) {
    assertMinor(line.amount, `${line.kind} line amount`);
    const assignments = line.assignments ?? [];
    if (assignments.length === 0) {
      if (line.kind === "item") throw new SplitError("UNASSIGNED_ITEM", "Every item must be assigned to someone");
      unassigned.push(line);
      continue;
    }
    const ids = assignments.map((a) => a.participantId);
    assertUniqueIds(ids);
    const parts = allocate(
      line.amount,
      assignments.map((a) => a.weight ?? 1),
    );
    const bucket = bucketFor(line.kind);
    ids.forEach((id, i) => (row(id)[bucket] += parts[i]));
  }

  if (unassigned.length > 0) {
    if (order.length === 0) {
      throw new SplitError("UNASSIGNED_ITEM", "Charges and discounts need at least one assigned item");
    }
    const weights = proportionalWeights(order.map((id) => totals.get(id)!.items));
    for (const line of unassigned) {
      const parts =
        line.distribution === "equal" ? allocateEqually(line.amount, order.length) : allocate(line.amount, weights);
      const bucket = bucketFor(line.kind);
      order.forEach((id, i) => (row(id)[bucket] += parts[i]));
    }
  }

  const total = sumMinor(lines.map((l) => l.amount));
  assertNonZeroTotal(total);

  const breakdown = order.map((participantId) => {
    const r = totals.get(participantId)!;
    return {
      participantId,
      items: normalizeZero(r.items),
      charges: normalizeZero(r.charges),
      discounts: normalizeZero(r.discounts),
      owed: normalizeZero(r.items + r.charges + r.discounts),
    };
  });
  const shares = breakdown.map((b) => ({ participantId: b.participantId, amount: b.owed }));
  assertSignsMatch(total, shares, "Share");

  return { total, shares, breakdown };
}

/**
 * Weights for proportional distribution: each person's item subtotal magnitude.
 * Subtotals must all share one sign (a refund receipt is all negative).
 */
function proportionalWeights(subtotals: readonly Minor[]): number[] {
  const signs = new Set(subtotals.filter((s) => s !== 0).map(sign));
  if (signs.size > 1) {
    throw new SplitError(
      "MIXED_SIGN_SUBTOTALS",
      "Cannot distribute charges proportionally when some people's items are negative and others positive",
    );
  }
  if (signs.size === 0) {
    throw new SplitError("ZERO_WEIGHTS", "Cannot distribute charges proportionally when item subtotals are zero");
  }
  return subtotals.map((s) => Math.abs(s));
}
