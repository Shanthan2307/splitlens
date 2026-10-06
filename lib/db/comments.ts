import { dbError, type DbClient } from "./client";

export type Comment = { id: string; authorId: string | null; body: string; createdAt: string };

export type CommentTarget = { expenseId: string } | { settlementId: string };

export async function listComments(db: DbClient, target: CommentTarget): Promise<Comment[]> {
  let query = db.from("comments").select("id, author_id, body, created_at").eq("is_deleted", false);
  query = "expenseId" in target ? query.eq("expense_id", target.expenseId) : query.eq("settlement_id", target.settlementId);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw dbError("Could not load comments", error);
  return data.map((c) => ({ id: c.id, authorId: c.author_id, body: c.body, createdAt: c.created_at }));
}

export async function addComment(db: DbClient, target: CommentTarget, body: string): Promise<string> {
  const { data, error } = await db.rpc("add_comment", {
    p_expense_id: "expenseId" in target ? target.expenseId : (null as unknown as string),
    p_settlement_id: "settlementId" in target ? target.settlementId : (null as unknown as string),
    p_body: body,
  });
  if (error) throw dbError("Could not add comment", error);
  return data;
}

export async function deleteComment(db: DbClient, commentId: string) {
  const { error } = await db.rpc("delete_comment", { p_comment_id: commentId });
  if (error) throw dbError("Could not delete comment", error);
}
