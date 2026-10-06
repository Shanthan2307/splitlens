"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createAttachmentUpload, deleteAttachment, registerAttachment } from "@/lib/db/attachments";
import { userMessage } from "@/lib/db/client";
import { saveExpense, setExpenseDeleted } from "@/lib/db/expenses";
import { buildExpense } from "@/lib/splits";
import { attachmentRegisterSchema, attachmentUploadSchema, saveExpenseSchema } from "@/lib/validation/expense";
import { firstIssue, type ActionResult } from "@/lib/validation/result";

function revalidateExpense(expenseId: string, groupId?: string | null) {
  revalidatePath(`/expenses/${expenseId}`);
  if (groupId) revalidatePath(`/groups/${groupId}`);
  revalidatePath("/friends", "layout");
  revalidatePath("/groups");
  revalidatePath("/dashboard");
}

export async function saveExpenseAction(input: unknown): Promise<ActionResult<{ expenseId: string }>> {
  const parsed = saveExpenseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const { draft, ...meta } = parsed.data;

  const built = buildExpense(draft);
  if (!built.ok) return { ok: false, error: built.message, field: built.field };

  const { supabase } = await requireUser();
  try {
    const expenseId = await saveExpense(
      supabase,
      {
        expenseId: meta.expenseId,
        groupId: meta.groupId,
        description: meta.description,
        category: meta.category,
        date: meta.date,
        currency: draft.currency,
        notes: meta.notes,
        receiptId: meta.receiptId,
        splitType: draft.split.type,
      },
      built.expense,
    );
    revalidateExpense(expenseId, meta.groupId);
    return { ok: true, expenseId };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not save the expense. Try again.") };
  }
}

const idSchema = z.uuid();

export async function setExpenseDeletedAction(
  expenseId: string,
  deleted: boolean,
  groupId?: string | null,
): Promise<ActionResult> {
  if (!idSchema.safeParse(expenseId).success) return { ok: false, error: "Invalid expense" };
  const { supabase } = await requireUser();
  try {
    await setExpenseDeleted(supabase, expenseId, deleted);
    revalidateExpense(expenseId, groupId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, deleted ? "Could not delete the expense." : "Could not restore the expense.") };
  }
}

/** Returns a signed upload token; the browser then uploads directly to Storage. */
export async function createAttachmentUploadAction(input: unknown): Promise<ActionResult<{ path: string; token: string }>> {
  const parsed = attachmentUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const { supabase } = await requireUser();
  try {
    return { ok: true, ...(await createAttachmentUpload(supabase, parsed.data.expenseId, parsed.data.fileName)) };
  } catch (error) {
    return { ok: false, error: userMessage(error, `Could not upload ${parsed.data.fileName}.`) };
  }
}

export async function registerAttachmentAction(input: unknown): Promise<ActionResult> {
  const parsed = attachmentRegisterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const { user, supabase } = await requireUser();
  try {
    await registerAttachment(supabase, { userId: user.id, ...parsed.data });
    revalidatePath(`/expenses/${parsed.data.expenseId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, `Could not save ${parsed.data.fileName}.`) };
  }
}

export async function deleteAttachmentAction(attachmentId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(attachmentId).success) return { ok: false, error: "Invalid attachment" };
  const { supabase } = await requireUser();
  try {
    const expenseId = await deleteAttachment(supabase, attachmentId);
    revalidatePath(`/expenses/${expenseId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not delete the attachment.") };
  }
}
