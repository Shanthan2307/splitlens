import "server-only";
import { timingSafeEqual } from "node:crypto";
import { siteUrl } from "@/lib/site-url";

export const STATE_COOKIE = "sw_oauth_state";
export const STATE_COOKIE_PATH = "/api/splitwise";

/** Must be identical in the authorize request and the token exchange. */
export async function splitwiseRedirectUri(): Promise<string> {
  return `${await siteUrl()}/api/splitwise/callback`;
}

/** Cookie value is `<state>.<next path>`; the state is random hex, so the first dot splits them. */
export function readState(cookie: string | undefined, param: string | null): { ok: boolean; next: string | null } {
  if (!cookie || !param) return { ok: false, next: null };
  const dot = cookie.indexOf(".");
  const state = dot === -1 ? cookie : cookie.slice(0, dot);
  const next = dot === -1 ? null : decodeURIComponent(cookie.slice(dot + 1));
  const a = Buffer.from(state);
  const b = Buffer.from(param);
  return { ok: a.length === b.length && timingSafeEqual(a, b), next };
}
