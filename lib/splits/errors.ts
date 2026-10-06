export type SplitErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_WEIGHT"
  | "ZERO_TOTAL"
  | "ZERO_WEIGHTS"
  | "NO_PARTICIPANTS"
  | "DUPLICATE_PARTICIPANT"
  | "SUM_MISMATCH"
  | "PERCENT_SUM"
  | "SIGN_MISMATCH"
  | "UNASSIGNED_ITEM"
  | "MIXED_SIGN_SUBTOTALS"
  | "INVALID_MONEY_STRING"
  | "UNKNOWN_CURRENCY";

/** Thrown for invalid split input. Inputs are Zod-validated upstream, so this signals a logic error or bad data. */
export class SplitError extends Error {
  constructor(
    readonly code: SplitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SplitError";
  }
}
