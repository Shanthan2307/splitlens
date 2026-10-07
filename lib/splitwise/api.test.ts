import { describe, expect, it, vi } from "vitest";
import {
  authorizeUrl,
  describeErrors,
  exchangeCode,
  refreshAccessToken,
  SplitwiseApi,
  SplitwiseApiError,
  SplitwiseAuthError,
  SplitwiseRateLimitError,
  type Fetch,
} from "./api";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function fakeFetch(...responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  }) as unknown as Fetch;
  return { fn, calls };
}

const sleep = vi.fn(async () => {});

describe("OAuth", () => {
  it("builds the authorize URL", () => {
    const url = new URL(authorizeUrl({ clientId: "cid", redirectUri: "https://app.test/cb", state: "st" }));
    expect(url.origin + url.pathname).toBe("https://secure.splitwise.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: "code", client_id: "cid", redirect_uri: "https://app.test/cb", state: "st" });
  });

  it("exchanges a code (no expiry, as Splitwise issues)", async () => {
    const { fn, calls } = fakeFetch(json({ access_token: "at", token_type: "bearer" }));
    const token = await exchangeCode({ clientId: "c", clientSecret: "s", redirectUri: "r", code: "x" }, fn);
    expect(token).toEqual({ accessToken: "at", refreshToken: null, expiresAt: null, scope: null });
    expect(String(calls[0]!.init.body)).toContain("grant_type=authorization_code");
  });

  it("records expiry and refresh tokens when present", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { fn } = fakeFetch(json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "all" }));
    const token = await exchangeCode({ clientId: "c", clientSecret: "s", redirectUri: "r", code: "x" }, fn, now);
    expect(token.expiresAt?.toISOString()).toBe("2026-01-01T01:00:00.000Z");
    expect(token.refreshToken).toBe("rt");
    expect(token.scope).toBe("all");
  });

  it("refreshes, keeping the old refresh token when none is returned", async () => {
    const { fn, calls } = fakeFetch(json({ access_token: "new" }));
    const token = await refreshAccessToken({ clientId: "c", clientSecret: "s", refreshToken: "old" }, fn);
    expect(token.refreshToken).toBe("old");
    expect(String(calls[0]!.init.body)).toContain("grant_type=refresh_token");
  });

  it("maps token errors", async () => {
    await expect(exchangeCode({ clientId: "c", clientSecret: "s", redirectUri: "r", code: "x" }, fakeFetch(json({}, 401)).fn)).rejects.toBeInstanceOf(SplitwiseAuthError);
    await expect(exchangeCode({ clientId: "c", clientSecret: "s", redirectUri: "r", code: "x" }, fakeFetch(json({}, 503)).fn)).rejects.toBeInstanceOf(SplitwiseApiError);
  });
});

describe("SplitwiseApi", () => {
  it("sends the bearer token and parses responses", async () => {
    const { fn, calls } = fakeFetch(json({ user: { id: 7, first_name: "Ana", last_name: null, email: "a@x.test" } }));
    const me = await new SplitwiseApi("tok", { fetch: fn }).getCurrentUser();
    expect(me).toMatchObject({ id: 7, first_name: "Ana", last_name: "" });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("waits out a 429 using Retry-After, then succeeds", async () => {
    sleep.mockClear();
    const { fn } = fakeFetch(json({}, 429, { "retry-after": "3" }), json({ groups: [{ id: 1, name: "Trip", members: [] }] }));
    const groups = await new SplitwiseApi("t", { fetch: fn, sleep }).getGroups();
    expect(groups[0]!.name).toBe("Trip");
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("backs off exponentially on 5xx without Retry-After", async () => {
    sleep.mockClear();
    const { fn } = fakeFetch(json({}, 502), json({}, 503), json({ friends: [] }));
    await new SplitwiseApi("t", { fetch: fn, sleep }).getFriends();
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1000, 2000]);
  });

  it("surfaces long rate limits to the caller instead of blocking", async () => {
    const { fn } = fakeFetch(json({}, 429, { "retry-after": "120" }));
    const error = await new SplitwiseApi("t", { fetch: fn, sleep }).getGroup(1).catch((e) => e);
    expect(error).toBeInstanceOf(SplitwiseRateLimitError);
    expect(error.retryAfterSeconds).toBe(120);
  });

  it("gives up after maxRetries", async () => {
    const { fn } = fakeFetch(json({}, 429), json({}, 429));
    await expect(new SplitwiseApi("t", { fetch: fn, sleep, maxRetries: 1 }).getFriends()).rejects.toBeInstanceOf(SplitwiseRateLimitError);
    const { fn: down } = fakeFetch(json({}, 500), json({}, 500));
    await expect(new SplitwiseApi("t", { fetch: down, sleep, maxRetries: 1 }).getFriends()).rejects.toBeInstanceOf(SplitwiseApiError);
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    const { fn, calls } = fakeFetch(json({}, 401), json({ comments: [] }));
    const onUnauthorized = vi.fn(async () => "fresh");
    await new SplitwiseApi("old", { fetch: fn, onUnauthorized }).getComments(5);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe("Bearer fresh");
    expect(calls[1]!.url).toContain("get_comments?expense_id=5");
  });

  it("throws an auth error when there's no way to refresh", async () => {
    await expect(new SplitwiseApi("t", { fetch: fakeFetch(json({}, 401)).fn }).getFriends()).rejects.toBeInstanceOf(SplitwiseAuthError);
    const { fn } = fakeFetch(json({}, 401), json({}, 401));
    await expect(new SplitwiseApi("t", { fetch: fn, onUnauthorized: async () => "x" }).getFriends()).rejects.toBeInstanceOf(SplitwiseAuthError);
  });

  it("throws on other HTTP errors", async () => {
    await expect(new SplitwiseApi("t", { fetch: fakeFetch(json({}, 404)).fn }).getGroup(9)).rejects.toThrow(/404/);
  });

  it("lists expenses with filters", async () => {
    const { fn, calls } = fakeFetch(json({ expenses: [] }), json({ expenses: [] }));
    const api = new SplitwiseApi("t", { fetch: fn });
    await api.getExpenses({ groupId: 3, limit: 50, offset: 100 });
    await api.getExpenses({ friendId: 4, limit: 10, offset: 0 });
    expect(calls[0]!.url).toContain("get_expenses?limit=50&offset=100&group_id=3");
    expect(calls[1]!.url).toContain("friend_id=4");
  });

  it("creates expenses with per-user shares", async () => {
    const { fn, calls } = fakeFetch(json({ expenses: [{ id: 99 }], errors: {} }));
    const id = await new SplitwiseApi("t", { fetch: fn }).createExpense({
      cost: "10.00",
      description: "Lunch",
      currencyCode: "USD",
      groupId: 0,
      date: "2026-10-07",
      details: "notes",
      users: [
        { userId: 1, paidShare: "10.00", owedShare: "5.00" },
        { userId: 2, paidShare: "0.00", owedShare: "5.00" },
      ],
    });
    expect(id).toBe(99);
    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(calls[0]!.init.method).toBe("POST");
    expect(body.get("users__1__owed_share")).toBe("5.00");
    expect(body.get("details")).toBe("notes");
  });

  it("reports Splitwise validation errors", async () => {
    const { fn } = fakeFetch(json({ expenses: [], errors: { base: ["Cost is invalid"] } }));
    await expect(
      new SplitwiseApi("t", { fetch: fn }).createExpense({ cost: "x", description: "d", currencyCode: "USD", groupId: 0, date: "2026-10-07", users: [] }),
    ).rejects.toThrow(/Cost is invalid/);
  });
});

describe("describeErrors", () => {
  it("flattens any shape", () => {
    expect(describeErrors({ a: ["x", { b: "y" }] })).toBe("x y");
    expect(describeErrors("z")).toBe("z");
    expect(describeErrors(null)).toBe("unknown error");
  });
});
