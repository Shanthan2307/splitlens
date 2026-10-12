import { formatMinor, type CurrencyConversion } from "@/lib/splits";
import { dbError, type DbClient, type Json } from "./client";

/**
 * Writes a group's currency conversion: two exact-split "Currency conversion" expenses per
 * converted currency (clear the old balances, add them in the target), all in one transaction.
 */
export async function convertGroupCurrencies(
  db: DbClient,
  groupId: string,
  conversions: readonly CurrencyConversion[],
  meta: { date: string; rateDate: string; source: string },
): Promise<string[]> {
  const expenses = conversions.flatMap((c) => {
    const summary = `${formatMinor(c.clearLeg.total, c.from)} → ${formatMinor(c.addLeg.total, c.to)}`;
    const notes = `Rate: 1 ${c.to} = ${c.rate} ${c.from} (${meta.source}, ${meta.rateDate}).`;
    return [c.clearLeg, c.addLeg].map((leg) => ({
      group_id: groupId,
      description: `Currency conversion: ${summary}`,
      category: "conversion",
      expense_date: meta.date,
      currency: leg.currency,
      total_minor: leg.total,
      split_type: "exact",
      notes,
      payers: leg.payers.map((p) => ({ member_id: p.participantId, amount: p.amount })),
      shares: leg.shares.map((s) => ({ member_id: s.participantId, amount: s.amount, split_input: s.amount })),
    }));
  }) satisfies Json;
  const { data, error } = await db.rpc("convert_group_currencies", { p_group_id: groupId, p_expenses: expenses });
  if (error) throw dbError("Could not convert currencies", error);
  return data;
}
