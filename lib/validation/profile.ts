import { z } from "zod";
import { CURRENCY_CODES } from "@/lib/currencies";
import { LANGUAGE_TAGS } from "@/lib/languages";

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1, "Name is required").max(80, "Name must be 80 characters or fewer"),
  defaultCurrency: z.enum(CURRENCY_CODES, { error: "Choose a currency" }),
  preferredLanguage: z.enum(LANGUAGE_TAGS, { error: "Choose a language" }),
  venmoUsername: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@/, ""))
    .pipe(z.union([z.literal(""), z.string().regex(/^[A-Za-z0-9_-]{5,30}$/, "Venmo usernames are 5–30 letters, numbers, - or _")])),
  paypalUsername: z
    .string()
    .trim()
    .transform((v) => v.replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, ""))
    .pipe(z.union([z.literal(""), z.string().regex(/^[A-Za-z0-9]{1,20}$/, "PayPal.me names are up to 20 letters or numbers")])),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** Optional avatar upload. Browsers send an empty File when nothing is chosen. */
export const avatarFileSchema = z
  .instanceof(File)
  .optional()
  .transform((file) => (file && file.size > 0 ? file : undefined))
  .refine((file) => !file || file.size <= AVATAR_MAX_BYTES, "Avatar must be 2 MB or smaller")
  .refine(
    (file) => !file || (AVATAR_MIME_TYPES as readonly string[]).includes(file.type),
    "Avatar must be a JPEG, PNG, WebP or GIF image",
  );
