import { z } from "zod";
import {
  swCommentSchema,
  swExpenseSchema,
  swFriendSchema,
  swGroupSchema,
  swUserSchema,
  tokenResponseSchema,
  type SwComment,
  type SwExpense,
  type SwFriend,
  type SwGroup,
  type SwUser,
} from "./schemas";

/** SPLITWISE_DEV_ORIGIN points at a local fake Splitwise for end-to-end tests; ignored in production builds. */
export const SPLITWISE_ORIGIN =
  (process.env.NODE_ENV !== "production" && process.env.SPLITWISE_DEV_ORIGIN) || "https://secure.splitwise.com";
const API = `${SPLITWISE_ORIGIN}/api/v3.0`;
const id = z.number().int();

/** Splitwise asked us to slow down and retries ran out; try again after `retryAfterSeconds`. */
export class SplitwiseRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Splitwise rate limit; retry after ${retryAfterSeconds}s`);
    this.name = "SplitwiseRateLimitError";
  }
}

/** The token was rejected (revoked or expired): the user has to reconnect. */
export class SplitwiseAuthError extends Error {
  constructor() {
    super("Splitwise authorization expired");
    this.name = "SplitwiseAuthError";
  }
}

export class SplitwiseApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SplitwiseApiError";
  }
}

export type Fetch = typeof fetch;
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type Token = { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scope: string | null };

// ------------------------------------------------------------------ OAuth 2.0

export function authorizeUrl({ clientId, redirectUri, state }: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(`${SPLITWISE_ORIGIN}/oauth/authorize`);
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state }).toString();
  return url.toString();
}

async function tokenRequest(body: Record<string, string>, fetchImpl: Fetch, now: Date): Promise<Token> {
  const res = await fetchImpl(`${SPLITWISE_ORIGIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  if (res.status === 400 || res.status === 401) throw new SplitwiseAuthError();
  if (!res.ok) throw new SplitwiseApiError(`Token request failed (${res.status})`, res.status);
  const data = tokenResponseSchema.parse(await res.json());
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    // Splitwise tokens normally don't expire; honor expires_in if it's ever sent.
    expiresAt: data.expires_in ? new Date(now.getTime() + data.expires_in * 1000) : null,
    scope: data.scope ?? null,
  };
}

export function exchangeCode(
  p: { clientId: string; clientSecret: string; redirectUri: string; code: string },
  fetchImpl: Fetch = fetch,
  now = new Date(),
): Promise<Token> {
  return tokenRequest(
    { grant_type: "authorization_code", code: p.code, client_id: p.clientId, client_secret: p.clientSecret, redirect_uri: p.redirectUri },
    fetchImpl,
    now,
  );
}

export async function refreshAccessToken(
  p: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: Fetch = fetch,
  now = new Date(),
): Promise<Token> {
  const token = await tokenRequest(
    { grant_type: "refresh_token", refresh_token: p.refreshToken, client_id: p.clientId, client_secret: p.clientSecret },
    fetchImpl,
    now,
  );
  // Some providers don't rotate refresh tokens: keep the old one.
  return { ...token, refreshToken: token.refreshToken ?? p.refreshToken };
}

// --------------------------------------------------------------------- client

export type ApiOptions = {
  fetch?: Fetch;
  sleep?: Sleep;
  /** Retries after a 429 or 5xx before giving up. */
  maxRetries?: number;
  /** Longest single wait we'll do inside a request; longer Retry-After values are surfaced to the caller. */
  maxWaitSeconds?: number;
  /** Called once on a 401 to get a fresh access token (refresh flow). Return null if there's none. */
  onUnauthorized?: () => Promise<string | null>;
};

export type CreateExpenseInput = {
  cost: string;
  description: string;
  currencyCode: string;
  groupId: number;
  date: string;
  details?: string;
  users: { userId: number; paidShare: string; owedShare: string }[];
};

/** Thin Splitwise API v3.0 client with 429 backoff (Retry-After aware) and one-shot token refresh. */
export class SplitwiseApi {
  private readonly fetchImpl: Fetch;
  private readonly sleep: Sleep;
  private readonly maxRetries: number;
  private readonly maxWaitSeconds: number;

  constructor(
    private accessToken: string,
    private readonly options: ApiOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? realSleep;
    this.maxRetries = options.maxRetries ?? 4;
    this.maxWaitSeconds = options.maxWaitSeconds ?? 20;
  }

  private async request(path: string, init: { method?: "GET" | "POST"; body?: URLSearchParams } = {}): Promise<unknown> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(`${API}/${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          accept: "application/json",
          ...(init.body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        body: init.body?.toString(),
        cache: "no-store",
      });

      if (res.status === 401) {
        const next = !refreshed && this.options.onUnauthorized ? await this.options.onUnauthorized() : null;
        if (!next) throw new SplitwiseAuthError();
        this.accessToken = next;
        refreshed = true;
        attempt--;
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        const header = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(header) && header > 0 ? header : 2 ** attempt;
        if (attempt >= this.maxRetries || wait > this.maxWaitSeconds) {
          if (res.status === 429) throw new SplitwiseRateLimitError(Math.ceil(wait));
          throw new SplitwiseApiError(`Splitwise is unavailable (${res.status})`, res.status);
        }
        await this.sleep(wait * 1000);
        continue;
      }

      if (!res.ok) throw new SplitwiseApiError(`Splitwise request failed (${res.status})`, res.status);
      return res.json();
    }
  }

  async getCurrentUser(): Promise<SwUser> {
    return z.object({ user: swUserSchema }).parse(await this.request("get_current_user")).user;
  }

  async getGroups(): Promise<SwGroup[]> {
    return z.object({ groups: z.array(swGroupSchema) }).parse(await this.request("get_groups")).groups;
  }

  async getGroup(groupId: number): Promise<SwGroup> {
    return z.object({ group: swGroupSchema }).parse(await this.request(`get_group/${groupId}`)).group;
  }

  async getFriends(): Promise<SwFriend[]> {
    return z.object({ friends: z.array(swFriendSchema) }).parse(await this.request("get_friends")).friends;
  }

  async getExpenses(params: { groupId?: number; friendId?: number; limit: number; offset: number }): Promise<SwExpense[]> {
    const q = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
    if (params.groupId !== undefined) q.set("group_id", String(params.groupId));
    if (params.friendId !== undefined) q.set("friend_id", String(params.friendId));
    return z.object({ expenses: z.array(swExpenseSchema) }).parse(await this.request(`get_expenses?${q}`)).expenses;
  }

  async getComments(expenseId: number): Promise<SwComment[]> {
    return z.object({ comments: z.array(swCommentSchema) }).parse(await this.request(`get_comments?expense_id=${expenseId}`))
      .comments;
  }

  /** Creates an expense with explicit paid/owed shares. Returns the new Splitwise expense id. */
  async createExpense(input: CreateExpenseInput): Promise<number> {
    const body = new URLSearchParams({
      cost: input.cost,
      description: input.description,
      currency_code: input.currencyCode,
      group_id: String(input.groupId),
      date: input.date,
    });
    if (input.details) body.set("details", input.details);
    input.users.forEach((u, i) => {
      body.set(`users__${i}__user_id`, String(u.userId));
      body.set(`users__${i}__paid_share`, u.paidShare);
      body.set(`users__${i}__owed_share`, u.owedShare);
    });
    const data = z
      .object({ expenses: z.array(z.looseObject({ id })).default([]), errors: z.unknown().optional() })
      .parse(await this.request("create_expense", { method: "POST", body }));
    const created = data.expenses[0];
    if (!created) throw new SplitwiseApiError(`Splitwise rejected the expense: ${describeErrors(data.errors)}`);
    return created.id;
  }
}

/** Splitwise returns validation errors as `{ errors: { base: ["..."], cost: ["..."] } }` (or an array/string). */
export function describeErrors(errors: unknown): string {
  const messages: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") messages.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(errors);
  return messages.join(" ") || "unknown error";
}
