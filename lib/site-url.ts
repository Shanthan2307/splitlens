import "server-only";
import { headers } from "next/headers";
import { publicEnv } from "@/lib/env";

/**
 * Origin of the current request (production domain, Vercel preview, or localhost), so auth
 * redirects return to the deployment the user is on. Supabase only redirects to URLs on its
 * allow-list, so a spoofed Host header can't send users elsewhere. Falls back to NEXT_PUBLIC_SITE_URL.
 */
export async function siteUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return publicEnv().NEXT_PUBLIC_SITE_URL;
}
