import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env.server";

describe("parseServerEnv", () => {
  it("defaults the Anthropic model", () => {
    const env = parseServerEnv({ SUPABASE_SERVICE_ROLE_KEY: "srk", ANTHROPIC_API_KEY: "key" });
    expect(env.ANTHROPIC_MODEL).toBe("claude-sonnet-5-5");
    expect(env.RECEIPT_PARSER_EFFORT).toBeUndefined();
  });

  it("treats an empty API key as unset", () => {
    expect(parseServerEnv({ SUPABASE_SERVICE_ROLE_KEY: "srk", ANTHROPIC_API_KEY: "", RECEIPT_PARSER_EFFORT: "" }).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("rejects missing secrets", () => {
    expect(() => parseServerEnv({})).toThrow();
  });
});
