import { toMajorString, type Minor } from "@/lib/splits";

/*
 * Links that open Venmo / PayPal with the payment pre-filled. SplitLens never moves money;
 * the user completes the payment in the other app, then records it here.
 */

/** Venmo only supports USD. Opens the app on mobile (universal link), web otherwise. */
export function venmoPayUrl(input: { username: string; amount: Minor; currency: string; note: string }): string | null {
  if (input.currency !== "USD") return null;
  const params = new URLSearchParams({ txn: "pay", amount: toMajorString(input.amount, "USD"), note: input.note });
  return `https://venmo.com/${encodeURIComponent(input.username)}?${params.toString()}`;
}

/** PayPal.me supports most currencies: https://paypal.me/{user}/{amount}{CUR}. */
export function paypalMeUrl(input: { username: string; amount: Minor; currency: string }): string {
  return `https://paypal.me/${encodeURIComponent(input.username)}/${toMajorString(input.amount, input.currency)}${input.currency}`;
}
