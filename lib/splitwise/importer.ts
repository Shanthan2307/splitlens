import "server-only";
import type { DbClient } from "@/lib/db/client";
import { importedGroups, importExpenses, importGroup, registeredSplitwisePeople, type ImportCounts } from "@/lib/db/splitwise";
import type { SplitwiseApi } from "./api";
import { expensePayloads, groupPayload, nonGroupBalance, personPayload, type PersonPayload } from "./mapping";
import type { SwComment, SwExpense } from "./schemas";

/** Expenses per server-action call: small enough to finish well inside a function's time limit. */
export const PAGE_SIZE = 40;
export const PAGE_SIZE_WITH_COMMENTS = 20;
const COMMENT_CONCURRENCY = 3;

// ----------------------------------------------------------------- overview

export type OverviewPerson = { splitwiseUserId: number; name: string; onSplitLens: boolean; isMe: boolean };
export type OverviewGroup = { splitwiseGroupId: number; name: string; importedGroupId: string | null; members: OverviewPerson[] };
export type OverviewFriend = OverviewPerson & { balances: { currency: string; amount: number }[] };
export type Overview = { groups: OverviewGroup[]; friends: OverviewFriend[] };

/** What the import wizard shows: Splitwise groups/friends and who's already on SplitLens. */
export async function loadOverview(api: SplitwiseApi, admin: DbClient, db: DbClient, mySplitwiseId: number): Promise<Overview> {
  const [groups, friends] = await Promise.all([api.getGroups(), api.getFriends()]);
  const realGroups = groups.filter((g) => g.id !== 0);
  const everyone = [...realGroups.flatMap((g) => g.members), ...friends].map(personPayload);
  const [registered, imported] = await Promise.all([
    registeredSplitwisePeople(admin, everyone),
    importedGroups(db, realGroups.map((g) => g.id)),
  ]);
  const person = (p: PersonPayload): OverviewPerson => ({
    splitwiseUserId: p.splitwise_user_id,
    name: p.name,
    isMe: p.splitwise_user_id === mySplitwiseId,
    onSplitLens: p.splitwise_user_id === mySplitwiseId || registered.has(p.splitwise_user_id),
  });

  return {
    groups: realGroups.map((g) => ({
      splitwiseGroupId: g.id,
      name: g.name,
      importedGroupId: imported.get(g.id) ?? null,
      members: g.members.map((m) => person(personPayload(m))).sort((a, b) => Number(b.isMe) - Number(a.isMe)),
    })),
    friends: friends
      .map((f) => ({ ...person(personPayload(f)), balances: nonGroupBalance(f) }))
      .sort((a, b) => Number(b.onSplitLens) - Number(a.onSplitLens) || a.name.localeCompare(b.name)),
  };
}

// ------------------------------------------------------------------- import

export async function importSplitwiseGroup(api: SplitwiseApi, admin: DbClient, userId: string, splitwiseGroupId: number, currency: string) {
  // Fetched with the user's token: Splitwise only returns groups they belong to.
  const group = await api.getGroup(splitwiseGroupId);
  const result = await importGroup(admin, userId, groupPayload(group, currency));
  return { ...result, name: group.name };
}

export type ImportTarget = { kind: "group"; splitwiseGroupId: number; groupId: string } | { kind: "friend"; splitwiseFriendId: number };

export type PageResult = { counts: ImportCounts & { invalid: number }; fetched: number; nextOffset: number | null };

/** Imports one page of a group's or friend's Splitwise expenses (with comments if asked). */
export async function importExpensePage(
  api: SplitwiseApi,
  admin: DbClient,
  userId: string,
  target: ImportTarget,
  offset: number,
  includeComments: boolean,
): Promise<PageResult> {
  const limit = includeComments ? PAGE_SIZE_WITH_COMMENTS : PAGE_SIZE;
  const [page, people] = await Promise.all([
    target.kind === "group"
      ? api.getExpenses({ groupId: target.splitwiseGroupId, limit, offset })
      : api.getExpenses({ friendId: target.splitwiseFriendId, limit, offset }),
    target.kind === "group"
      ? api.getGroup(target.splitwiseGroupId).then((g) => g.members.map(personPayload))
      : api.getFriends().then((fs) => fs.map(personPayload)),
  ]);
  // Friend imports cover expenses outside groups; group expenses come with their group.
  const relevant = target.kind === "group" ? page : page.filter((e) => !e.group_id);
  const comments = includeComments ? await fetchComments(api, relevant) : new Map<number, SwComment[]>();
  const { payloads, people: onExpenses, invalid } = expensePayloads(relevant, comments);

  const known = new Set(people.map((p) => p.splitwise_user_id));
  const allPeople = [...people, ...onExpenses.filter((p) => !known.has(p.splitwise_user_id))];
  const counts = payloads.length
    ? await importExpenses(admin, userId, target.kind === "group" ? target.groupId : null, allPeople, payloads)
    : { created: 0, payments: 0, existing: 0, deleted: 0, skipped: 0, comments: 0, unresolved: [] };

  return { counts: { ...counts, invalid }, fetched: page.length, nextOffset: page.length < limit ? null : offset + page.length };
}

async function fetchComments(api: SplitwiseApi, expenses: readonly SwExpense[]): Promise<Map<number, SwComment[]>> {
  const wanted = expenses.filter((e) => !e.deleted_at && (e.comments_count ?? 0) > 0).map((e) => e.id);
  const result = new Map<number, SwComment[]>();
  for (let i = 0; i < wanted.length; i += COMMENT_CONCURRENCY) {
    const batch = wanted.slice(i, i + COMMENT_CONCURRENCY);
    const lists = await Promise.all(batch.map((id) => api.getComments(id)));
    batch.forEach((id, j) => result.set(id, lists[j]!));
  }
  return result;
}
