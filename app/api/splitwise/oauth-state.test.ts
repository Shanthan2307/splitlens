import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/site-url", () => ({ siteUrl: async () => "https://app.test" }));
const { readState, splitwiseRedirectUri } = await import("./oauth-state");

describe("OAuth state cookie", () => {
  it("matches the state and returns the next path", () => {
    expect(readState(`abc123.${encodeURIComponent("/account")}`, "abc123")).toEqual({ ok: true, next: "/account" });
    expect(readState("abc123", "abc123")).toEqual({ ok: true, next: null });
  });

  it("rejects missing or different state", () => {
    expect(readState(undefined, "abc").ok).toBe(false);
    expect(readState("abc.x", null).ok).toBe(false);
    expect(readState("abc.x", "abd").ok).toBe(false);
    expect(readState("abc.x", "abcd").ok).toBe(false);
  });

  it("derives the callback from the request origin", async () => {
    expect(await splitwiseRedirectUri()).toBe("https://app.test/api/splitwise/callback");
  });
});
