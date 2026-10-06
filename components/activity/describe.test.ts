import { describe, expect, it } from "vitest";
import type { ActivityItem } from "@/lib/db/activity";
import { describeActivity } from "./describe";

const base: ActivityItem = {
  id: 1,
  action: "expense_created",
  actorId: "u-bob",
  actorName: "Bob",
  groupId: "g1",
  groupName: "Lisbon",
  expenseId: "e1",
  settlementId: null,
  payload: {},
  createdAt: "2026-10-06T10:00:00Z",
};

describe("describeActivity", () => {
  it("expense created with my impact", () => {
    const d = describeActivity(
      {
        ...base,
        payload: {
          after: {
            description: "Dinner",
            currency: "EUR",
            total_minor: 9000,
            payers: [{ participant_id: "m-bob", user_id: "u-bob", name: "Bob", amount: 9000 }],
            shares: [
              { participant_id: "m-me", user_id: "u-me", name: "Me", amount: 4500 },
              { participant_id: "m-bob", user_id: "u-bob", name: "Bob", amount: 4500 },
            ],
          },
        },
      },
      "u-me",
    );
    expect(d).toEqual({ kind: "expense", text: "Bob added “Dinner” in Lisbon", href: "/expenses/e1", impact: { amount: -4500, currency: "EUR" }, deleted: false });
  });

  it("expense I'm not part of has no impact; deletion is flagged", () => {
    const payload = { after: { description: "Taxi", currency: "USD", payers: [{ user_id: "u-bob", amount: 100 }], shares: [{ user_id: "u-bob", amount: 100 }] } };
    expect(describeActivity({ ...base, payload }, "u-me").impact).toBeNull();
    expect(describeActivity({ ...base, action: "expense_deleted", actorId: "u-me", payload }, "u-me")).toMatchObject({
      text: "You deleted “Taxi” in Lisbon",
      deleted: true,
    });
  });

  it("payments read from my perspective", () => {
    const d = describeActivity(
      {
        ...base,
        action: "settlement_created",
        expenseId: null,
        settlementId: "s1",
        groupId: null,
        groupName: null,
        payload: { after: { from: { user_id: "u-bob", name: "Bob" }, to: { user_id: "u-me", name: "Me" }, amount_minor: 2500, currency: "USD" } },
      },
      "u-me",
    );
    expect(d).toEqual({
      kind: "payment",
      text: "Bob recorded a payment: Bob paid you $25.00",
      href: "/settlements/s1",
      impact: { amount: -2500, currency: "USD" },
      deleted: false,
    });
  });

  it("comments, members and friends", () => {
    expect(describeActivity({ ...base, action: "comment_added", payload: { body: "Thanks!", subject: "Dinner" } }, "u-me").text).toBe(
      "Bob commented on “Dinner”: “Thanks!”",
    );
    expect(describeActivity({ ...base, action: "member_added", payload: { via: "invite" } }, "u-me").text).toBe("Bob joined in Lisbon");
    expect(describeActivity({ ...base, action: "placeholder_claimed", payload: { name: "Carol" } }, "u-me").text).toBe(
      "Bob joined as Carol in Lisbon",
    );
    expect(describeActivity({ ...base, action: "friend_accepted" }, "u-me").href).toBe("/friends");
  });
});
