"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { userMessage } from "@/lib/db/client";
import { saveSettlement, setSettlementDeleted } from "@/lib/db/settlements";
import { parseSettlementAmount } from "@/lib/splits";
import { saveSettlementSchema } from "@/lib/validation/settlement";
import { firstIssue, type ActionResult } from "@/lib/validation/result";

function revalidateSettlement(settlementId: string, groupId?: string | null) {
  revalidatePath(`/settlements/${settlementId}`);
  if (groupId) revalidatePath(`/groups/${groupId}`);
  revalidatePath("/friends", "layout");
  revalidatePath("/groups");
  revalidatePath("/dashboard");
  revalidatePath("/activity");
}

export async function saveSettlementAction(input: unknown): Promise<ActionResult<{ settlementId: string }>> {
  const parsed = saveSettlementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const amount = parseSettlementAmount(parsed.data.amount, parsed.data.currency);
  if (!amount.ok) return { ok: false, error: amount.message, field: "amount" };

  const { supabase } = await requireUser();
  try {
    const settlementId = await saveSettlement(supabase, {
      ...parsed.data,
      amount: amount.amount,
      provider: parsed.data.method === "external_app" ? parsed.data.provider : undefined,
    });
    revalidateSettlement(settlementId, parsed.data.groupId);
    return { ok: true, settlementId };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not record the payment. Try again.") };
  }
}

export async function setSettlementDeletedAction(
  settlementId: string,
  deleted: boolean,
  groupId?: string | null,
): Promise<ActionResult> {
  if (!z.uuid().safeParse(settlementId).success) return { ok: false, error: "Invalid payment" };
  const { supabase } = await requireUser();
  try {
    await setSettlementDeleted(supabase, settlementId, deleted);
    revalidateSettlement(settlementId, groupId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, deleted ? "Could not delete the payment." : "Could not restore the payment.") };
  }
}
