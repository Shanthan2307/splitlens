import { describe, expect, it } from "vitest";
import { initials } from "./initials";
import { isActive } from "./nav-items";

describe("initials", () => {
  it.each([
    ["Ada Lovelace", "AL"],
    ["bob", "B"],
    ["  Mary Ann  Evans ", "ME"],
    ["", "?"],
  ])("%j → %s", (name, expected) => expect(initials(name)).toBe(expected));
});

describe("isActive", () => {
  it("matches the route and its children only", () => {
    expect(isActive("/groups", "/groups")).toBe(true);
    expect(isActive("/groups/abc", "/groups")).toBe(true);
    expect(isActive("/groupsx", "/groups")).toBe(false);
  });
});
