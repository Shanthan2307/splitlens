import { describe, expect, it } from "vitest";
import { paypalMeUrl, venmoPayUrl } from "./deep-links";

describe("deep links", () => {
  it("builds a Venmo pay link for USD only", () => {
    expect(venmoPayUrl({ username: "bob-b", amount: 2550, currency: "USD", note: "Dinner & drinks" })).toBe(
      "https://venmo.com/bob-b?txn=pay&amount=25.50&note=Dinner+%26+drinks",
    );
    expect(venmoPayUrl({ username: "bob-b", amount: 2550, currency: "EUR", note: "x" })).toBeNull();
  });
  it("builds a PayPal.me link with exact minor units", () => {
    expect(paypalMeUrl({ username: "bobb", amount: 1005, currency: "KWD" })).toBe("https://paypal.me/bobb/1.005KWD");
    expect(paypalMeUrl({ username: "bobb", amount: 1000, currency: "JPY" })).toBe("https://paypal.me/bobb/1000JPY");
  });
});
