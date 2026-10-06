import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "./env";

describe("parsePublicEnv", () => {
  it("accepts valid values and defaults the site URL", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    });
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("http://localhost:3000");
  });

  it("rejects a missing anon key", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toThrow();
  });
});
