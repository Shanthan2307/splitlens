import { describe, expect, it } from "vitest";
import type { LedgerExpense } from "./balances";
import { friendBalances } from "./balances";
import { userDebts } from "./user-debts";

const expense = (currency: string, payer: string, shares: Record<string, number>): LedgerExpense => {
  const total = Object.values(shares).reduce((a, b) => a + b, 0);
  return {
    kind: "expense",
    currency,
    payers: [{ participantId: payer, amount: total }],
    shares: Object.entries(shares).map(([participantId, amount]) => ({ participantId, amount })),
  };
};

describe("userDebts", () => {
  it("combines groups (mapped to users, simplified per group) with friend-only expenses", () => {
    const debts = userDebts(
      [
        {
          // me paid; bob and a placeholder owe. Placeholder debts disappear from friend views.
          simplify: false,
          entries: [expense("USD", "m-me", { "m-me": 1000, "m-bob": 1000, "m-ph": 1000 })],
          memberUsers: { "m-me": "me", "m-bob": "bob", "m-ph": null },
        },
        {
          // Chain bob → cat → me simplifies to bob → me.
          simplify: true,
          entries: [expense("EUR", "n-cat", { "n-bob": 500 }), expense("EUR", "n-me", { "n-cat": 500 })],
          memberUsers: { "n-me": "me", "n-bob": "bob", "n-cat": "cat" },
        },
      ],
      [expense("USD", "cat", { me: 300, cat: 300 })],
    );
    expect(debts).toEqual([
      { from: "bob", to: "me", amount: 500, currency: "EUR" },
      { from: "bob", to: "me", amount: 1000, currency: "USD" },
      { from: "me", to: "cat", amount: 300, currency: "USD" },
    ]);
    expect(friendBalances("me", debts)).toEqual({ bob: { USD: 1000, EUR: 500 }, cat: { USD: -300 } });
  });
});

import { netBalances } from "./balances";
import { balancesBetween, balanceSummary, participantBalance } from "./user-debts";

describe("userDebts keepPlaceholders", () => {
  it("keeps debts with placeholders under their member id", () => {
    const groups = [
      {
        simplify: true,
        entries: [expense("USD", "m-me", { "m-me": 500, "m-ph": 500 })],
        memberUsers: { "m-me": "me", "m-ph": null },
      },
    ];
    expect(userDebts(groups, [])).toEqual([]);
    expect(userDebts(groups, [], { keepPlaceholders: true })).toEqual([{ from: "m-ph", to: "me", amount: 500, currency: "USD" }]);
  });
});

describe("balancesBetween", () => {
  it("splits a pair's balance by group and outside groups", () => {
    const result = balancesBetween(
      [
        { groupId: "g1", simplify: false, entries: [expense("USD", "a", { b: 700 })], memberUsers: { a: "me", b: "bob" } },
        { groupId: "g2", simplify: false, entries: [expense("EUR", "x", { y: 300 })], memberUsers: { x: "bob", y: "me" } },
        { groupId: "g3", simplify: false, entries: [expense("USD", "p", { q: 100 })], memberUsers: { p: "cat", q: "me" } },
      ],
      [expense("USD", "bob", { me: 200 })],
      "me",
      "bob",
    );
    expect(result).toEqual([
      { groupId: "g1", currency: "USD", amount: 700 },
      { groupId: "g2", currency: "EUR", amount: -300 },
      { groupId: null, currency: "USD", amount: -200 },
    ]);
  });
});

describe("balanceSummary", () => {
  it("totals owe / owed / net per currency", () => {
    expect(
      balanceSummary({
        bob: { USD: 1000, EUR: -300 },
        cat: { USD: -400 },
        dan: { USD: -600 },
      }),
    ).toEqual({ owe: { EUR: 300, USD: 1000 }, owed: { USD: 1000 }, net: { EUR: -300 } });
    expect(balanceSummary({})).toEqual({ owe: {}, owed: {}, net: {} });
  });
});

describe("participantBalance", () => {
  it("picks one participant across currencies", () => {
    const balances = netBalances([expense("USD", "a", { b: 100 }), expense("JPY", "b", { a: 500 })]);
    expect(participantBalance(balances, "a")).toEqual({ USD: 100, JPY: -500 });
    expect(participantBalance(balances, "z")).toEqual({});
  });
});
