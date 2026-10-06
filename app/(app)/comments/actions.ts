"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { userMessage } from "@/lib/db/client";
import { addComment, deleteComment, type Comment } from "@/lib/db/comments";
import { commentSchema } from "@/lib/validation/settlement";
import { firstIssue, type ActionResult } from "@/lib/validation/result";

// No revalidatePath: comment lists update live through Supabase Realtime.

export async function addCommentAction(input: unknown): Promise<ActionResult<{ comment: Comment }>> {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const { user, supabase } = await requireUser();
  try {
    const id = await addComment(supabase, parsed.data.target, parsed.data.body);
    return { ok: true, comment: { id, authorId: user.id, body: parsed.data.body, createdAt: new Date().toISOString() } };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not post your comment.") };
  }
}

export async function deleteCommentAction(commentId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(commentId).success) return { ok: false, error: "Invalid comment" };
  const { supabase } = await requireUser();
  try {
    await deleteComment(supabase, commentId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not delete the comment.") };
  }
}
