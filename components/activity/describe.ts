import type { ActivityItem } from "@/lib/db/activity";
import { formatMinor, participantNet } from "@/lib/splits";

type Party = { participant_id?: string; user_id?: string | null; name?: string | null; amount?: number };
type ExpenseSnap = { description?: string; total_minor?: number; currency?: string; payers?: Party[]; shares?: Party[] };
type SettlementSnap = { from?: Party; to?: Party; amount_minor?: number; currency?: string };
type Payload = {
  before?: ExpenseSnap & SettlementSnap;
  after?: ExpenseSnap & SettlementSnap;
  name?: string;
  body?: string;
  subject?: string;
  via?: string;
};

export type ActivityKind = "expense" | "payment" | "comment" | "group" | "member" | "friend" | "other";

export type DescribedActivity = {
  kind: ActivityKind;
  text: string;
  href: string | null;
  /** My net from this expense/payment (positive = I get back), when I'm involved. */
  impact: { amount: number; currency: string } | null;
  deleted: boolean;
};

/** Turns an activity row (with its snapshot payload) into a sentence for the feed. */
export function describeActivity(item: ActivityItem, meUserId: string): DescribedActivity {
  const p = (item.payload ?? {}) as Payload;
  const actor = item.actorId === meUserId ? "You" : (item.actorName ?? "Someone");
  const inGroup = item.groupName ? ` in ${item.groupName}` : "";
  const who = (party?: Party) => (party?.user_id === meUserId ? "you" : (party?.name ?? "someone"));
  const snap = p.after ?? p.before ?? {};
  const money = (amount?: number, currency?: string) => (amount !== undefined && currency ? formatMinor(amount, currency) : "");

  const expenseImpact = () => {
    const toParty = (x: Party) => ({ participantId: x.user_id ?? x.participant_id ?? "", amount: x.amount ?? 0 });
    const payers = (snap.payers ?? []).map(toParty);
    const shares = (snap.shares ?? []).map(toParty);
    const involved = [...payers, ...shares].some((x) => x.participantId === meUserId);
    if (!involved || !snap.currency) return null;
    return { amount: participantNet(payers, shares, meUserId), currency: snap.currency };
  };
  const settlementImpact = () => {
    if (!snap.currency || snap.amount_minor === undefined) return null;
    if (snap.from?.user_id === meUserId) return { amount: snap.amount_minor, currency: snap.currency };
    if (snap.to?.user_id === meUserId) return { amount: -snap.amount_minor, currency: snap.currency };
    return null;
  };

  const expenseHref = item.expenseId ? `/expenses/${item.expenseId}` : null;
  const settlementHref = item.settlementId ? `/settlements/${item.settlementId}` : null;
  const groupHref = item.groupId ? `/groups/${item.groupId}` : null;
  const desc = `“${snap.description ?? "an expense"}”`;
  const payment = `${who(snap.from)} paid ${who(snap.to)} ${money(snap.amount_minor, snap.currency)}`;

  switch (item.action) {
    case "expense_created":
      return { kind: "expense", text: `${actor} added ${desc}${inGroup}`, href: expenseHref, impact: expenseImpact(), deleted: false };
    case "expense_updated":
      return { kind: "expense", text: `${actor} updated ${desc}${inGroup}`, href: expenseHref, impact: expenseImpact(), deleted: false };
    case "expense_deleted":
      return { kind: "expense", text: `${actor} deleted ${desc}${inGroup}`, href: expenseHref, impact: null, deleted: true };
    case "expense_restored":
      return { kind: "expense", text: `${actor} restored ${desc}${inGroup}`, href: expenseHref, impact: expenseImpact(), deleted: false };
    case "settlement_created":
      return { kind: "payment", text: `${actor} recorded a payment: ${payment}${inGroup}`, href: settlementHref, impact: settlementImpact(), deleted: false };
    case "settlement_updated":
      return { kind: "payment", text: `${actor} updated a payment: ${payment}${inGroup}`, href: settlementHref, impact: settlementImpact(), deleted: false };
    case "settlement_deleted":
      return { kind: "payment", text: `${actor} deleted a payment: ${payment}${inGroup}`, href: settlementHref, impact: null, deleted: true };
    case "settlement_restored":
      return { kind: "payment", text: `${actor} restored a payment: ${payment}${inGroup}`, href: settlementHref, impact: settlementImpact(), deleted: false };
    case "comment_added":
      return {
        kind: "comment",
        text: `${actor} commented on ${p.subject ? `“${p.subject}”` : "an expense"}: “${p.body ?? ""}”`,
        href: expenseHref ?? settlementHref,
        impact: null,
        deleted: false,
      };
    case "comment_deleted":
      return { kind: "comment", text: `${actor} deleted a comment`, href: expenseHref ?? settlementHref, impact: null, deleted: true };
    case "group_created":
      return { kind: "group", text: `${actor} created the group “${p.name ?? item.groupName ?? ""}”`, href: groupHref, impact: null, deleted: false };
    case "group_updated":
      return { kind: "group", text: `${actor} updated the settings${inGroup}`, href: groupHref, impact: null, deleted: false };
    case "group_deleted":
      return { kind: "group", text: `${actor} deleted the group “${p.name ?? item.groupName ?? ""}”`, href: null, impact: null, deleted: true };
    case "member_added":
      return {
        kind: "member",
        text: p.via === "invite" ? `${actor} joined${inGroup}` : `${actor} added ${p.name ?? "someone"}${inGroup}`,
        href: groupHref,
        impact: null,
        deleted: false,
      };
    case "member_removed":
      return { kind: "member", text: `${actor} removed ${p.name ?? "someone"}${inGroup}`, href: groupHref, impact: null, deleted: false };
    case "member_left":
      return { kind: "member", text: `${actor} left${inGroup}`, href: groupHref, impact: null, deleted: false };
    case "placeholder_claimed":
      return { kind: "member", text: `${actor} joined as ${p.name ?? "a placeholder"}${inGroup}`, href: groupHref, impact: null, deleted: false };
    case "friend_requested":
      return { kind: "friend", text: `${actor} sent a friend request`, href: "/friends", impact: null, deleted: false };
    case "friend_accepted":
      return { kind: "friend", text: `${actor} accepted a friend request`, href: "/friends", impact: null, deleted: false };
    default:
      return { kind: "other", text: `${actor} made a change${inGroup}`, href: groupHref, impact: null, deleted: false };
  }
}
