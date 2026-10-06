import "server-only";
import { z } from "zod";

/** Server-only secrets. Importing this from a client component fails the build. */
const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** Optional locally: the SDK also resolves `ant auth login` profiles. Required in production. */
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => v || undefined),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  /** Optional effort override for receipt parsing (low | medium | high | xhigh | max). Model default if unset. */
  RECEIPT_PARSER_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().or(z.literal("").transform(() => undefined)),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse(source);
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
