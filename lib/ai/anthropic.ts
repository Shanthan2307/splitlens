import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env.server";

let client: Anthropic | undefined;

/** Shared Anthropic client (server only). Without ANTHROPIC_API_KEY the SDK falls back to other credential sources. */
export function getAnthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: serverEnv().ANTHROPIC_API_KEY, maxRetries: 2, timeout: 55_000 });
  return client;
}
