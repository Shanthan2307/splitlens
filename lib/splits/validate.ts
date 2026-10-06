import { SplitError } from "./errors";
import { assertMinor, sign, type Minor } from "./money";
import type { ParticipantAmount, ParticipantId } from "./types";

export function assertNonZeroTotal(total: Minor) {
  assertMinor(total, "total");
  if (total === 0) throw new SplitError("ZERO_TOTAL", "Total must not be zero");
}

export function assertUniqueIds(ids: readonly ParticipantId[]) {
  if (ids.length === 0) throw new SplitError("NO_PARTICIPANTS", "At least one participant is required");
  if (new Set(ids).size !== ids.length) {
    throw new SplitError("DUPLICATE_PARTICIPANT", "Each participant may appear only once");
  }
}

/** Every amount must be zero or have the same sign as the total (no negative shares on a charge). */
export function assertSignsMatch(total: Minor, amounts: readonly ParticipantAmount[], label: string) {
  const expected = sign(total);
  for (const { participantId, amount } of amounts) {
    if (amount !== 0 && sign(amount) !== expected) {
      throw new SplitError(
        "SIGN_MISMATCH",
        `${label} for ${participantId} (${amount}) must have the same sign as the total (${total})`,
      );
    }
  }
}
