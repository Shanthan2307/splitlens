import { z } from "zod";
import { CURRENCY_CODES } from "@/lib/currencies";

export const GROUP_TYPES = ["home", "trip", "couple", "other"] as const;
export const DEFAULT_SPLIT_TYPES = ["equal", "percentage", "shares"] as const;

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, "Name your group").max(100),
  type: z.enum(GROUP_TYPES),
  defaultCurrency: z.enum(CURRENCY_CODES),
  simplifyDebts: z.boolean(),
});

export const updateGroupSchema = createGroupSchema.extend({
  groupId: z.uuid(),
  defaultSplitType: z.enum(DEFAULT_SPLIT_TYPES),
  /** percentage: percent strings; shares: share counts. Ignored for equal. */
  memberWeights: z.array(z.object({ memberId: z.uuid(), value: z.string().trim().max(12) })).max(200),
});

export const addMemberSchema = z
  .object({
    groupId: z.uuid(),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().pipe(z.email("Enter a valid email"))]).optional(),
    name: z.string().trim().max(80).optional(),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.name), { message: "Enter an email or a name", path: ["email"] });

export const GROUP_COVER_MAX_BYTES = 5 * 1024 * 1024;
export const GROUP_COVER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const groupCoverSchema = z
  .instanceof(File)
  .refine((f) => f.size > 0 && f.size <= GROUP_COVER_MAX_BYTES, "Cover image must be 5 MB or smaller")
  .refine((f) => (GROUP_COVER_MIME_TYPES as readonly string[]).includes(f.type), "Use a JPEG, PNG or WebP image");
