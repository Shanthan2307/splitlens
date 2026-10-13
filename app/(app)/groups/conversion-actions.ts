"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { userMessage, type DbClient } from "@/lib/db/client";
import { convertGroupCurrencies } from "@/lib/db/conversions";
import { loadGroupLedger } from "@/lib/db/ledger";
import { isCurrencyCode } from "@/lib/currencies";
import { getRates } from "@/lib/rates";
import { netBalances, pairwiseDebts, planCurrencyConversion, type CurrencyBalances, type Debt, type LedgerEntry, type Minor } from "@/lib/splits";
import type { ActionResult } from "@/lib/validation/result";

const inputSchema = z.object({
  groupId: z.uuid(),
  target: z.string().refine(isCurrencyCode, "Unknown currency"),
});

export type ConversionPreview = {
  target: string;
  rateDate: string;
  source: string;
  /** Units of each currency per 1 target. */
  rates: { currency: string; rate: string }[];
  missing: string[];
  before: CurrencyBalances;
  after: Record<string, Minor>;
  payments: Debt[];
};

async function plan(db: DbClient, groupId: string, target: string) {
  const { entries } = await loadGroupLedger(db, groupId);
  const before = netBalances(entries);
  const others = Object.keys(before).filter((c) => c !== target);
  const rates = await getRates(db, target, others);
  const result = planCurrencyConversion(before, target, rates.rates);
  return { entries, before, rates, result };
}

/** What converting the group's balances to `target` would do, at today's reference rates. */
export async function previewConversionAction(input: unknown): Promise<ActionResult<{ preview: ConversionPreview }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const { supabase } = await requireUser();
  try {
    const { entries, before, rates, result } = await plan(supabase, parsed.data.groupId, parsed.data.target);
    // Who would owe whom afterwards: the same direct debts, with the conversion entries applied.
    const converted: LedgerEntry[] = result.conversions.flatMap((c) => [
      { kind: "expense" as const, ...c.clearLeg },
      { kind: "expense" as const, ...c.addLeg },
    ]);
    return {
      ok: true,
      preview: {
        target: parsed.data.target,
        rateDate: rates.date,
        source: rates.source,
        rates: result.conversions.map((c) => ({ currency: c.from, rate: c.rate })),
        missing: result.missingRates,
        before,
        after: result.result,
        payments: pairwiseDebts([...entries, ...converted]),
      },
    };
  } catch (error) {
    console.error("Conversion preview failed", error instanceof Error ? error.message : error);
    return { ok: false, error: userMessage(error, "Couldn't get exchange rates right now. Try again in a minute.") };
  }
}

const confirmSchema = inputSchema.extend({
  /** The previewed result; if balances or rates changed since, ask the user to review again. */
  expected: z.record(z.string(), z.number().int()),
  date: z.iso.date(),
});

export async function convertCurrenciesAction(input: unknown): Promise<ActionResult<{ count: number }>> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const { supabase } = await requireUser();
  const { groupId, target, expected, date } = parsed.data;
  try {
    const { rates, result } = await plan(supabase, groupId, target);
    if (result.conversions.length === 0) return { ok: false, error: "There's nothing to convert." };
    const same =
      Object.keys(expected).length === Object.keys(result.result).length &&
      Object.entries(result.result).every(([id, v]) => expected[id] === v);
    if (!same) return { ok: false, error: "Balances or rates changed since you opened this. Review the new numbers and confirm again." };
    await convertGroupCurrencies(supabase, groupId, result.conversions, { date, rateDate: rates.date, source: rates.source });
    revalidatePath(`/groups/${groupId}`, "layout");
    revalidatePath("/dashboard");
    revalidatePath("/friends", "layout");
    return { ok: true, count: result.conversions.length };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Couldn't convert the balances. Try again.") };
  }
}
