import { describe, expect, it } from "vitest";
import { expensePayloads, groupPayload, mapCategory, mapGroupType, nonGroupBalance } from "./mapping";
import { swExpenseSchema, swFriendSchema, swGroupSchema } from "./schemas";

const user = (id: number, paid: string, owed: string) => ({
  user_id: id,
  user: { first_name: `U${id}`, last_name: null },
  paid_share: paid,
  owed_share: owed,
});

describe("mapping", () => {
  it("maps group types and categories", () => {
    expect(mapGroupType("apartment")).toBe("home");
    expect(mapGroupType("trip")).toBe("trip");
    expect(mapGroupType("couple")).toBe("couple");
    expect(mapGroupType(null)).toBe("other");
    expect(mapCategory("Dining out")).toBe("dining");
    expect(mapCategory("Heat/gas")).toBe("utilities");
    expect(mapCategory("Gas/fuel")).toBe("fuel");
    expect(mapCategory("Childcare")).toBe("education");
    expect(mapCategory("Car")).toBe("car");
    expect(mapCategory("TV/Phone/Internet")).toBe("internet");
    expect(mapCategory("General")).toBe("general");
    expect(mapCategory(undefined)).toBe("general");
  });

  it("builds the group payload with normalized emails", () => {
    const group = swGroupSchema.parse({
      id: 7,
      name: " Flat ",
      group_type: "house",
      members: [{ id: 1, first_name: "Ana", last_name: "B", email: " ANA@x.test " }, { id: 2, first_name: null, last_name: null }],
    });
    expect(groupPayload(group, "EUR")).toEqual({
      splitwise_group_id: 7,
      name: "Flat",
      type: "home",
      simplify: true,
      currency: "EUR",
      members: [
        { splitwise_user_id: 1, name: "Ana B", email: "ana@x.test" },
        { splitwise_user_id: 2, name: "Splitwise user", email: null },
      ],
    });
  });

  it("converts expenses, payments, tombstones and comments", () => {
    const expenses = [
      { id: 1, group_id: 7, description: "Dinner", cost: "30.0", currency_code: "USD", date: "2026-09-01T12:00:00Z", category: { name: "Dining out" }, details: " note ", users: [user(1, "30.0", "15.0"), user(2, "0.0", "15.0")] },
      { id: 2, group_id: 7, description: "", payment: true, cost: "5", currency_code: "USD", date: "2026-09-02", users: [user(2, "5", "0"), user(1, "0", "5")] },
      { id: 3, group_id: 7, description: "Old", cost: "5", currency_code: "USD", date: "2026-09-02", deleted_at: "2026-09-03", users: [] },
      { id: 4, group_id: 7, description: "Broken", cost: "5", currency_code: "USD", date: "2026-09-02", users: [user(1, "4", "5")] },
    ].map((e) => swExpenseSchema.parse(e));
    const comments = new Map([
      [1, [
        { id: 10, content: " hi ", comment_type: "User", created_at: "2026-09-01T13:00:00Z", user: { id: 2, first_name: "Bo", last_name: null } },
        { id: 11, content: "Ana added this", comment_type: "System", user: { id: 1, first_name: "Ana", last_name: null } },
        { id: 12, content: "x", comment_type: "User", deleted_at: "2026-09-02" },
      ]],
    ]);
    const { payloads, people, invalid } = expensePayloads(expenses, comments as never);
    expect(invalid).toBe(1);
    expect(people.map((p) => p.splitwise_user_id)).toEqual([1, 2]);
    expect(payloads[0]).toMatchObject({
      splitwise_expense_id: 1,
      payment: false,
      description: "Dinner",
      category: "dining",
      date: "2026-09-01",
      total_minor: 3000,
      notes: "note",
      payers: [{ splitwise_user_id: 1, amount: 3000 }],
      shares: [{ splitwise_user_id: 1, amount: 1500 }, { splitwise_user_id: 2, amount: 1500 }],
      comments: [{ splitwise_comment_id: 10, splitwise_user_id: 2, author_name: "Bo", body: "hi", created_at: "2026-09-01T13:00:00Z" }],
    });
    expect(payloads[1]).toMatchObject({ splitwise_expense_id: 2, payment: true, description: "Payment", comments: [] });
    expect(payloads[2]).toEqual({ splitwise_expense_id: 3, deleted: true });
    expect(payloads).toHaveLength(3);
  });

  it("reads the outside-groups balance", () => {
    const friend = swFriendSchema.parse({
      id: 2,
      first_name: "Bo",
      groups: [
        { group_id: 0, balance: [{ currency_code: "USD", amount: "-7.25" }, { currency_code: "EUR", amount: "0.0" }, { currency_code: "ZZZ", amount: "1" }] },
        { group_id: 5, balance: [{ currency_code: "USD", amount: "3" }] },
      ],
    });
    expect(nonGroupBalance(friend)).toEqual([{ currency: "USD", amount: -725 }]);
    expect(nonGroupBalance(swFriendSchema.parse({ id: 3, first_name: "C" }))).toEqual([]);
  });
});
