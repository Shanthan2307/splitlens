import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./crypto";

const key = Buffer.alloc(32, 1).toString("base64");

describe("token encryption", () => {
  it("round-trips and never stores the plaintext", () => {
    const sealed = encryptToken("secret-token", key);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("secret-token");
    expect(decryptToken(sealed, key)).toBe("secret-token");
  });

  it("uses a fresh IV every time", () => {
    expect(encryptToken("t", key)).not.toBe(encryptToken("t", key));
  });

  it("rejects tampering, wrong keys and unknown formats", () => {
    const sealed = encryptToken("secret-token", key);
    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0]! ^= 1;
    expect(() => decryptToken([...parts.slice(0, 3), flipped.toString("base64url")].join("."), key)).toThrow();
    expect(() => decryptToken(sealed, Buffer.alloc(32, 2).toString("base64"))).toThrow();
    expect(() => decryptToken("v0.a.b.c", key)).toThrow(/format/);
    expect(() => encryptToken("t", Buffer.alloc(8).toString("base64"))).toThrow(/32 bytes/);
  });
});
