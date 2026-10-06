import type { LedgerSettlement } from "@/lib/splits";
import { dbError, type DbClient, type Enums } from "./client";

const SETTLEMENT_COLUMNS = `id, group_id, from_member_id, from_user_id, to_member_id, to_user_id, amount_minor, currency,
  settled_on, method, external_provider, notes, created_by, created_at, is_deleted` as const;

export type ExternalProvider = "venmo" | "paypal" | "other";

export type SettlementSummary = {
  id: string;
  groupId: string | null;
  /** Participant ids: member ids in groups, user ids otherwise. */
  from: string;
  to: string;
  amount: number;
  currency: string;
  date: string;
  method: Enums<"settlement_method">;
  provider: ExternalProvider | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  isDeleted: boolean;
};

type SettlementRow = {
  id: string;
  group_id: string | null;
  from_member_id: string | null;
  from_user_id: string | null;
  to_member_id: string | null;
  to_user_id: string | null;
  amount_minor: number;
  currency: string;
  settled_on: string;
  method: Enums<"settlement_method">;
  external_provider: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  is_deleted: boolean;
};

function toSummary(r: SettlementRow): SettlementSummary {
  return {
    id: r.id,
    groupId: r.group_id,
    from: (r.from_member_id ?? r.from_user_id)!,
    to: (r.to_member_id ?? r.to_user_id)!,
    amount: r.amount_minor,
    currency: r.currency,
    date: r.settled_on,
    method: r.method,
    provider: r.external_provider as ExternalProvider | null,
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
    isDeleted: r.is_deleted,
  };
}

export function toLedgerSettlement(s: SettlementSummary): LedgerSettlement {
  return { kind: "settlement", currency: s.currency, from: s.from, to: s.to, amount: s.amount };
}

export async function listGroupSettlements(db: DbClient, groupId: string): Promise<SettlementSummary[]> {
  const { data, error } = await db
    .from("settlements")
    .select(SETTLEMENT_COLUMNS)
    .eq("group_id", groupId)
    .eq("is_deleted", false)
    .order("settled_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw dbError("Could not load payments", error);
  return data.map(toSummary);
}

/** Every non-deleted settlement visible to the user (RLS). */
export async function listVisibleSettlements(db: DbClient): Promise<SettlementSummary[]> {
  const { data, error } = await db
    .from("settlements")
    .select(SETTLEMENT_COLUMNS)
    .eq("is_deleted", false)
    .order("settled_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw dbError("Could not load payments", error);
  return data.map(toSummary);
}

export type SettlementHistoryEntry = {
  id: number;
  action: Enums<"activity_action">;
  actorId: string | null;
  createdAt: string;
};

export async function getSettlement(
  db: DbClient,
  settlementId: string,
): Promise<(SettlementSummary & { history: SettlementHistoryEntry[] }) | null> {
  const { data, error } = await db.from("settlements").select(SETTLEMENT_COLUMNS).eq("id", settlementId).maybeSingle();
  if (error) throw dbError("Could not load payment", error);
  if (!data) return null;
  const { data: activity, error: activityError } = await db
    .from("activity_log")
    .select("id, action, actor_id, created_at")
    .eq("settlement_id", settlementId)
    .in("action", ["settlement_created", "settlement_updated", "settlement_deleted", "settlement_restored"])
    .order("created_at", { ascending: false });
  if (activityError) throw dbError("Could not load history", activityError);
  return {
    ...toSummary(data),
    history: activity.map((a) => ({ id: a.id, action: a.action, actorId: a.actor_id, createdAt: a.created_at })),
  };
}

export type SaveSettlementInput = {
  settlementId?: string;
  groupId?: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  date: string;
  method: Enums<"settlement_method">;
  provider?: ExternalProvider;
  notes?: string;
};

export async function saveSettlement(db: DbClient, input: SaveSettlementInput): Promise<string> {
  const side = input.groupId ? "member_id" : "user_id";
  const { data, error } = await db.rpc("save_settlement", {
    p_settlement: {
      id: input.settlementId ?? null,
      group_id: input.groupId ?? null,
      [`from_${side}`]: input.from,
      [`to_${side}`]: input.to,
      amount_minor: input.amount,
      currency: input.currency,
      settled_on: input.date,
      method: input.method,
      external_provider: input.provider ?? null,
      notes: input.notes ?? null,
    },
  });
  if (error) throw dbError("Could not save payment", error);
  return data;
}

export async function setSettlementDeleted(db: DbClient, settlementId: string, deleted: boolean) {
  const { error } = await db.rpc("set_settlement_deleted", { p_settlement_id: settlementId, p_deleted: deleted });
  if (error) throw dbError(deleted ? "Could not delete payment" : "Could not restore payment", error);
}
