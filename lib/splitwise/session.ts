import "server-only";
import { getStoredTokens, setSyncState, updateTokens } from "@/lib/db/splitwise";
import { splitwiseConfig, type SplitwiseConfig } from "@/lib/env.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAccessToken, SplitwiseApi, SplitwiseAuthError, type ApiOptions } from "./api";
import { decryptToken, encryptToken } from "./crypto";

export class SplitwiseNotConnectedError extends Error {
  constructor() {
    super("Splitwise is not connected");
    this.name = "SplitwiseNotConnectedError";
  }
}

/** Refresh this long before the stored expiry so a request never starts with a dying token. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * Splitwise client acting as `userId`, with stored tokens decrypted and refreshed when
 * they're about to expire (or rejected with a 401). Refreshed tokens are re-encrypted and saved.
 */
export async function splitwiseFor(userId: string, options: Omit<ApiOptions, "onUnauthorized"> = {}) {
  const config = splitwiseConfig();
  if (!config) throw new SplitwiseNotConnectedError();
  const admin = createAdminClient();
  const stored = await getStoredTokens(admin, userId);
  if (!stored) throw new SplitwiseNotConnectedError();

  let refreshToken = stored.refreshTokenEncrypted ? decryptToken(stored.refreshTokenEncrypted, config.tokenKey) : null;

  const refresh = async (): Promise<string | null> => {
    if (!refreshToken) return null;
    try {
      const token = await refreshAccessToken({ clientId: config.clientId, clientSecret: config.clientSecret, refreshToken });
      refreshToken = token.refreshToken;
      await updateTokens(admin, userId, encryptTokens(token, config));
      return token.accessToken;
    } catch (error) {
      if (error instanceof SplitwiseAuthError) return null;
      throw error;
    }
  };

  let accessToken = decryptToken(stored.accessTokenEncrypted, config.tokenKey);
  if (stored.tokenExpiresAt && new Date(stored.tokenExpiresAt).getTime() - REFRESH_MARGIN_MS < Date.now()) {
    const fresh = await refresh();
    if (fresh) accessToken = fresh;
  }

  const api = new SplitwiseApi(accessToken, {
    ...options,
    onUnauthorized: async () => {
      const fresh = await refresh();
      if (!fresh) await setSyncState(admin, userId, { status: "failed", error: "reconnect" });
      return fresh;
    },
  });
  return { api, splitwiseUserId: stored.splitwiseUserId, admin };
}

export function encryptTokens(
  token: { accessToken: string; refreshToken: string | null; expiresAt: Date | null },
  config: SplitwiseConfig,
) {
  return {
    accessTokenEncrypted: encryptToken(token.accessToken, config.tokenKey),
    refreshTokenEncrypted: token.refreshToken ? encryptToken(token.refreshToken, config.tokenKey) : null,
    tokenExpiresAt: token.expiresAt?.toISOString() ?? null,
  };
}
