import { describe, expect, it } from "vitest";
import { parseServerEnv, splitwiseConfig } from "./env.server";

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

describe("splitwiseConfig", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const base = { SUPABASE_SERVICE_ROLE_KEY: "srk" };

  it("is null until all three settings exist", () => {
    expect(splitwiseConfig(parseServerEnv(base))).toBeNull();
    expect(splitwiseConfig(parseServerEnv({ ...base, SPLITWISE_CLIENT_ID: "id", SPLITWISE_CLIENT_SECRET: "", SPLITWISE_TOKEN_KEY: key }))).toBeNull();
    expect(splitwiseConfig(parseServerEnv({ ...base, SPLITWISE_CLIENT_ID: "id", SPLITWISE_CLIENT_SECRET: "s", SPLITWISE_TOKEN_KEY: key }))).toEqual({
      clientId: "id",
      clientSecret: "s",
      tokenKey: key,
    });
  });

  it("rejects a token key that isn't 32 bytes", () => {
    expect(() => parseServerEnv({ ...base, SPLITWISE_TOKEN_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/32 bytes/);
  });
});
