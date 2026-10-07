import { z } from "zod";

/**
 * Zod schemas for the Splitwise API v3.0 responses we use (dev.splitwise.com).
 * Loose objects: Splitwise adds fields over time; only what we read is validated.
 * Money arrives as decimal strings ("25.0") and is converted by lib/splits/splitwise.
 */
const id = z.number().int();
const str = z.string().nullish().transform((v) => v ?? "");

export const swUserSchema = z.looseObject({
  id,
  first_name: str,
  last_name: str,
  email: z.string().nullish(),
});
export type SwUser = z.infer<typeof swUserSchema>;

const balanceSchema = z.array(z.looseObject({ currency_code: z.string(), amount: z.string() })).catch([]);

export const swMemberSchema = swUserSchema.extend({ balance: balanceSchema.optional() });

export const swGroupSchema = z.looseObject({
  id,
  name: z.string(),
  group_type: z.string().nullish(),
  simplify_by_default: z.boolean().nullish(),
  members: z.array(swMemberSchema).default([]),
});
export type SwGroup = z.infer<typeof swGroupSchema>;

export const swFriendSchema = swUserSchema.extend({
  balance: balanceSchema.optional(),
  groups: z.array(z.looseObject({ group_id: id, balance: balanceSchema })).catch([]).optional(),
});
export type SwFriend = z.infer<typeof swFriendSchema>;

export const swExpenseUserSchema = z.looseObject({
  user_id: id,
  user: z.looseObject({ first_name: str, last_name: str }).nullish(),
  paid_share: z.string(),
  owed_share: z.string(),
});

export const swExpenseSchema = z.looseObject({
  id,
  group_id: id.nullish(),
  description: str,
  details: z.string().nullish(),
  payment: z.boolean().nullish(),
  cost: z.string(),
  currency_code: z.string(),
  date: z.string(),
  created_at: z.string().nullish(),
  deleted_at: z.string().nullish(),
  comments_count: z.number().int().nullish(),
  category: z.looseObject({ name: z.string().nullish() }).nullish(),
  users: z.array(swExpenseUserSchema).default([]),
});
export type SwExpense = z.infer<typeof swExpenseSchema>;

export const swCommentSchema = z.looseObject({
  id,
  content: str,
  comment_type: z.string().nullish(),
  created_at: z.string().nullish(),
  deleted_at: z.string().nullish(),
  user: z.looseObject({ id, first_name: str, last_name: str }).nullish(),
});
export type SwComment = z.infer<typeof swCommentSchema>;

export const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  token_type: z.string().nullish(),
  refresh_token: z.string().nullish(),
  expires_in: z.number().nullish(),
  scope: z.string().nullish(),
});

export function swName(u: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  return [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim() || "Splitwise user";
}
