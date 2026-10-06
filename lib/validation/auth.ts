import { z } from "zod";

export const magicLinkSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  next: z.string().optional(),
});

export const otpTypeSchema = z.enum(["email", "magiclink", "signup", "invite", "recovery", "email_change"]);

const DEFAULT_AFTER_LOGIN = "/dashboard";

/** Only allow same-origin relative paths as post-login redirects (blocks open redirects). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return DEFAULT_AFTER_LOGIN;
  }
  return next;
}
