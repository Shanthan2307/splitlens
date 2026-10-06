import type { BuiltExpense, LedgerEntry, StoredExpense } from "@/lib/splits";
import { DbError, dbError, type DbClient, type Enums, type Json } from "./client";

const EXPENSE_COLUMNS = `id, group_id, description, category, expense_date, currency, total_minor, split_type, notes,
  created_by, created_at, updated_at, is_deleted, receipt_id,
  expense_payers(member_id, user_id, paid_minor),
  expense_shares(member_id, user_id, owed_minor, split_input)` as const;

export type ExpenseSummary = {
  id: string;
  groupId: string | null;
  description: string;
  category: string;
  date: string;
  currency: string;
  total: number;
  splitType: Enums<"split_type">;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  isDeleted: boolean;
  receiptId: string | null;
  /** Participant ids are member ids for group expenses, user ids otherwise. */
  payers: { participantId: string; amount: number }[];
  shares: { participantId: string; amount: number; splitInput: number | null }[];
};

type ExpenseRow = {
  id: string;
  group_id: string | null;
  description: string;
  category: string;
  expense_date: string;
  currency: string;
  total_minor: number;
  split_type: Enums<"split_type">;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  is_deleted: boolean;
  receipt_id: string | null;
  expense_payers: { member_id: string | null; user_id: string | null; paid_minor: number }[];
  expense_shares: { member_id: string | null; user_id: string | null; owed_minor: number; split_input: number | null }[];
};

function toSummary(row: ExpenseRow): ExpenseSummary {
  return {
    id: row.id,
    groupId: row.group_id,
    description: row.description,
    category: row.category,
    date: row.expense_date,
    currency: row.currency,
    total: row.total_minor,
    splitType: row.split_type,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    isDeleted: row.is_deleted,
    receiptId: row.receipt_id,
    payers: row.expense_payers.map((p) => ({ participantId: (p.member_id ?? p.user_id)!, amount: p.paid_minor })),
    shares: row.expense_shares.map((s) => ({
      participantId: (s.member_id ?? s.user_id)!,
      amount: s.owed_minor,
      splitInput: s.split_input,
    })),
  };
}

export function toLedgerEntry(e: ExpenseSummary): LedgerEntry {
  return { kind: "expense", currency: e.currency, payers: e.payers, shares: e.shares };
}

export async function listGroupExpenses(db: DbClient, groupId: string): Promise<ExpenseSummary[]> {
  const { data, error } = await db
    .from("expenses")
    .select(EXPENSE_COLUMNS)
    .eq("group_id", groupId)
    .eq("is_deleted", false)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw dbError("Could not load expenses", error);
  return (data as ExpenseRow[]).map(toSummary);
}

/** Every non-deleted expense the user can see (RLS): current groups + friend-only. */
export async function listVisibleExpenses(db: DbClient): Promise<ExpenseSummary[]> {
  const { data, error } = await db
    .from("expenses")
    .select(EXPENSE_COLUMNS)
    .eq("is_deleted", false)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw dbError("Could not load expenses", error);
  return (data as ExpenseRow[]).map(toSummary);
}

export type ExpenseItem = {
  id: string;
  kind: Enums<"expense_item_kind">;
  name: string;
  originalName: string | null;
  quantity: number;
  unitPrice: number | null;
  amount: number;
  assignments: { participantId: string; weight: number }[];
};

export type Attachment = { id: string; fileName: string; mimeType: string; sizeBytes: number; url: string | null; uploadedBy: string | null };

export type HistoryEntry = {
  id: number;
  action: Enums<"activity_action">;
  actorId: string | null;
  createdAt: string;
  before: ExpenseSnapshot | null;
  after: ExpenseSnapshot | null;
};

export type ExpenseSnapshot = {
  description: string;
  category: string;
  expense_date: string;
  currency: string;
  total_minor: number;
  split_type: string;
  notes: string | null;
  payers: { participant_id: string; name: string | null; amount: number }[];
  shares: { participant_id: string; name: string | null; amount: number }[];
};

export type ExpenseDetail = ExpenseSummary & {
  items: ExpenseItem[];
  attachments: Attachment[];
  history: HistoryEntry[];
  deletedAt: string | null;
};

export async function getExpense(db: DbClient, expenseId: string): Promise<ExpenseDetail | null> {
  const { data, error } = await db
    .from("expenses")
    .select(
      `${EXPENSE_COLUMNS}, deleted_at,
       expense_items(id, position, kind, name, original_name, quantity, unit_price_minor, total_minor, item_assignments(member_id, user_id, share_weight)),
       attachments(id, file_name, mime_type, size_bytes, storage_path, uploaded_by, created_at)`,
    )
    .eq("id", expenseId)
    .maybeSingle();
  if (error) throw dbError("Could not load expense", error);
  if (!data) return null;

  const { data: activity, error: activityError } = await db
    .from("activity_log")
    .select("id, action, actor_id, created_at, payload")
    .eq("expense_id", expenseId)
    .order("created_at", { ascending: false });
  if (activityError) throw dbError("Could not load history", activityError);

  const files = [...data.attachments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const signed = files.length
    ? await db.storage.from("attachments").createSignedUrls(files.map((f) => f.storage_path), 60 * 60)
    : { data: [], error: null };
  if (signed.error) throw new DbError("Could not sign attachment URLs", signed.error);

  return {
    ...toSummary(data as unknown as ExpenseRow),
    deletedAt: data.deleted_at,
    items: [...data.expense_items]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        name: i.name,
        originalName: i.original_name,
        quantity: i.quantity,
        unitPrice: i.unit_price_minor,
        amount: i.total_minor,
        assignments: i.item_assignments.map((a) => ({ participantId: (a.member_id ?? a.user_id)!, weight: a.share_weight })),
      })),
    attachments: files.map((f, i) => ({
      id: f.id,
      fileName: f.file_name,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      url: signed.data[i]?.signedUrl ?? null,
      uploadedBy: f.uploaded_by,
    })),
    history: activity.map((a) => {
      const payload = a.payload as { before?: ExpenseSnapshot | null; after?: ExpenseSnapshot | null };
      return {
        id: a.id,
        action: a.action,
        actorId: a.actor_id,
        createdAt: a.created_at,
        before: payload.before ?? null,
        after: payload.after ?? null,
      };
    }),
  };
}

export function toStoredExpense(e: ExpenseDetail): StoredExpense {
  return {
    currency: e.currency,
    total: e.total,
    splitType: e.splitType,
    payers: e.payers,
    shares: e.shares,
    items: e.items.map((i) => ({
      kind: i.kind,
      name: i.name,
      ...(i.originalName ? { originalName: i.originalName } : {}),
      // Quantity is only meaningful for items; "1" is the default and not worth showing.
      ...(i.kind === "item" && i.quantity !== 1 ? { quantity: String(i.quantity) } : {}),
      ...(i.unitPrice !== null ? { unitPrice: i.unitPrice } : {}),
      amount: i.amount,
      assignments: i.assignments,
    })),
  };
}

export type SaveExpenseMeta = {
  expenseId?: string;
  groupId?: string;
  description: string;
  category: string;
  date: string;
  currency: string;
  notes?: string;
  receiptId?: string;
  splitType: Enums<"split_type">;
};

/** Writes the expense with payers, shares and items atomically via the save_expense RPC. */
export async function saveExpense(db: DbClient, meta: SaveExpenseMeta, built: BuiltExpense): Promise<string> {
  const key = meta.groupId ? "member_id" : "user_id";
  const payload = {
    id: meta.expenseId ?? null,
    group_id: meta.groupId ?? null,
    description: meta.description,
    category: meta.category,
    expense_date: meta.date,
    currency: meta.currency,
    total_minor: built.total,
    split_type: meta.splitType,
    notes: meta.notes ?? null,
    receipt_id: meta.receiptId ?? null,
    payers: built.payers.map((p) => ({ [key]: p.participantId, amount: p.amount })),
    shares: built.shares.map((s) => ({ [key]: s.participantId, amount: s.amount, split_input: s.splitInput })),
    items: built.items.map((i) => ({
      kind: i.kind,
      name: i.name,
      original_name: i.originalName ?? null,
      quantity: i.quantity ?? null,
      unit_price_minor: i.unitPrice ?? null,
      amount: i.amount,
      assignments: i.assignments.map((a) => ({ [key]: a.participantId, weight: a.weight })),
    })),
  } satisfies Json;
  const { data, error } = await db.rpc("save_expense", { p_expense: payload });
  if (error) throw dbError("Could not save expense", error);
  return data;
}

export async function setExpenseDeleted(db: DbClient, expenseId: string, deleted: boolean) {
  const { error } = await db.rpc("set_expense_deleted", { p_expense_id: expenseId, p_deleted: deleted });
  if (error) throw dbError(deleted ? "Could not delete expense" : "Could not restore expense", error);
}
