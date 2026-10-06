import { describe, expect, it } from "vitest";
import { parseSettlementAmount } from "./settlement";

describe("parseSettlementAmount", () => {
  it("parses positive amounts per currency", () => {
    expect(parseSettlementAmount("25.50", "USD")).toEqual({ ok: true, amount: 2550 });
    expect(parseSettlementAmount("1000", "JPY")).toEqual({ ok: true, amount: 1000 });
    expect(parseSettlementAmount("1.005", "KWD")).toEqual({ ok: true, amount: 1005 });
  });
  it("rejects blank, zero, negative and malformed amounts", () => {
    expect(parseSettlementAmount(" ", "USD")).toEqual({ ok: false, message: "Enter an amount" });
    expect(parseSettlementAmount("0", "USD")).toEqual({ ok: false, message: "The amount must be more than zero" });
    expect(parseSettlementAmount("-5", "USD")).toEqual({ ok: false, message: "The amount must be more than zero" });
    expect(parseSettlementAmount("10.5", "JPY")).toEqual({ ok: false, message: "JPY allows at most 0 decimal places" });
  });
});
