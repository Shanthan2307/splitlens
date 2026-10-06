import { describe, expect, it } from "vitest";
import type { ReceiptModelOutput } from "@/lib/validation/receipt";
import { normalizeReceipt, ReceiptFormatError, receiptToDraftLines } from "./receipt";

const base = (overrides: Partial<ReceiptModelOutput> = {}): ReceiptModelOutput => ({
  is_receipt: true,
  merchant: "Corner Diner",
  date: "2026-10-04",
  currency: "USD",
  detected_language: "en",
  prices_include_tax: false,
  items: [
    { original_name: "Burger", translated_name: "Burger", quantity: "1", unit_price: "12.00", line_total: "12.00", line_discount: null },
    { original_name: "Fries", translated_name: "Fries", quantity: "2", unit_price: "3.50", line_total: "7.00", line_discount: null },
  ],
  discounts: [],
  taxes: [{ name: "Sales tax 8.875%", rate_percent: "8.875", amount: "1.69", inclusive: false }],
  service_charge: null,
  tip: "4.00",
  subtotal: "19.00",
  total: "24.69",
  total_is_handwritten: false,
  warnings: [],
  ...overrides,
});

describe("normalizeReceipt", () => {
  it("tax-added receipt with tip reconciles exactly", () => {
    const r = normalizeReceipt(base(), "EUR");
    expect(r.currency).toBe("USD");
    expect(r.lines).toEqual([
      { kind: "item", name: "Burger", originalName: "Burger", amount: 1200, quantity: "1", unitPrice: 1200 },
      { kind: "item", name: "Fries", originalName: "Fries", amount: 700, quantity: "2", unitPrice: 350 },
      { kind: "tax", name: "Sales tax 8.875%", originalName: null, amount: 169 },
      { kind: "tip", name: "Tip", originalName: null, amount: 400 },
    ]);
    expect(r.computedTotal).toBe(2469);
    expect(r.receiptTotal).toBe(2469);
    expect(r.warnings).toEqual([]);
  });

  it("VAT-inclusive prices: inclusive tax is informational, not added", () => {
    const r = normalizeReceipt(
      base({
        currency: "eur",
        detected_language: "de",
        prices_include_tax: true,
        items: [
          { original_name: "Weißbier", translated_name: "Wheat beer", quantity: "2", unit_price: "4.90", line_total: "9.80", line_discount: null },
          { original_name: "Brezel", translated_name: "Pretzel", quantity: "1", unit_price: null, line_total: "2.50", line_discount: null },
        ],
        taxes: [
          { name: "MwSt 19%", rate_percent: "19", amount: "1.56", inclusive: true },
          { name: "MwSt 7%", rate_percent: "7", amount: "0.16", inclusive: true },
        ],
        tip: null,
        subtotal: null,
        total: "12.30",
      }),
      "USD",
    );
    expect(r.currency).toBe("EUR");
    expect(r.lines.map((l) => l.amount)).toEqual([980, 250]);
    expect(r.inclusiveTax).toBe(172);
    expect(r.computedTotal).toBe(1230);
    expect(r.warnings).toEqual([]);
  });

  it("zero-decimal currencies and service charges", () => {
    const r = normalizeReceipt(
      base({
        currency: "JPY",
        items: [{ original_name: "ラーメン", translated_name: "Ramen", quantity: "1", unit_price: "1280", line_total: "1280", line_discount: null }],
        taxes: [{ name: "消費税 10%", rate_percent: "10", amount: "128", inclusive: false }],
        service_charge: { amount: "100", rate_percent: null, inclusive: false },
        tip: null,
        subtotal: "1280",
        total: "1508",
      }),
      "USD",
    );
    expect(r.lines.map((l) => [l.kind, l.amount])).toEqual([
      ["item", 1280],
      ["tax", 128],
      ["service", 100],
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("line discounts, receipt discounts (sign-insensitive) and refunds", () => {
    const r = normalizeReceipt(
      base({
        items: [
          { original_name: "Shirt", translated_name: "Shirt", quantity: "1", unit_price: "20.00", line_total: "20.00", line_discount: "5.00" },
          { original_name: "Return: Socks", translated_name: "Return: Socks", quantity: "1", unit_price: "4.00", line_total: "-4.00", line_discount: null },
        ],
        discounts: [
          { original_name: "Member 10%", translated_name: "Member 10%", amount: "-1.10" },
          { original_name: "Zero", translated_name: "", amount: "0" },
        ],
        taxes: [{ name: "", rate_percent: null, amount: "0.80", inclusive: false }],
        tip: null,
        subtotal: "11.00",
        total: "10.70",
      }),
      "USD",
    );
    expect(r.lines.map((l) => [l.kind, l.name, l.amount])).toEqual([
      ["item", "Shirt", 1500],
      ["item", "Return: Socks", -400],
      ["discount", "Member 10%", -110],
      ["tax", "Tax", 80],
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("subtotal may exclude inclusive tax", () => {
    const r = normalizeReceipt(
      base({
        prices_include_tax: true,
        items: [{ original_name: "A", translated_name: "A", quantity: "1", unit_price: null, line_total: "11.00", line_discount: null }],
        taxes: [{ name: "GST", rate_percent: "10", amount: "1.00", inclusive: true }],
        tip: null,
        subtotal: "10.00",
        total: "11.00",
      }),
      "AUD",
    );
    expect(r.warnings).toEqual([]);
  });

  it("surfaces mismatches as warnings", () => {
    const r = normalizeReceipt(
      base({
        items: [
          { original_name: "Pizza", translated_name: "", quantity: "2", unit_price: "9.00", line_total: "20.00", line_discount: null },
          { original_name: "", translated_name: "", quantity: "1 kg", unit_price: "1.00", line_total: "1.00", line_discount: null },
        ],
        taxes: [],
        tip: null,
        subtotal: "22.00",
        total: "25.00",
        total_is_handwritten: true,
        warnings: ["Bottom is torn", " "],
      }),
      "USD",
    );
    expect(r.lines.map((l) => l.name)).toEqual(["Pizza", "Item 2"]);
    expect(r.warnings).toEqual([
      "Bottom is torn",
      "“Pizza”: 2 × $9.00 doesn't match the line total $20.00.",
      "“Item 2”: couldn't read the quantity “1 kg”.",
      "Items add up to $21.00 but the printed subtotal is $22.00.",
      "Lines add up to $21.00 but the receipt total is $25.00 (missing $4.00).",
      "The total is handwritten; double-check it.",
    ]);
  });

  it("warns about extra amounts, a missing total, missing currency and no items", () => {
    expect(normalizeReceipt(base({ tip: null, total: "20.00", subtotal: null }), "USD").warnings).toEqual([
      "Lines add up to $20.69 but the receipt total is $20.00 (extra $0.69).",
    ]);
    const r = normalizeReceipt(
      base({ currency: null, items: [], taxes: [], tip: null, subtotal: null, total: null, merchant: "  ", date: "2026-02-30" }),
      "GBP",
    );
    expect(r.currency).toBe("GBP");
    expect(r.merchant).toBeNull();
    expect(r.date).toBeNull();
    expect(r.warnings).toEqual([
      "No currency shown on the receipt; assumed GBP.",
      "No items were found. Add them manually.",
      "No total was found on the receipt; check the amounts.",
    ]);
    expect(normalizeReceipt(base({ date: "04/10/2026" }), "USD").date).toBeNull();
  });

  it("rejects unusable output so the parser can retry", () => {
    expect(() => normalizeReceipt(base({ is_receipt: false }), "USD")).toThrow(ReceiptFormatError);
    try {
      normalizeReceipt(
        base({
          currency: "DOLLARS",
          items: [{ original_name: "A", translated_name: "A", quantity: "1", unit_price: null, line_total: "1,50", line_discount: null }],
          service_charge: { amount: "x", rate_percent: null, inclusive: false },
        }),
        "USD",
      );
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ReceiptFormatError);
      expect((error as ReceiptFormatError).issues).toEqual([
        'currency "DOLLARS" is not an ISO 4217 code',
        'items[0].line_total: "1,50" is not a valid USD amount ("1,50" is not a decimal amount)',
        'service_charge.amount: "x" is not a valid USD amount ("x" is not a decimal amount)',
      ]);
    }
  });

  it("falls back to generic names and skips zero taxes", () => {
    const r = normalizeReceipt(
      base({
        discounts: [{ original_name: " ", translated_name: " ", amount: "1.00" }],
        taxes: [
          { name: "Tax", rate_percent: null, amount: "0.00", inclusive: false },
          { name: "Sales tax", rate_percent: null, amount: "1.69", inclusive: false },
        ],
        total: "23.69",
      }),
      "USD",
    );
    expect(r.lines.find((l) => l.kind === "discount")).toEqual({ kind: "discount", name: "Discount", originalName: null, amount: -100 });
    expect(r.lines.filter((l) => l.kind === "tax")).toHaveLength(1);
  });

  it("reports bad discount and tax amounts", () => {
    expect(() =>
      normalizeReceipt(
        base({
          discounts: [{ original_name: "D", translated_name: "D", amount: "abc" }],
          taxes: [{ name: "T", rate_percent: null, amount: "1.2.3", inclusive: false }],
        }),
        "USD",
      ),
    ).toThrow(/discounts\[0\]\.amount.*taxes\[0\]\.amount/);
  });

  it("ignores inclusive service charges and zero tips", () => {
    const r = normalizeReceipt(
      base({ service_charge: { amount: "2.00", rate_percent: "10", inclusive: true }, tip: "0", total: "20.69" }),
      "USD",
    );
    expect(r.lines.map((l) => l.kind)).toEqual(["item", "item", "tax"]);
  });
});

describe("receiptToDraftLines", () => {
  it("produces unassigned draft lines with original names when they differ", () => {
    expect(
      receiptToDraftLines({
        currency: "JPY",
        lines: [
          { kind: "item", name: "Ramen", originalName: "ラーメン", amount: 1280, quantity: "2", unitPrice: 640 },
          { kind: "item", name: "Gyoza", originalName: "Gyoza", amount: 480 },
          { kind: "tax", name: "Tax", originalName: null, amount: 176 },
        ],
      }),
    ).toEqual([
      { kind: "item", name: "Ramen", originalName: "ラーメン", quantity: "2", unitPrice: "640", amount: "1280", assignments: [] },
      { kind: "item", name: "Gyoza", amount: "480", assignments: [] },
      { kind: "tax", name: "Tax", amount: "176", assignments: [] },
    ]);
  });
});
