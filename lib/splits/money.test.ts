import { describe, expect, it } from "vitest";
import { assertMinor, formatMinor, normalizeZero, parseMajor, sign, sumMinor, toMajorString } from "./money";

describe("parseMajor", () => {
  it.each([
    ["12.34", "USD", 1234],
    ["12.3", "USD", 1230],
    ["12", "USD", 1200],
    [" 0.01 ", "USD", 1],
    ["-5.50", "EUR", -550],
    ["-0", "USD", 0],
    ["1000", "JPY", 1000],
    ["50000", "KRW", 50000],
    ["1.234", "KWD", 1234],
    ["0.005", "KWD", 5],
    ["1.2", "KWD", 1200],
  ])("%s %s → %d", (input, currency, expected) => {
    expect(parseMajor(input, currency)).toBe(expected);
  });

  it("never returns -0", () => {
    expect(Object.is(parseMajor("-0.00", "USD"), 0)).toBe(true);
  });

  it("rejects more decimals than the currency allows", () => {
    expect(() => parseMajor("10.5", "JPY")).toThrow(expect.objectContaining({ code: "INVALID_MONEY_STRING" }));
    expect(() => parseMajor("1.001", "USD")).toThrow(expect.objectContaining({ code: "INVALID_MONEY_STRING" }));
    expect(() => parseMajor("1.0001", "KWD")).toThrow(expect.objectContaining({ code: "INVALID_MONEY_STRING" }));
  });

  it.each(["", "abc", "1,000.00", "1.", ".5", "1e3", "--1", "+1"])("rejects %j", (input) => {
    expect(() => parseMajor(input, "USD")).toThrow(expect.objectContaining({ code: "INVALID_MONEY_STRING" }));
  });

  it("rejects unknown currencies and unsafe magnitudes", () => {
    expect(() => parseMajor("1", "XYZ")).toThrow(expect.objectContaining({ code: "UNKNOWN_CURRENCY" }));
    expect(() => parseMajor("99999999999999999", "USD")).toThrow(expect.objectContaining({ code: "INVALID_AMOUNT" }));
  });
});

describe("toMajorString", () => {
  it.each([
    [1234, "USD", "12.34"],
    [5, "USD", "0.05"],
    [-5, "USD", "-0.05"],
    [0, "USD", "0.00"],
    [1000, "JPY", "1000"],
    [-1000, "KRW", "-1000"],
    [1234, "KWD", "1.234"],
    [-5, "KWD", "-0.005"],
  ])("%d %s → %s", (amount, currency, expected) => {
    expect(toMajorString(amount, currency)).toBe(expected);
  });

  it("round-trips with parseMajor", () => {
    for (const [amount, currency] of [[123456789, "USD"], [-42, "KWD"], [7, "JPY"]] as const) {
      expect(parseMajor(toMajorString(amount, currency), currency)).toBe(amount);
    }
  });
});

describe("formatMinor", () => {
  it("formats with the currency's minor units", () => {
    expect(formatMinor(123456, "USD", "en-US")).toBe("$1,234.56");
    expect(formatMinor(1000, "JPY", "en-US")).toBe("¥1,000");
    // Intl uses non-breaking spaces between code/symbol and number.
    const plain = (s: string) => s.replace(/\s/g, " ");
    expect(plain(formatMinor(1234, "KWD", "en-US"))).toBe("KWD 1.234");
    expect(plain(formatMinor(-550, "EUR", "de-DE"))).toBe("-5,50 €");
  });

  it("is exact beyond float precision", () => {
    expect(formatMinor(9007199254740991, "USD", "en-US")).toBe("$90,071,992,547,409.91");
  });
});

describe("helpers", () => {
  it("sumMinor adds and guards overflow", () => {
    expect(sumMinor([1, 2, -3])).toBe(0);
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(expect.objectContaining({ code: "INVALID_AMOUNT" }));
  });
  it("sign", () => {
    expect([sign(-3), sign(0), sign(9)]).toEqual([-1, 0, 1]);
  });
  it("normalizeZero", () => {
    expect(Object.is(normalizeZero(-0), 0)).toBe(true);
    expect(normalizeZero(-2)).toBe(-2);
  });
  it("assertMinor", () => {
    expect(() => assertMinor(NaN)).toThrow();
    expect(() => assertMinor(Infinity)).toThrow();
    expect(() => assertMinor(5)).not.toThrow();
  });
});

import { formatScaled, parseBasisPoints, parseScaled, parseShareWeight } from "./money";

describe("scaled decimals", () => {
  it.each([
    ["33.33", 2, 3333],
    ["100", 2, 10000],
    ["0.5", 2, 50],
    [" 7 ", 0, 7],
  ])("parseScaled(%s, %d) → %d", (input, decimals, expected) => {
    expect(parseScaled(input, decimals)).toBe(expected);
  });

  it("rejects bad input", () => {
    expect(() => parseScaled("-1", 2)).toThrow(expect.objectContaining({ code: "INVALID_MONEY_STRING" }));
    expect(() => parseScaled("1.234", 2)).toThrow("Use at most 2 decimal places");
    expect(() => parseScaled("", 2)).toThrow(expect.objectContaining({ code: "INVALID_MONEY_STRING" }));
    expect(() => parseScaled("99999999999999999", 2)).toThrow(expect.objectContaining({ code: "INVALID_AMOUNT" }));
  });

  it.each([
    [3333, 2, "33.33"],
    [10000, 2, "100"],
    [50, 2, "0.5"],
    [15000, 4, "1.5"],
    [20000, 4, "2"],
    [-150, 2, "-1.5"],
    [7, 0, "7"],
  ])("formatScaled(%d, %d) → %s", (value, decimals, expected) => {
    expect(formatScaled(value, decimals)).toBe(expected);
  });

  it("percent and share helpers", () => {
    expect(parseBasisPoints("12.5")).toBe(1250);
    expect(parseShareWeight("1.5")).toBe(15000);
  });
});
