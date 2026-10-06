import { describe, expect, it } from "vitest";
import { AVATAR_MAX_BYTES, avatarFileSchema, profileUpdateSchema } from "./profile";

describe("profileUpdateSchema", () => {
  const valid = { displayName: "  Ada  ", defaultCurrency: "EUR", preferredLanguage: "zh-Hans", venmoUsername: "", paypalUsername: "" };

  it("accepts and trims valid input", () => {
    expect(profileUpdateSchema.parse(valid)).toEqual({ ...valid, displayName: "Ada" });
  });
  it("rejects blank names", () => {
    expect(profileUpdateSchema.safeParse({ ...valid, displayName: "   " }).success).toBe(false);
  });
  it("normalizes payment handles", () => {
    const parsed = profileUpdateSchema.parse({ ...valid, venmoUsername: "@ada-l_99", paypalUsername: "https://paypal.me/AdaL" });
    expect(parsed.venmoUsername).toBe("ada-l_99");
    expect(parsed.paypalUsername).toBe("AdaL");
    expect(profileUpdateSchema.safeParse({ ...valid, venmoUsername: "ab" }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ ...valid, paypalUsername: "has space" }).success).toBe(false);
  });

  it("rejects unknown currencies and languages", () => {
    expect(profileUpdateSchema.safeParse({ ...valid, defaultCurrency: "XYZ" }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ ...valid, preferredLanguage: "klingon" }).success).toBe(false);
  });
});

describe("avatarFileSchema", () => {
  it("treats an empty file as no upload", () => {
    expect(avatarFileSchema.parse(new File([], "", { type: "application/octet-stream" }))).toBeUndefined();
  });
  it("accepts a small image", () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    expect(avatarFileSchema.parse(file)).toBe(file);
  });
  it("rejects oversized files and non-images", () => {
    expect(avatarFileSchema.safeParse(new File([new Uint8Array(AVATAR_MAX_BYTES + 1)], "a.png", { type: "image/png" })).success).toBe(false);
    expect(avatarFileSchema.safeParse(new File(["x"], "a.svg", { type: "image/svg+xml" })).success).toBe(false);
  });
});
