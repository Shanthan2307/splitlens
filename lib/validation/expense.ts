import { z } from "zod";
import { CATEGORY_IDS } from "@/lib/categories";
import { CURRENCY_CODES } from "@/lib/currencies";

const id = z.uuid();
const amountString = z.string().trim().max(24);
const draftValue = z.object({ participantId: id, value: amountString });

const assignment = z.object({ participantId: id, weight: z.number().int().positive().max(1000).optional() });

const draftLine = z.object({
  kind: z.enum(["item", "tax", "tip", "service", "fee", "discount"]),
  name: z.string().trim().max(200),
  originalName: z.string().trim().max(200).optional(),
  quantity: z.string().trim().max(16).optional(),
  unitPrice: amountString.optional(),
  amount: amountString,
  assignments: z.array(assignment).max(100),
  distribution: z.enum(["proportional", "equal"]).optional(),
});

export const expenseDraftSchema = z.object({
  currency: z.enum(CURRENCY_CODES),
  total: amountString,
  paidBy: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("single"), participantId: id }),
    z.object({ mode: z.literal("multiple"), amounts: z.array(draftValue).min(1).max(100) }),
  ]),
  split: z.discriminatedUnion("type", [
    z.object({ type: z.literal("equal"), participants: z.array(id).min(1).max(100) }),
    z.object({
      type: z.enum(["exact", "percentage", "shares", "adjustment"]),
      values: z.array(draftValue).min(1).max(100),
    }),
    z.object({ type: z.literal("itemized"), lines: z.array(draftLine).min(1).max(300) }),
  ]),
});

export const saveExpenseSchema = z.object({
  expenseId: id.optional(),
  /** Set for group expenses (participant ids are member ids); absent for friend-only (user ids). */
  groupId: id.optional(),
  description: z.string().trim().min(1, "Add a description").max(200),
  category: z.enum(CATEGORY_IDS),
  date: z.iso.date("Choose a date"),
  notes: z.string().trim().max(2000).optional(),
  receiptId: id.optional(),
  draft: expenseDraftSchema,
});

export type SaveExpenseInput = z.infer<typeof saveExpenseSchema>;

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "application/pdf",
  "text/plain",
  "text/csv",
] as const;

const attachmentMeta = {
  expenseId: z.uuid(),
  fileName: z.string().trim().min(1).max(200, "File name is too long"),
  mimeType: z.enum(ATTACHMENT_MIME_TYPES, { error: "Attach a photo, PDF, or text/CSV file" }),
  sizeBytes: z.number().int().positive("The file is empty").max(ATTACHMENT_MAX_BYTES, "Attachments must be 10 MB or smaller"),
};

export const attachmentUploadSchema = z.object(attachmentMeta);

/** The path must be the one we issued: inside the expense's folder, no traversal. */
export const attachmentRegisterSchema = z
  .object({ ...attachmentMeta, path: z.string().max(400) })
  .refine((v) => v.path.startsWith(`${v.expenseId}/`) && !v.path.includes(".."), { message: "Invalid upload path", path: ["path"] });
