import { SplitError } from "./errors";
import { computeItemizedSplit, type ItemAssignment, type ItemizedBreakdown, type ItemizedLineKind } from "./itemized";
import {
  formatMinor,
  formatScaled,
  parseScaled,
  parseBasisPoints,
  parseMajor,
  parseShareWeight,
  SHARE_DECIMALS,
  sumMinor,
  toMajorString,
  type Minor,
} from "./money";
import { validatePayers } from "./payers";
import { BASIS_POINTS_100_PERCENT, computeSplit } from "./split";
import type { ParticipantAmount, ParticipantId } from "./types";

/*
 * The expense form edits a draft of strings exactly as typed. buildExpense turns it
 * into exact minor-unit payers/shares (used for the live preview on the client and
 * authoritatively in the server action), and draftFromExpense goes the other way for editing.
 */

export type DraftValue = { participantId: ParticipantId; value: string };

export type DraftLine = {
  kind: ItemizedLineKind;
  name: string;
  /** As printed on the receipt, before translation. */
  originalName?: string;
  /** Decimal quantity as typed ("2", "0.452"); informational, amount is the line total. */
  quantity?: string;
  /** Price per unit in major units, when known. */
  unitPrice?: string;
  amount: string;
  /** Empty for charges/discounts spread across everyone. */
  assignments: ItemAssignment[];
  /** For unassigned charges: spread by item subtotal (default) or equally. */
  distribution?: "proportional" | "equal";
};

export type DraftPaidBy =
  | { mode: "single"; participantId: ParticipantId }
  | { mode: "multiple"; amounts: DraftValue[] };

export type DraftSplit =
  | { type: "equal"; participants: ParticipantId[] }
  /** exact & adjustment: amounts in major units; percentage: percent; shares: share count. */
  | { type: "exact" | "percentage" | "shares" | "adjustment"; values: DraftValue[] }
  | { type: "itemized"; lines: DraftLine[] };

export type ExpenseDraft = {
  currency: string;
  /** Major units as typed, e.g. "12.50". Negative for refunds. Ignored for itemized (sum of lines). */
  total: string;
  paidBy: DraftPaidBy;
  split: DraftSplit;
};

export type BuiltShare = ParticipantAmount & {
  /** Raw input stored alongside the share (see expense_shares.split_input). */
  splitInput: number | null;
};

export type BuiltItem = {
  kind: ItemizedLineKind;
  name: string;
  originalName?: string;
  /** Validated decimal string, up to 3 decimals. */
  quantity?: string;
  unitPrice?: Minor;
  amount: Minor;
  assignments: { participantId: ParticipantId; weight: number }[];
};

export type BuiltExpense = {
  total: Minor;
  payers: ParticipantAmount[];
  shares: BuiltShare[];
  items: BuiltItem[];
  breakdown: ItemizedBreakdown[] | null;
};

export type DraftErrorField = "total" | "paidBy" | "split";

export type DraftResult =
  | { ok: true; expense: BuiltExpense }
  | { ok: false; field: DraftErrorField; message: string };

const QUANTITY_DECIMALS = 3;

class DraftError extends Error {
  constructor(
    readonly field: DraftErrorField,
    message: string,
  ) {
    super(message);
  }
}

export function buildExpense(draft: ExpenseDraft, locale = "en"): DraftResult {
  try {
    return { ok: true, expense: build(draft, locale) };
  } catch (error) {
    if (error instanceof DraftError) return { ok: false, field: error.field, message: error.message };
    if (error instanceof SplitError) return { ok: false, field: "split", message: error.message };
    throw error;
  }
}

function build(draft: ExpenseDraft, locale: string): BuiltExpense {
  const money = (amount: Minor) => formatMinor(amount, draft.currency, locale);
  const parse = (input: string, field: DraftErrorField, label: string): Minor => {
    if (input.trim() === "") return 0;
    try {
      return parseMajor(input, draft.currency);
    } catch (error) {
      throw new DraftError(field, `${label}: ${(error as SplitError).message}`);
    }
  };

  try {
    formatMinor(0, draft.currency);
  } catch {
    throw new DraftError("total", "Choose a currency");
  }

  let total: Minor;
  let shares: BuiltShare[];
  let items: BuiltItem[] = [];
  let breakdown: ItemizedBreakdown[] | null = null;
  const split = draft.split;

  if (split.type === "itemized") {
    ({ total, shares, items, breakdown } = buildItemized(split.lines, parse));
  } else {
    if (draft.total.trim() === "") throw new DraftError("total", "Enter an amount");
    total = parse(draft.total, "total", "Amount");
    if (total === 0) throw new DraftError("total", "The amount must not be zero");
    shares = buildShares(total, split, parse, money);
  }

  return { total, payers: buildPayers(total, draft.paidBy, parse, money), shares, items, breakdown };
}

type Parse = (input: string, field: DraftErrorField, label: string) => Minor;

function buildShares(
  total: Minor,
  split: Exclude<DraftSplit, { type: "itemized" }>,
  parse: Parse,
  money: (amount: Minor) => string,
): BuiltShare[] {
  if (split.type === "equal") {
    if (split.participants.length === 0) throw new DraftError("split", "Choose at least one person to split with");
    const result = computeSplit({ type: "equal", total, participants: split.participants });
    return result.shares.map((s) => ({ ...s, splitInput: null }));
  }

  const values = split.values.filter((v) => v.value.trim() !== "");
  if (values.length === 0 && split.type !== "adjustment") {
    throw new DraftError("split", "Enter how to split the amount");
  }

  switch (split.type) {
    case "exact": {
      const amounts = values.map((v) => ({ participantId: v.participantId, amount: parse(v.value, "split", "Amount") }));
      const sum = sumMinor(amounts.map((a) => a.amount));
      if (sum !== total) {
        const diff = total - sum;
        throw new DraftError(
          "split",
          `The amounts add up to ${money(sum)}: ${money(Math.abs(diff))} ${Math.sign(diff) === Math.sign(total) ? "left" : "over"}`,
        );
      }
      return fromSplit(() => computeSplit({ type: "exact", total, amounts }), "Each amount must match the sign of the total", (s) => s.amount);
    }
    case "percentage": {
      const percentages = values.map((v) => ({
        participantId: v.participantId,
        basisPoints: parseOrFail(() => parseBasisPoints(v.value), "Percentages"),
      }));
      const sum = percentages.reduce((acc, p) => acc + p.basisPoints, 0);
      if (sum !== BASIS_POINTS_100_PERCENT) {
        const diff = BASIS_POINTS_100_PERCENT - sum;
        throw new DraftError(
          "split",
          `Percentages add up to ${formatScaled(sum, 2)}%: ${formatScaled(Math.abs(diff), 2)}% ${diff > 0 ? "left" : "over"}`,
        );
      }
      const bps = new Map(percentages.map((p) => [p.participantId, p.basisPoints]));
      return computeSplit({ type: "percentage", total, percentages }).shares.map((s) => ({
        ...s,
        splitInput: bps.get(s.participantId)!,
      }));
    }
    case "shares": {
      const shares = values.map((v) => ({
        participantId: v.participantId,
        shares: parseOrFail(() => parseShareWeight(v.value), "Shares"),
      }));
      if (shares.every((s) => s.shares === 0)) throw new DraftError("split", "Give at least one person a share");
      const weights = new Map(shares.map((s) => [s.participantId, s.shares]));
      return computeSplit({ type: "shares", total, shares }).shares.map((s) => ({
        ...s,
        splitInput: weights.get(s.participantId)!,
      }));
    }
    case "adjustment": {
      const adjustments = split.values.map((v) => ({
        participantId: v.participantId,
        amount: parse(v.value, "split", "Adjustment"),
      }));
      const byId = new Map(adjustments.map((a) => [a.participantId, a.amount]));
      return fromSplit(
        () => computeSplit({ type: "adjustment", total, adjustments }),
        "The adjustments are larger than the amount",
        (s) => byId.get(s.participantId)!,
      );
    }
  }
}

function parseOrFail(fn: () => number, label: string): number {
  try {
    return fn();
  } catch (error) {
    throw new DraftError("split", `${label}: ${(error as SplitError).message}`);
  }
}

function fromSplit(
  run: () => { shares: ParticipantAmount[] },
  signMessage: string,
  splitInput: (share: ParticipantAmount) => number,
): BuiltShare[] {
  try {
    return run().shares.map((s) => ({ ...s, splitInput: splitInput(s) }));
  } catch (error) {
    if (error instanceof SplitError && error.code === "SIGN_MISMATCH") throw new DraftError("split", signMessage);
    throw error;
  }
}

const ITEMIZED_MESSAGES: Partial<Record<SplitError["code"], string>> = {
  UNASSIGNED_ITEM: "Assign every item to at least one person",
  ZERO_TOTAL: "The receipt adds up to zero",
  SIGN_MISMATCH: "Someone would end up being owed money; check discounts and negative lines",
  MIXED_SIGN_SUBTOTALS: "Tax and tip can't be split when some people's items are negative",
  ZERO_WEIGHTS: "Tax and tip need someone with items to split across",
};

function buildItemized(lines: DraftLine[], parse: Parse) {
  if (lines.length === 0) throw new DraftError("split", "Add at least one item");

  const parsed = lines.map((line, i) => {
    const name = line.name.trim();
    if (line.kind === "item" && name === "") throw new DraftError("split", `Item ${i + 1} needs a name`);
    const quantity = line.quantity?.trim() || undefined;
    if (quantity !== undefined) {
      const scaled = (() => {
        try {
          return parseScaled(quantity, QUANTITY_DECIMALS);
        } catch {
          return 0;
        }
      })();
      if (scaled <= 0) throw new DraftError("split", `Line ${i + 1}: quantity must be a positive number`);
    }
    const unitPrice = line.unitPrice?.trim() ? parse(line.unitPrice, "split", `Line ${i + 1} unit price`) : undefined;
    return { ...line, name: name || line.kind, quantity, unitPrice, amount: parse(line.amount, "split", `Line ${i + 1}`) };
  });

  // "Equal" charges are stored as an assignment to everyone with items (weight 1), which
  // reproduces exactly the same allocation when the expense is reloaded and edited.
  const everyone = [...new Set(parsed.flatMap((l) => l.assignments.map((a) => a.participantId)))];
  const resolved = parsed.map((l) =>
    l.assignments.length === 0 && l.kind !== "item" && l.distribution === "equal" && everyone.length > 0
      ? { ...l, assignments: everyone.map((participantId) => ({ participantId, weight: 1 })) }
      : l,
  );

  try {
    const result = computeItemizedSplit(
      resolved.map((l) => ({ kind: l.kind, amount: l.amount, assignments: l.assignments })),
    );
    return {
      total: result.total,
      shares: result.shares.map((s) => ({ ...s, splitInput: null })),
      items: resolved.map((l) => ({
        kind: l.kind,
        name: l.name,
        ...(l.originalName ? { originalName: l.originalName } : {}),
        ...(l.quantity !== undefined ? { quantity: l.quantity } : {}),
        ...(l.unitPrice !== undefined ? { unitPrice: l.unitPrice } : {}),
        amount: l.amount,
        assignments: l.assignments.map((a) => ({ participantId: a.participantId, weight: a.weight ?? 1 })),
      })),
      breakdown: result.breakdown,
    };
  } catch (error) {
    // Non-SplitErrors have no code, so they fall through and are rethrown.
    const message = ITEMIZED_MESSAGES[(error as SplitError).code];
    if (message) throw new DraftError("split", message);
    throw error;
  }
}

function buildPayers(total: Minor, paidBy: DraftPaidBy, parse: Parse, money: (amount: Minor) => string) {
  if (paidBy.mode === "single") return [{ participantId: paidBy.participantId, amount: total }];

  const payers = paidBy.amounts
    .map((a) => ({ participantId: a.participantId, amount: parse(a.value, "paidBy", "Paid amount") }))
    .filter((p) => p.amount !== 0);
  if (payers.length === 0) throw new DraftError("paidBy", "Enter how much each person paid");

  try {
    validatePayers(total, payers);
  } catch (error) {
    const code = (error as SplitError).code;
    if (code === "SUM_MISMATCH") {
      const sum = sumMinor(payers.map((p) => p.amount));
      const diff = total - sum;
      throw new DraftError(
        "paidBy",
        `Paid amounts add up to ${money(sum)}: ${money(Math.abs(diff))} ${Math.sign(diff) === Math.sign(total) ? "left" : "over"}`,
      );
    }
    throw new DraftError("paidBy", "Each paid amount must match the sign of the total");
  }
  return payers;
}

// ----------------------------------------------------------------- reverse

export type StoredExpense = {
  currency: string;
  total: Minor;
  splitType: DraftSplit["type"];
  payers: ParticipantAmount[];
  shares: BuiltShare[];
  items: BuiltItem[];
};

/** Rebuilds an editable draft from a saved expense. buildExpense(draftFromExpense(x)) reproduces x. */
export function draftFromExpense(expense: StoredExpense): ExpenseDraft {
  const major = (amount: Minor) => toMajorString(amount, expense.currency);
  const paidBy: DraftPaidBy =
    expense.payers.length === 1
      ? { mode: "single", participantId: expense.payers[0].participantId }
      : { mode: "multiple", amounts: expense.payers.map((p) => ({ participantId: p.participantId, value: major(p.amount) })) };

  const values = (format: (share: BuiltShare) => string) =>
    expense.shares.map((s) => ({ participantId: s.participantId, value: format(s) }));

  let split: DraftSplit;
  switch (expense.splitType) {
    case "equal":
      split = { type: "equal", participants: expense.shares.map((s) => s.participantId) };
      break;
    case "exact":
      split = { type: "exact", values: values((s) => major(s.amount)) };
      break;
    case "percentage":
      split = { type: "percentage", values: values((s) => formatScaled(s.splitInput ?? 0, 2)) };
      break;
    case "shares":
      split = { type: "shares", values: values((s) => formatScaled(s.splitInput ?? 0, SHARE_DECIMALS)) };
      break;
    case "adjustment":
      split = { type: "adjustment", values: values((s) => (s.splitInput ? major(s.splitInput) : "")) };
      break;
    case "itemized":
      split = {
        type: "itemized",
        lines: expense.items.map((item) => ({
          kind: item.kind,
          name: item.name,
          ...(item.originalName ? { originalName: item.originalName } : {}),
          ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
          ...(item.unitPrice !== undefined ? { unitPrice: major(item.unitPrice) } : {}),
          amount: major(item.amount),
          assignments: item.assignments,
        })),
      };
      break;
  }

  return { currency: expense.currency, total: major(expense.total), paidBy, split };
}

/**
 * Starting split for a new expense from a group's default split settings.
 * Percentage weights are basis points; share weights are share counts. Members
 * without a weight are left blank.
 */
export function defaultSplitDraft(
  type: "equal" | "percentage" | "shares",
  members: { participantId: ParticipantId; weight: number | null }[],
): DraftSplit {
  if (type === "equal") return { type, participants: members.map((m) => m.participantId) };
  return {
    type,
    values: members.map((m) => ({
      participantId: m.participantId,
      value: m.weight === null ? "" : type === "percentage" ? formatScaled(m.weight, 2) : String(m.weight),
    })),
  };
}

/** Sum of itemized draft lines (e.g. right after a scan, before anything is assigned); null if any amount is invalid. */
export function sumDraftLines(lines: readonly DraftLine[], currency: string): Minor | null {
  try {
    return sumMinor(lines.map((l) => (l.amount.trim() === "" ? 0 : parseMajor(l.amount, currency))));
  } catch {
    return null;
  }
}

/**
 * Line total from a unit price and quantity, rounded half-up to the currency's minor unit:
 * ("3.25", "2", USD) → "6.50"; ("1.99", "0.452", EUR) → "0.90". Null if either input is invalid.
 */
export function lineTotalFromUnit(unitPrice: string, quantity: string, currency: string): string | null {
  try {
    const unit = parseMajor(unitPrice, currency);
    const qty = parseScaled(quantity, QUANTITY_DECIMALS);
    if (qty <= 0) return null;
    // Exact integer math: unit (minor) × qty (×1000), then round half up.
    const scaled = BigInt(unit) * BigInt(qty);
    const divisor = BigInt(10 ** QUANTITY_DECIMALS);
    const rounded = Number((scaled + divisor / 2n) / divisor);
    return toMajorString(rounded, currency);
  } catch {
    return null;
  }
}

export type ItemizedPreview = {
  /** Per-person breakdown over the assigned items (charges spread across them). */
  breakdown: ItemizedBreakdown[];
  /** Indexes of item lines nobody is on yet. */
  unassigned: number[];
  unassignedTotal: Minor;
  /** Sum of every line (null if any amount is invalid). */
  total: Minor | null;
  /** Why the assigned part can't be computed yet, if it can't. */
  error: string | null;
};

/**
 * Live preview while items are still being assigned: computes the split over the assigned
 * items only and reports what's left, so per-person totals update with every tap.
 */
export function previewItemized(lines: readonly DraftLine[], currency: string): ItemizedPreview {
  const unassigned = lines.flatMap((l, i) => (l.kind === "item" && l.assignments.length === 0 ? [i] : []));
  const total = sumDraftLines(lines, currency);
  const unassignedTotal = sumDraftLines(unassigned.map((i) => lines[i]), currency) ?? 0;
  const assigned = lines.filter((_, i) => !unassigned.includes(i));
  const payer = assigned.flatMap((l) => l.assignments)[0]?.participantId;

  if (!payer || !assigned.some((l) => l.kind === "item")) {
    return { breakdown: [], unassigned, unassignedTotal, total, error: null };
  }
  const result = buildExpense({
    currency,
    total: "",
    paidBy: { mode: "single", participantId: payer },
    split: { type: "itemized", lines: assigned },
  });
  return result.ok
    ? { breakdown: result.expense.breakdown!, unassigned, unassignedTotal, total, error: null }
    : { breakdown: [], unassigned, unassignedTotal, total, error: result.message };
}
