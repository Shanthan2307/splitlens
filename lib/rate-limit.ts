/** Receipt scans per user: short burst window plus a daily cap (each scan is a paid model call). */
export const RECEIPT_RATE_LIMITS = [
  { windowMs: 10 * 60 * 1000, max: 10, label: "10 scans per 10 minutes" },
  { windowMs: 24 * 60 * 60 * 1000, max: 100, label: "100 scans per day" },
] as const;

/** Returns the first limit that is exceeded given usage counts per window, else null. */
export function exceededLimit(counts: readonly number[]) {
  const index = RECEIPT_RATE_LIMITS.findIndex((limit, i) => counts[i] >= limit.max);
  return index === -1 ? null : RECEIPT_RATE_LIMITS[index];
}
