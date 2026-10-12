import { dbError, type DbClient } from "./client";

/** Cached rates for `base` fetched since `since`: quote currency → units of quote per 1 base. */
export async function cachedRates(
  db: DbClient,
  base: string,
  quotes: readonly string[],
  since: Date,
): Promise<{ date: string; rates: Record<string, string> } | null> {
  if (quotes.length === 0) return null;
  const { data, error } = await db
    .from("exchange_rates")
    .select("quote_currency, rate, rate_date")
    .eq("base_currency", base)
    .in("quote_currency", [...quotes])
    .gte("fetched_at", since.toISOString())
    .order("rate_date", { ascending: false });
  if (error) throw dbError("Could not load exchange rates", error);
  const rates: Record<string, string> = {};
  let date = "";
  for (const row of data) {
    if (rates[row.quote_currency] !== undefined) continue;
    // PostgREST returns numeric as a JSON number; write it back as a plain decimal string.
    rates[row.quote_currency] = Number(row.rate).toFixed(10).replace(/\.?0+$/, "");
    date ||= row.rate_date;
  }
  return quotes.every((q) => rates[q] !== undefined) ? { date, rates } : null;
}

/** Service role only (users can't write rates). */
export async function storeRates(admin: DbClient, base: string, date: string, rates: Record<string, string>, source: string) {
  const rows = Object.entries(rates).map(([quote, rate]) => ({
    base_currency: base,
    quote_currency: quote,
    rate_date: date,
    // numeric column: send the exact decimal string (generated types say number).
    rate: rate as unknown as number,
    source,
    fetched_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return;
  const { error } = await admin.from("exchange_rates").upsert(rows);
  if (error) throw dbError("Could not store exchange rates", error);
}
