"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { unlinkSplitwiseAccount } from "@/lib/db/splitwise";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/validation/result";

/** Deletes stored tokens and the verified Splitwise id. Imported data stays. */
export async function disconnectSplitwiseAction(): Promise<ActionResult> {
  const { user } = await requireUser();
  try {
    await unlinkSplitwiseAccount(createAdminClient(), user.id);
  } catch {
    return { ok: false, error: "Could not disconnect Splitwise. Try again." };
  }
  revalidatePath("/account");
  revalidatePath("/import/splitwise");
  return { ok: true };
}
