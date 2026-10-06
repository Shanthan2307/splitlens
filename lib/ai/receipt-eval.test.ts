import { describe, expect, it } from "vitest";
import type { NormalizedReceipt } from "@/lib/splits";
import { compareReceipt, expectedReceiptSchema } from "./receipt-eval";

const actual: NormalizedReceipt = {
  currency: "USD",
  merchant: "Corner Diner",
  date: "2026-09-14",
  detectedLanguage: "en-US",
  pricesIncludeTax: false,
  lines: [
    { kind: "item", name: "Cheeseburger", originalName: null, amount: 1450 },
    { kind: "item", name: "Fries", originalName: null, amount: 850 },
    { kind: "tax", name: "Tax", originalName: null, amount: 207 },
  ],
  receiptTotal: 2507,
  computedTotal: 2507,
  inclusiveTax: 0,
  warnings: [],
};

describe("compareReceipt", () => {
  it("passes when everything matches (order-insensitive amounts)", () => {
    expect(
      compareReceipt(
        {
          merchantIncludes: "corner",
          date: "2026-09-14",
          currency: "USD",
          detectedLanguage: "en",
          total: "25.07",
          itemAmounts: ["8.50", "14.50"],
          lineAmounts: { tax: ["2.07"], tip: [] },
          itemNamesInclude: ["burger"],
          reconciles: true,
        },
        actual,
      ),
    ).toEqual([]);
  });

  it("lists every mismatch", () => {
    expect(
      compareReceipt(
        {
          merchantIncludes: "diner 2",
          date: "2026-09-15",
          detectedLanguage: "de",
          total: "25.00",
          itemAmounts: ["14.50"],
          lineAmounts: { tip: ["3.00"] },
          itemNamesInclude: ["salad"],
          reconciles: false,
        },
        { ...actual, merchant: null },
      ),
    ).toEqual([
      'merchant: expected to include "diner 2", got "null"',
      "date: expected 2026-09-15, got 2026-09-14",
      "language: expected de, got en-US",
      "total: expected 25.00, got 2507 (minor units)",
      "items: expected [1450], got [1450, 850]",
      "tip: expected [300], got []",
      'item names: none include "salad"',
      "reconciles: expected false, got true",
    ]);
  });

  it("stops at a currency mismatch", () => {
    expect(compareReceipt({ currency: "EUR", total: "1.00" }, actual)).toEqual(["currency: expected EUR, got USD"]);
  });

  it("applies defaults to expected files", () => {
    expect(expectedReceiptSchema.parse({ expect: {} })).toEqual({
      sourceLanguage: "auto",
      targetLanguage: "en",
      fallbackCurrency: "USD",
      expect: {},
    });
  });
});
