import { z } from "zod";
import { CURRENCY_CODES } from "@/lib/currencies";

export const SETTLEMENT_METHODS = ["cash", "bank_transfer", "external_app", "other"] as const;
export const EXTERNAL_PROVIDERS = ["venmo", "paypal", "other"] as const;

export const saveSettlementSchema = z
  .object({
    settlementId: z.uuid().optional(),
    /** Group payments use member ids; friend-only payments use user ids. */
    groupId: z.uuid().optional(),
    from: z.uuid(),
    to: z.uuid(),
    amount: z.string().trim().max(24),
    currency: z.enum(CURRENCY_CODES),
    date: z.iso.date("Choose a date"),
    method: z.enum(SETTLEMENT_METHODS),
    provider: z.enum(EXTERNAL_PROVIDERS).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.from !== v.to, { message: "Someone can't pay themselves", path: ["to"] });

export type SaveSettlementInput = z.infer<typeof saveSettlementSchema>;

export const commentSchema = z.object({
  target: z.union([z.object({ expenseId: z.uuid() }), z.object({ settlementId: z.uuid() })]),
  body: z.string().trim().min(1, "Write a comment first").max(4000, "Comments can be at most 4000 characters"),
});
