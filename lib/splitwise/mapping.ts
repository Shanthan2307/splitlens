import type { CategoryId } from "@/lib/categories";
import { convertSplitwiseExpense, parseSplitwiseAmount } from "@/lib/splits";
import { swName, type SwComment, type SwExpense, type SwFriend, type SwGroup } from "./schemas";

/** Pure mappers from Splitwise API objects to the payloads the import RPCs take. */

export type GroupType = "home" | "trip" | "couple" | "other";

export function mapGroupType(type: string | null | undefined): GroupType {
  switch (type) {
    case "apartment":
    case "house":
    case "home":
      return "home";
    case "trip":
      return "trip";
    case "couple":
      return "couple";
    default:
      return "other";
  }
}

const CATEGORY_RULES: [RegExp, CategoryId][] = [
  [/dining|restaurant/i, "dining"],
  [/groceries/i, "groceries"],
  [/liquor|drinks/i, "drinks"],
  [/rent|mortgage/i, "rent"],
  [/electric|water|heat|utilities|trash|cleaning/i, "utilities"],
  [/tv|phone|internet/i, "internet"],
  [/household|maintenance|supplies/i, "household"],
  [/furniture|electronics/i, "furniture"],
  [/taxi/i, "taxi"],
  [/gas|fuel/i, "fuel"],
  [/parking/i, "parking"],
  [/bus|train/i, "transit"],
  [/plane|flight/i, "flights"],
  [/^car$|bicycle/i, "car"],
  [/hotel|lodging/i, "lodging"],
  [/movies/i, "movies"],
  [/games/i, "games"],
  [/sports/i, "sports"],
  [/music/i, "music"],
  [/entertainment/i, "entertainment"],
  [/gifts?/i, "gifts"],
  [/medical/i, "medical"],
  [/clothing/i, "clothing"],
  [/education|childcare/i, "education"],
  [/pets/i, "pets"],
  [/insurance|taxes|services/i, "other"],
];

export function mapCategory(name: string | null | undefined): CategoryId {
  if (!name) return "general";
  return CATEGORY_RULES.find(([re]) => re.test(name))?.[1] ?? "general";
}

export type PersonPayload = { splitwise_user_id: number; name: string; email: string | null };

export function personPayload(u: { id: number; first_name?: string | null; last_name?: string | null; email?: string | null }): PersonPayload {
  return { splitwise_user_id: u.id, name: swName(u), email: u.email?.trim().toLowerCase() || null };
}

export function groupPayload(group: SwGroup, currency: string) {
  return {
    splitwise_group_id: group.id,
    name: group.name.trim() || "Splitwise group",
    type: mapGroupType(group.group_type),
    simplify: group.simplify_by_default ?? true,
    currency,
    members: group.members.map(personPayload),
  };
}

export type ExpensePayload = {
  splitwise_expense_id: number;
  deleted?: boolean;
  payment?: boolean;
  description?: string;
  category?: CategoryId;
  date?: string;
  currency?: string;
  total_minor?: number;
  notes?: string | null;
  created_at?: string | null;
  payers?: { splitwise_user_id: number; amount: number }[];
  shares?: { splitwise_user_id: number; amount: number }[];
  comments?: { splitwise_comment_id: number; splitwise_user_id: number | null; author_name: string; body: string; created_at: string | null }[];
};

/**
 * Splitwise expenses → RPC payload. Deleted ones are sent as tombstones (so re-imports mirror
 * deletions); ones whose amounts don't reconcile are dropped and counted as `invalid`.
 * `people` gathers names of everyone on these expenses, for former members.
 */
export function expensePayloads(expenses: readonly SwExpense[], comments: ReadonlyMap<number, readonly SwComment[]> = new Map()) {
  const payloads: ExpensePayload[] = [];
  const people = new Map<number, PersonPayload>();
  let invalid = 0;

  for (const e of expenses) {
    if (e.deleted_at) {
      payloads.push({ splitwise_expense_id: e.id, deleted: true });
      continue;
    }
    const converted = convertSplitwiseExpense(
      e.cost,
      e.currency_code,
      e.users.map((u) => ({ userId: u.user_id, paidShare: u.paid_share, owedShare: u.owed_share })),
    );
    if (!converted.ok) {
      invalid++;
      continue;
    }
    for (const u of e.users) {
      if (!people.has(u.user_id)) people.set(u.user_id, { splitwise_user_id: u.user_id, name: swName(u.user), email: null });
    }
    payloads.push({
      splitwise_expense_id: e.id,
      payment: e.payment ?? false,
      description: e.description.trim() || (e.payment ? "Payment" : "Splitwise expense"),
      category: mapCategory(e.category?.name),
      date: e.date.slice(0, 10),
      currency: e.currency_code,
      total_minor: converted.total,
      notes: e.details?.trim() || null,
      created_at: e.created_at ?? null,
      payers: converted.payers.map((p) => ({ splitwise_user_id: p.userId, amount: p.amount })),
      shares: converted.shares.map((p) => ({ splitwise_user_id: p.userId, amount: p.amount })),
      comments: (comments.get(e.id) ?? [])
        .filter((c) => c.comment_type !== "System" && !c.deleted_at && c.content.trim())
        .map((c) => ({
          splitwise_comment_id: c.id,
          splitwise_user_id: c.user?.id ?? null,
          author_name: swName(c.user),
          body: c.content.trim(),
          created_at: c.created_at ?? null,
        })),
    });
  }
  return { payloads, people: [...people.values()], invalid };
}

/** Balance between you and a friend outside groups (Splitwise's group_id 0), per currency, in minor units. Positive = they owe you. */
export function nonGroupBalance(friend: SwFriend): { currency: string; amount: number }[] {
  const source = friend.groups?.find((g) => g.group_id === 0)?.balance ?? [];
  return source.flatMap((b) => {
    const amount = parseSplitwiseAmount(b.amount, b.currency_code);
    return amount ? [{ currency: b.currency_code, amount }] : [];
  });
}
