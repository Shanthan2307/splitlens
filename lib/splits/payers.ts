import { SplitError } from "./errors";
import { assertMinor, normalizeZero, sumMinor, type Minor } from "./money";
import type { ParticipantAmount, ParticipantId } from "./types";
import { assertNonZeroTotal, assertSignsMatch, assertUniqueIds } from "./validate";

/** Validates who paid: unique payers, non-zero amounts with the total's sign, summing to the total. */
export function validatePayers(total: Minor, payers: readonly ParticipantAmount[]): void {
  assertNonZeroTotal(total);
  assertUniqueIds(payers.map((p) => p.participantId));
  for (const p of payers) {
    assertMinor(p.amount, `paid amount for ${p.participantId}`);
    if (p.amount === 0) throw new SplitError("INVALID_AMOUNT", `Payer ${p.participantId} paid nothing`);
  }
  assertSignsMatch(total, payers, "Paid amount");
  const sum = sumMinor(payers.map((p) => p.amount));
  if (sum !== total) throw new SplitError("SUM_MISMATCH", `Payers paid ${sum} but the total is ${total}`);
}

/**
 * Net effect of one expense per participant: paid − owed.
 * Positive = others owe them; negative = they owe. Always sums to zero.
 * Participants with a net of zero are omitted.
 */
export function expenseNet(
  payers: readonly ParticipantAmount[],
  shares: readonly ParticipantAmount[],
): ParticipantAmount[] {
  const paid = sumMinor(payers.map((p) => p.amount));
  const owed = sumMinor(shares.map((s) => s.amount));
  if (paid !== owed) throw new SplitError("SUM_MISMATCH", `Payers paid ${paid} but shares total ${owed}`);

  const net = new Map<ParticipantId, Minor>();
  for (const p of payers) net.set(p.participantId, (net.get(p.participantId) ?? 0) + p.amount);
  for (const s of shares) net.set(s.participantId, (net.get(s.participantId) ?? 0) - s.amount);

  return [...net]
    .filter(([, amount]) => amount !== 0)
    .map(([participantId, amount]) => ({ participantId, amount: normalizeZero(amount) }));
}

/** One participant's net on an expense: positive = they lent, negative = they borrowed, 0 = not involved/even. */
export function participantNet(
  payers: readonly ParticipantAmount[],
  shares: readonly ParticipantAmount[],
  participantId: ParticipantId,
): Minor {
  return expenseNet(payers, shares).find((n) => n.participantId === participantId)?.amount ?? 0;
}
