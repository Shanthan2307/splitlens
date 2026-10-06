import { describe, expect, it } from "vitest";
import { expenseNet, validatePayers } from "./payers";

const err = (code: string) => expect.objectContaining({ code });

describe("validatePayers", () => {
  it("accepts one or many payers summing to the total", () => {
    expect(() => validatePayers(1000, [{ participantId: "a", amount: 1000 }])).not.toThrow();
    expect(() =>
      validatePayers(1000, [
        { participantId: "a", amount: 600 },
        { participantId: "b", amount: 400 },
      ]),
    ).not.toThrow();
    expect(() => validatePayers(-1000, [{ participantId: "a", amount: -1000 }])).not.toThrow();
  });

  it("rejects bad payers", () => {
    expect(() => validatePayers(1000, [{ participantId: "a", amount: 900 }])).toThrow(err("SUM_MISMATCH"));
    expect(() =>
      validatePayers(1000, [
        { participantId: "a", amount: 1000 },
        { participantId: "b", amount: 0 },
      ]),
    ).toThrow(err("INVALID_AMOUNT"));
    expect(() =>
      validatePayers(1000, [
        { participantId: "a", amount: 1200 },
        { participantId: "b", amount: -200 },
      ]),
    ).toThrow(err("SIGN_MISMATCH"));
    expect(() =>
      validatePayers(1000, [
        { participantId: "a", amount: 500 },
        { participantId: "a", amount: 500 },
      ]),
    ).toThrow(err("DUPLICATE_PARTICIPANT"));
    expect(() => validatePayers(0, [{ participantId: "a", amount: 0 }])).toThrow(err("ZERO_TOTAL"));
    expect(() => validatePayers(100, [])).toThrow(err("NO_PARTICIPANTS"));
    expect(() => validatePayers(100, [{ participantId: "a", amount: 99.5 }])).toThrow(err("INVALID_AMOUNT"));
  });
});

describe("expenseNet", () => {
  it("one person paying for everyone (including themselves)", () => {
    expect(
      expenseNet(
        [{ participantId: "a", amount: 900 }],
        [
          { participantId: "a", amount: 300 },
          { participantId: "b", amount: 300 },
          { participantId: "c", amount: 300 },
        ],
      ),
    ).toEqual([
      { participantId: "a", amount: 600 },
      { participantId: "b", amount: -300 },
      { participantId: "c", amount: -300 },
    ]);
  });

  it("payer who is not part of the split", () => {
    expect(
      expenseNet(
        [{ participantId: "a", amount: 500 }],
        [
          { participantId: "b", amount: 250 },
          { participantId: "c", amount: 250 },
        ],
      ),
    ).toEqual([
      { participantId: "a", amount: 500 },
      { participantId: "b", amount: -250 },
      { participantId: "c", amount: -250 },
    ]);
  });

  it("multiple payers; zero nets are omitted", () => {
    expect(
      expenseNet(
        [
          { participantId: "a", amount: 700 },
          { participantId: "b", amount: 300 },
        ],
        [
          { participantId: "a", amount: 500 },
          { participantId: "b", amount: 300 },
          { participantId: "c", amount: 200 },
        ],
      ),
    ).toEqual([
      { participantId: "a", amount: 200 },
      { participantId: "c", amount: -200 },
    ]);
  });

  it("refund: payer receives money back, so they now owe the others", () => {
    expect(
      expenseNet(
        [{ participantId: "a", amount: -400 }],
        [
          { participantId: "a", amount: -200 },
          { participantId: "b", amount: -200 },
        ],
      ),
    ).toEqual([
      { participantId: "a", amount: -200 },
      { participantId: "b", amount: 200 },
    ]);
  });

  it("rejects unbalanced expenses", () => {
    expect(() => expenseNet([{ participantId: "a", amount: 100 }], [{ participantId: "b", amount: 99 }])).toThrow(
      err("SUM_MISMATCH"),
    );
  });
});

import { participantNet } from "./payers";

describe("participantNet", () => {
  const payers = [{ participantId: "a", amount: 900 }];
  const shares = [
    { participantId: "a", amount: 300 },
    { participantId: "b", amount: 600 },
  ];
  it("returns lent / borrowed / zero", () => {
    expect(participantNet(payers, shares, "a")).toBe(600);
    expect(participantNet(payers, shares, "b")).toBe(-600);
    expect(participantNet(payers, shares, "z")).toBe(0);
  });
});
