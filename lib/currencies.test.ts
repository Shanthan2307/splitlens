import { describe, expect, it } from "vitest";
import { CURRENCY_CODES, currencyName, isCurrencyCode, minorUnitExponent } from "./currencies";

describe("currencies", () => {
  it("has unique, well-formed codes", () => {
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
    for (const code of CURRENCY_CODES) expect(code).toMatch(/^[A-Z]{3}$/);
  });
  it("knows minor-unit exponents", () => {
    expect(minorUnitExponent("USD")).toBe(2);
    expect(minorUnitExponent("JPY")).toBe(0);
    expect(minorUnitExponent("KWD")).toBe(3);
  });
  it("validates codes", () => {
    expect(isCurrencyCode("EUR")).toBe(true);
    expect(isCurrencyCode("eur")).toBe(false);
  });
  it("names currencies", () => {
    expect(currencyName("EUR")).toBe("Euro");
  });
});
