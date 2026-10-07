import { dbError, type DbClient, type Json } from "./client";

/**
 * Splitwise data layer. Functions taking `admin` need the service-role client: token
 * columns are invisible to users, and the import RPCs are service-role only (they trust
 * data the server fetched from Splitwise with the user's own token).
 */

export type ConnectionStatus = {
  splitwiseUserId: number;
  syncStatus: "idle" | "running" | "succeeded" | "failed";
  syncError: string | null;
  lastSyncedAt: string | null;
};

/** The signed-in user's connection status (user client; RLS + column grants hide tokens). */
export async function getConnectionStatus(db: DbClient, userId: string): Promise<ConnectionStatus | null> {
  const { data, error } = await db
    .from("splitwise_connections")
    .select("splitwise_user_id, sync_status, sync_error, last_synced_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError("Could not load Splitwise connection", error);
  if (!data) return null;
  return {
    splitwiseUserId: data.splitwise_user_id,
    syncStatus: data.sync_status,
    syncError: data.sync_error,
    lastSyncedAt: data.last_synced_at,
  };
}

export type StoredTokens = {
  splitwiseUserId: number;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: string | null;
};

export async function getStoredTokens(admin: DbClient, userId: string): Promise<StoredTokens | null> {
  const { data, error } = await admin
    .from("splitwise_connections")
    .select("splitwise_user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError("Could not load Splitwise tokens", error);
  if (!data) return null;
  return {
    splitwiseUserId: data.splitwise_user_id,
    accessTokenEncrypted: data.access_token_encrypted,
    refreshTokenEncrypted: data.refresh_token_encrypted,
    tokenExpiresAt: data.token_expires_at,
  };
}

export async function saveConnection(
  admin: DbClient,
  row: {
    userId: string;
    splitwiseUserId: number;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string | null;
    tokenExpiresAt: string | null;
    scope: string | null;
  },
) {
  const { error } = await admin.from("splitwise_connections").upsert({
    user_id: row.userId,
    splitwise_user_id: row.splitwiseUserId,
    access_token_encrypted: row.accessTokenEncrypted,
    refresh_token_encrypted: row.refreshTokenEncrypted,
    token_expires_at: row.tokenExpiresAt,
    scope: row.scope,
    sync_status: "idle",
    sync_error: null,
  });
  if (error) throw dbError("Could not save Splitwise connection", error);
}

export async function updateTokens(
  admin: DbClient,
  userId: string,
  t: { accessTokenEncrypted: string; refreshTokenEncrypted: string | null; tokenExpiresAt: string | null },
) {
  const { error } = await admin
    .from("splitwise_connections")
    .update({ access_token_encrypted: t.accessTokenEncrypted, refresh_token_encrypted: t.refreshTokenEncrypted, token_expires_at: t.tokenExpiresAt })
    .eq("user_id", userId);
  if (error) throw dbError("Could not update Splitwise tokens", error);
}

export async function setSyncState(
  admin: DbClient,
  userId: string,
  state: { status: "idle" | "running" | "succeeded" | "failed"; error?: string | null; synced?: boolean },
) {
  const { error } = await admin
    .from("splitwise_connections")
    .update({
      sync_status: state.status,
      sync_error: state.error ?? null,
      ...(state.synced ? { last_synced_at: new Date().toISOString() } : {}),
    })
    .eq("user_id", userId);
  if (error) throw dbError("Could not update Splitwise sync state", error);
}

/** Records the verified Splitwise identity and claims placeholders imported for it. */
export async function linkSplitwiseAccount(admin: DbClient, userId: string, splitwiseUserId: number): Promise<number> {
  const { data, error } = await admin.rpc("splitwise_link_account", { p_user: userId, p_splitwise_user_id: splitwiseUserId });
  if (error) throw dbError("Could not link Splitwise account", error);
  return data;
}

export async function unlinkSplitwiseAccount(admin: DbClient, userId: string) {
  const { error } = await admin.rpc("splitwise_unlink_account", { p_user: userId });
  if (error) throw dbError("Could not disconnect Splitwise", error);
}

// ------------------------------------------------------------------- import

/**
 * Which Splitwise people already have SplitLens accounts (by verified Splitwise id or email).
 * Admin lookup that returns only booleans keyed by Splitwise id, never profile data.
 */
export async function registeredSplitwisePeople(
  admin: DbClient,
  people: readonly { splitwise_user_id: number; email: string | null }[],
): Promise<Set<number>> {
  const ids = people.map((p) => p.splitwise_user_id);
  const emails = [...new Set(people.flatMap((p) => (p.email ? [p.email.toLowerCase()] : [])))];
  const [byId, byEmail] = await Promise.all([
    ids.length ? admin.from("profiles").select("splitwise_user_id").in("splitwise_user_id", ids) : { data: [], error: null },
    emails.length ? admin.from("profiles").select("email").in("email", emails) : { data: [], error: null },
  ]);
  if (byId.error) throw dbError("Could not match Splitwise people", byId.error);
  if (byEmail.error) throw dbError("Could not match Splitwise people", byEmail.error);
  const linked = new Set(byId.data.map((r) => Number(r.splitwise_user_id)));
  const registeredEmails = new Set(byEmail.data.map((r) => r.email?.toLowerCase()));
  return new Set(
    people.filter((p) => linked.has(p.splitwise_user_id) || (p.email && registeredEmails.has(p.email.toLowerCase()))).map((p) => p.splitwise_user_id),
  );
}

/** SplitLens group ids for Splitwise groups the user is already a member of (user client: RLS). */
export async function importedGroups(db: DbClient, splitwiseGroupIds: readonly number[]): Promise<Map<number, string>> {
  if (splitwiseGroupIds.length === 0) return new Map();
  const { data, error } = await db
    .from("groups")
    .select("id, splitwise_group_id")
    .in("splitwise_group_id", [...splitwiseGroupIds])
    .is("deleted_at", null);
  if (error) throw dbError("Could not load imported groups", error);
  return new Map(data.map((g) => [Number(g.splitwise_group_id), g.id]));
}

export type ImportedGroup = { groupId: string; created: boolean; members: { splitwiseUserId: number; memberId: string; registered: boolean }[] };

export async function importGroup(admin: DbClient, userId: string, payload: Json): Promise<ImportedGroup> {
  const { data, error } = await admin.rpc("splitwise_import_group", { p_user: userId, p_group: payload });
  if (error) throw dbError("Could not import group", error);
  const d = data as { group_id: string; created: boolean; members: { splitwise_user_id: number; member_id: string; registered: boolean }[] };
  return {
    groupId: d.group_id,
    created: d.created,
    members: d.members.map((m) => ({ splitwiseUserId: Number(m.splitwise_user_id), memberId: m.member_id, registered: m.registered })),
  };
}

export type ImportCounts = {
  created: number;
  payments: number;
  existing: number;
  deleted: number;
  skipped: number;
  comments: number;
  unresolved: number[];
};

export async function importExpenses(
  admin: DbClient,
  userId: string,
  groupId: string | null,
  people: Json,
  expenses: Json,
): Promise<ImportCounts> {
  const { data, error } = await admin.rpc("splitwise_import_expenses", {
    p_user: userId,
    // null = friend-only expenses (generated types don't mark uuid args nullable).
    p_group_id: groupId as string,
    p_people: people,
    p_expenses: expenses,
  });
  if (error) throw dbError("Could not import expenses", error);
  const d = data as Omit<ImportCounts, "unresolved"> & { unresolved: (number | string)[] };
  return { ...d, unresolved: d.unresolved.map(Number) };
}

export async function logImport(admin: DbClient, userId: string, groupId: string | null, summary: Json) {
  const { error } = await admin.rpc("splitwise_log_import", { p_user: userId, p_group_id: groupId as string, p_summary: summary });
  if (error) throw dbError("Could not record import", error);
}

// --------------------------------------------------------------------- post

export type SplitwiseTargets = { splitwiseGroupId: number | null; participants: Record<string, number> };

/** Splitwise ids for a group's members, or for the user and their friends (friend-only expenses). */
export async function splitwiseParticipants(
  db: DbClient,
  scope: { groupId: string } | { userIds: string[] },
): Promise<SplitwiseTargets> {
  const { data, error } = await db.rpc("splitwise_participants", {
    p_group_id: ("groupId" in scope ? scope.groupId : null) as string,
    p_user_ids: "userIds" in scope ? scope.userIds : [],
  });
  if (error) throw dbError("Could not load Splitwise participants", error);
  const d = data as { splitwise_group_id: number | null; participants: Record<string, number | string> };
  return {
    splitwiseGroupId: d.splitwise_group_id === null ? null : Number(d.splitwise_group_id),
    participants: Object.fromEntries(Object.entries(d.participants).map(([k, v]) => [k, Number(v)])),
  };
}

/** What the expense form needs to offer "Also post to Splitwise", or undefined when it can't apply. */
export async function postTargets(
  db: DbClient,
  userId: string,
  scope: { groupId: string } | { userIds: string[] },
): Promise<SplitwiseTargets | undefined> {
  const connection = await getConnectionStatus(db, userId);
  if (!connection || connection.syncError === "reconnect") return undefined;
  const targets = await splitwiseParticipants(db, scope);
  return targets.splitwiseGroupId === null ? undefined : targets;
}

export async function setSplitwiseExpenseId(admin: DbClient, userId: string, expenseId: string, splitwiseExpenseId: number) {
  const { error } = await admin.rpc("splitwise_set_expense_id", {
    p_user: userId,
    p_expense_id: expenseId,
    p_splitwise_expense_id: splitwiseExpenseId,
  });
  if (error) throw dbError("Could not link the Splitwise expense", error);
}
