import "server-only";
import { z } from "zod";

const optional = z.string().optional().transform((v) => v || undefined);

/** Server-only secrets. Importing this from a client component fails the build. */
const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** Optional locally: the SDK also resolves `ant auth login` profiles. Required in production. */
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => v || undefined),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  /** Optional effort override for receipt parsing (low | medium | high | xhigh | max). Model default if unset. */
  RECEIPT_PARSER_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().or(z.literal("").transform(() => undefined)),
  /** Splitwise OAuth app (secure.splitwise.com/apps). The integration is hidden until all three are set. */
  SPLITWISE_CLIENT_ID: optional,
  SPLITWISE_CLIENT_SECRET: optional,
  /** 32 random bytes, base64 (`openssl rand -base64 32`): encrypts stored Splitwise tokens (AES-256-GCM). */
  SPLITWISE_TOKEN_KEY: optional.refine((v) => v === undefined || Buffer.from(v, "base64").length === 32, {
    message: "SPLITWISE_TOKEN_KEY must be 32 bytes, base64-encoded",
  }),
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

export type SplitwiseConfig = { clientId: string; clientSecret: string; tokenKey: string };

/** Splitwise OAuth settings, or null when the integration isn't configured. */
export function splitwiseConfig(env: ServerEnv = serverEnv()): SplitwiseConfig | null {
  const { SPLITWISE_CLIENT_ID: clientId, SPLITWISE_CLIENT_SECRET: clientSecret, SPLITWISE_TOKEN_KEY: tokenKey } = env;
  return clientId && clientSecret && tokenKey ? { clientId, clientSecret, tokenKey } : null;
}
