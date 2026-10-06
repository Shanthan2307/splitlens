import { describe, expect, it } from "vitest";
import { magicLinkSchema, safeNextPath } from "./auth";

describe("safeNextPath", () => {
  it.each([
    [undefined, "/dashboard"],
    [null, "/dashboard"],
    ["", "/dashboard"],
    ["/groups/123?tab=balances", "/groups/123?tab=balances"],
    ["https://evil.example", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["groups", "/dashboard"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("magicLinkSchema", () => {
  it("normalizes email", () => {
    expect(magicLinkSchema.parse({ email: "  Ada@Example.COM " }).email).toBe("ada@example.com");
  });
  it("rejects invalid email", () => {
    expect(magicLinkSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});
