import "server-only";
import { z } from "zod";
import type { DbClient } from "@/lib/db/client";
import { cachedRates, storeRates } from "@/lib/db/exchange-rates";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daily reference rates from the European Central Bank via Frankfurter (free, no key).
 * ~30 major currencies; anything else simply has no rate and is left unconverted.
 */
export const RATE_SOURCE = "European Central Bank (via frankfurter.dev)";
const API = "https://api.frankfurter.dev/v1";
const CACHE_HOURS = 6;

export const SUPPORTED_RATE_CURRENCIES = new Set([
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK",
  "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
]);

const responseSchema = z.object({
  base: z.string(),
  date: z.iso.date(),
  rates: z.record(z.string(), z.number().positive()),
});

/** JSON number → exact decimal string (no exponent), e.g. 0.0063 → "0.0063", 158.6 → "158.6". */
export function rateToDecimal(n: number): string {
  return n.toFixed(10).replace(/\.?0+$/, "");
}

export type Rates = { date: string; rates: Record<string, string>; source: string };

/** Units of each `currencies` entry per 1 `base`. Unsupported currencies are omitted. */
export async function getRates(db: DbClient, base: string, currencies: readonly string[], fetchImpl: typeof fetch = fetch): Promise<Rates> {
  const wanted = [...new Set(currencies)].filter((c) => c !== base && SUPPORTED_RATE_CURRENCIES.has(c));
  if (!SUPPORTED_RATE_CURRENCIES.has(base) || wanted.length === 0) return { date: "", rates: {}, source: RATE_SOURCE };

  const cached = await cachedRates(db, base, wanted, new Date(Date.now() - CACHE_HOURS * 3600_000));
  if (cached) return { ...cached, source: RATE_SOURCE };

  const res = await fetchImpl(`${API}/latest?base=${base}&symbols=${wanted.join(",")}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Exchange rates unavailable (${res.status})`);
  const data = responseSchema.parse(await res.json());
  const rates = Object.fromEntries(Object.entries(data.rates).map(([c, r]) => [c, rateToDecimal(r)]));
  await storeRates(createAdminClient(), base, data.date, rates, "frankfurter").catch(() => undefined);
  return { date: data.date, rates, source: RATE_SOURCE };
}
