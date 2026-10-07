import { dbError, type DbClient } from "./client";

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
