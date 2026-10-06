import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  friendBalances,
  netBalances,
  pairwiseDebts,
  remapDebts,
  totalBalance,
  type LedgerEntry,
  type LedgerExpense,
} from "./balances";
import { groupDebts } from "./group-debts";
import type { Debt } from "./types";

const err = (code: string) => expect.objectContaining({ code });

function expense(currency: string, payers: Record<string, number>, shares: Record<string, number>): LedgerExpense {
  const list = (o: Record<string, number>) => Object.entries(o).map(([participantId, amount]) => ({ participantId, amount }));
  return { kind: "expense", currency, payers: list(payers), shares: list(shares) };
}

describe("netBalances", () => {
  it("nets a group's expenses and settlements per currency", () => {
    const entries: LedgerEntry[] = [
      expense("USD", { a: 3000 }, { a: 1000, b: 1000, c: 1000 }),
      expense("USD", { b: 1500 }, { a: 500, b: 500, c: 500 }),
      expense("JPY", { c: 3000 }, { a: 1500, c: 1500 }),
      { kind: "settlement", currency: "USD", from: "c", to: "a", amount: 1000 },
    ];
    // USD: a +2000 −500 −1000, b −1000 +1000 (settled, omitted), c −1000 −500 +1000.
    expect(netBalances(entries)).toEqual({ USD: { a: 500, c: -500 }, JPY: { a: -1500, c: 1500 } });
  });

  it("omits zero balances and empty currencies", () => {
    const entries: LedgerEntry[] = [
      expense("EUR", { a: 1000 }, { a: 500, b: 500 }),
      { kind: "settlement", currency: "EUR", from: "b", to: "a", amount: 500 },
    ];
    expect(netBalances(entries)).toEqual({});
  });

  it("keeps currencies separate", () => {
    const entries: LedgerEntry[] = [
      expense("USD", { a: 1000 }, { a: 500, b: 500 }),
      expense("EUR", { b: 1000 }, { a: 500, b: 500 }),
    ];
    expect(netBalances(entries)).toEqual({ USD: { a: 500, b: -500 }, EUR: { a: -500, b: 500 } });
  });

  it("applies refunds against the original expense", () => {
    // a paid $100 for a+b, then got a $40 refund split the same way: b owes $30.
    const entries: LedgerEntry[] = [
      expense("USD", { a: 10000 }, { a: 5000, b: 5000 }),
      expense("USD", { a: -4000 }, { a: -2000, b: -2000 }),
    ];
    expect(netBalances(entries)).toEqual({ USD: { a: 3000, b: -3000 } });
  });

  it("validates settlements", () => {
    expect(() => netBalances([{ kind: "settlement", currency: "USD", from: "a", to: "b", amount: 0 }])).toThrow(
      err("INVALID_AMOUNT"),
    );
    expect(() => netBalances([{ kind: "settlement", currency: "USD", from: "a", to: "a", amount: 5 }])).toThrow(
      err("DUPLICATE_PARTICIPANT"),
    );
  });
});

describe("pairwiseDebts", () => {
  it("single payer: everyone owes the payer their share", () => {
    expect(pairwiseDebts([expense("USD", { a: 900 }, { a: 300, b: 300, c: 300 })])).toEqual([
      { from: "b", to: "a", amount: 300, currency: "USD" },
      { from: "c", to: "a", amount: 300, currency: "USD" },
    ]);
  });

  it("multiple payers: debtors owe creditors in proportion to what they're owed", () => {
    // a paid 500, b paid 400, each owes 300 → a +200, b +100, c −300.
    expect(
      pairwiseDebts([expense("USD", { a: 500, b: 400 }, { a: 300, b: 300, c: 300 })]),
    ).toEqual([
      { from: "c", to: "a", amount: 200, currency: "USD" },
      { from: "c", to: "b", amount: 100, currency: "USD" },
    ]);
  });

  it("keeps per-creditor totals exact when rounding", () => {
    // Creditors a,b each +1; debtors c,d each -1. Naive proportional rounding would pay a twice.
    const debts = pairwiseDebts([expense("USD", { a: 2, b: 2 }, { a: 1, b: 1, c: 1, d: 1 })]);
    const received = (id: string) => debts.filter((d) => d.to === id).reduce((s, d) => s + d.amount, 0);
    expect(received("a")).toBe(1);
    expect(received("b")).toBe(1);
  });

  it("nets debts between the same pair across expenses and settlements", () => {
    expect(
      pairwiseDebts([
        expense("USD", { a: 1000 }, { a: 500, b: 500 }),
        expense("USD", { b: 600 }, { a: 300, b: 300 }),
        { kind: "settlement", currency: "USD", from: "b", to: "a", amount: 100 },
      ]),
    ).toEqual([{ from: "b", to: "a", amount: 100, currency: "USD" }]);
  });

  it("an overpayment flips the direction", () => {
    expect(
      pairwiseDebts([
        expense("USD", { a: 1000 }, { a: 500, b: 500 }),
        { kind: "settlement", currency: "USD", from: "b", to: "a", amount: 700 },
      ]),
    ).toEqual([{ from: "a", to: "b", amount: 200, currency: "USD" }]);
  });

  it("handles refunds", () => {
    expect(
      pairwiseDebts([
        expense("USD", { a: 10000 }, { a: 5000, b: 5000 }),
        expense("USD", { a: -4000 }, { a: -2000, b: -2000 }),
      ]),
    ).toEqual([{ from: "b", to: "a", amount: 3000, currency: "USD" }]);
  });

  it("drops fully settled pairs and validates settlements", () => {
    expect(
      pairwiseDebts([
        expense("KWD", { a: 1000 }, { a: 500, b: 500 }),
        { kind: "settlement", currency: "KWD", from: "b", to: "a", amount: 500 },
      ]),
    ).toEqual([]);
    expect(() => pairwiseDebts([{ kind: "settlement", currency: "USD", from: "a", to: "b", amount: -1 }])).toThrow(
      err("INVALID_AMOUNT"),
    );
  });

  it("property: pairwise debts reproduce each person's net balance", () => {
    const people = ["a", "b", "c", "d", "e"];
    const amounts = fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 5, maxLength: 5 });
    const entry = fc.tuple(amounts, amounts).filter(([p, s]) => p.some((x) => x > 0) && s.some((x) => x > 0));
    fc.assert(
      fc.property(fc.array(entry, { minLength: 1, maxLength: 10 }), (raw) => {
        const entries: LedgerEntry[] = raw.map(([paidWeights, owedWeights]) => {
          // Scale so paid and owed totals match exactly.
          const total = paidWeights.reduce((a, b) => a + b, 0);
          const owedSum = owedWeights.reduce((a, b) => a + b, 0);
          const owed = owedWeights.map((w) => Math.floor((w * total) / owedSum));
          owed[owedWeights.findIndex((w) => w > 0)] += total - owed.reduce((a, b) => a + b, 0);
          return {
            kind: "expense",
            currency: "USD",
            payers: people.map((id, i) => ({ participantId: id, amount: paidWeights[i] })).filter((p) => p.amount > 0),
            shares: people.map((id, i) => ({ participantId: id, amount: owed[i] })),
          };
        });
        const net = netBalances(entries).USD ?? {};
        const fromDebts: Record<string, number> = {};
        for (const d of pairwiseDebts(entries)) {
          expect(d.amount).toBeGreaterThan(0);
          fromDebts[d.from] = (fromDebts[d.from] ?? 0) - d.amount;
          fromDebts[d.to] = (fromDebts[d.to] ?? 0) + d.amount;
        }
        for (const id of people) expect(fromDebts[id] ?? 0).toBe(net[id] ?? 0);
      }),
    );
  });
});

describe("groupDebts", () => {
  const entries: LedgerEntry[] = [
    expense("USD", { a: 1000 }, { b: 1000 }),
    expense("USD", { b: 1000 }, { c: 1000 }),
  ];
  it("without simplification keeps the chain", () => {
    expect(groupDebts(entries, { simplify: false })).toEqual([
      { from: "b", to: "a", amount: 1000, currency: "USD" },
      { from: "c", to: "b", amount: 1000, currency: "USD" },
    ]);
  });
  it("with simplification collapses it", () => {
    expect(groupDebts(entries, { simplify: true })).toEqual([{ from: "c", to: "a", amount: 1000, currency: "USD" }]);
  });
});

describe("remapDebts", () => {
  it("maps member ids to user ids and drops placeholders", () => {
    const debts: Debt[] = [
      { from: "m1", to: "m2", amount: 100, currency: "USD" },
      { from: "m3", to: "m1", amount: 50, currency: "USD" },
      { from: "m4", to: "m5", amount: 10, currency: "USD" },
    ];
    expect(remapDebts(debts, { m1: "u1", m2: "u2", m3: null, m4: "u4", m5: "u4" })).toEqual([
      { from: "u1", to: "u2", amount: 100, currency: "USD" },
    ]);
  });
});

describe("friendBalances / totalBalance", () => {
  // Debts already in user ids: two groups plus friend-only expenses.
  const tripGroup: Debt[] = [
    { from: "bob", to: "me", amount: 3000, currency: "USD" },
    { from: "me", to: "cat", amount: 1000, currency: "USD" },
  ];
  const homeGroup: Debt[] = [
    { from: "me", to: "bob", amount: 1200, currency: "USD" },
    { from: "bob", to: "me", amount: 5000, currency: "JPY" },
  ];
  const friendOnly: Debt[] = [
    { from: "cat", to: "me", amount: 1000, currency: "USD" },
    { from: "bob", to: "cat", amount: 999, currency: "USD" },
  ];
  const all = [...tripGroup, ...homeGroup, ...friendOnly];

  it("sums each friend across groups, per currency, dropping settled ones", () => {
    expect(friendBalances("me", all)).toEqual({ bob: { USD: 1800, JPY: 5000 } });
  });

  it("shows negative when I owe", () => {
    expect(friendBalances("me", [{ from: "me", to: "dan", amount: 250, currency: "KWD" }])).toEqual({
      dan: { KWD: -250 },
    });
  });

  it("totals per currency", () => {
    expect(totalBalance("me", all)).toEqual({ USD: 1800, JPY: 5000 });
    expect(
      totalBalance("me", [
        { from: "me", to: "a", amount: 100, currency: "USD" },
        { from: "b", to: "me", amount: 100, currency: "USD" },
      ]),
    ).toEqual({});
  });
});
