import { z } from "zod";

export const friendEmailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
});
