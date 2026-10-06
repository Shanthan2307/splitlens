import { dbError, type DbClient, type Enums, type Json } from "./client";

export type ActivityItem = {
  id: number;
  action: Enums<"activity_action">;
  actorId: string | null;
  actorName: string | null;
  groupId: string | null;
  groupName: string | null;
  expenseId: string | null;
  settlementId: string | null;
  payload: Json;
  createdAt: string;
};

export const ACTIVITY_PAGE_SIZE = 30;

/** Activity visible to the user (RLS), newest first. `before` is the id cursor for pagination. */
export async function listActivity(
  db: DbClient,
  options: { groupId?: string; before?: number; limit?: number } = {},
): Promise<{ items: ActivityItem[]; nextCursor: number | null }> {
  const limit = options.limit ?? ACTIVITY_PAGE_SIZE;
  let query = db
    .from("activity_log")
    .select("id, action, actor_id, group_id, expense_id, settlement_id, payload, created_at, actor:profiles(display_name), group:groups(name)")
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (options.groupId) query = query.eq("group_id", options.groupId);
  if (options.before) query = query.lt("id", options.before);
  const { data, error } = await query;
  if (error) throw dbError("Could not load activity", error);

  const items = data.slice(0, limit).map((a) => ({
    id: a.id,
    action: a.action,
    actorId: a.actor_id,
    actorName: a.actor?.display_name ?? null,
    groupId: a.group_id,
    groupName: a.group?.name ?? null,
    expenseId: a.expense_id,
    settlementId: a.settlement_id,
    payload: a.payload,
    createdAt: a.created_at,
  }));
  return { items, nextCursor: data.length > limit ? items[items.length - 1].id : null };
}
