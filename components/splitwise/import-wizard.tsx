"use client";

import { CheckCircle2, Clock, Loader2, RefreshCw, Send, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createInviteAction } from "@/app/(app)/groups/actions";
import {
  finishImportAction,
  friendInviteLinkAction,
  importGroupAction,
  importPageAction,
  loadOverviewAction,
} from "@/app/(app)/import/splitwise/actions";
import { BalanceList } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Overview, OverviewFriend, OverviewGroup } from "@/lib/splitwise/importer";
import { cn } from "@/lib/utils";
import { shareLink } from "./share";

type Key = `g${number}` | `f${number}`;
type Totals = { created: number; payments: number; existing: number; comments: number; skipped: number; unresolved: number };
type ItemState =
  | { state: "queued" }
  | { state: "running"; phase: string; totals: Totals }
  | { state: "done"; totals: Totals; groupId: string | null; missing: number }
  | { state: "error"; error: string; totals: Totals };

const ZERO: Totals = { created: 0, payments: 0, existing: 0, comments: 0, skipped: 0, unresolved: 0 };

type ActionOutcome<T> = ({ ok: true } & T) | { ok: true; rateLimited: true; retryAfter: number } | { ok: false; error: string };

export function ImportWizard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const [history, setHistory] = useState(true);
  const [comments, setComments] = useState(true);
  const [items, setItems] = useState<Map<Key, ItemState>>(new Map());
  const [running, setRunning] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const cancelled = useRef(false);

  // ----- rate limits: wait (with a visible countdown) and repeat the same call
  const withRetry = useCallback(async <T,>(call: () => Promise<ActionOutcome<T>>): Promise<({ ok: true } & T) | { ok: false; error: string }> => {
    for (;;) {
      const result = await call();
      if (result.ok && "rateLimited" in result) {
        const until = Date.now() + Math.min(result.retryAfter, 300) * 1000;
        setWaitUntil(until);
        while (Date.now() < until && !cancelled.current) {
          await new Promise((r) => setTimeout(r, 500));
          setNow(Date.now());
        }
        setWaitUntil(null);
        if (cancelled.current) return { ok: false, error: "Stopped" };
        continue;
      }
      return result as ({ ok: true } & T) | { ok: false; error: string };
    }
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await withRetry(() => loadOverviewAction());
      if (result.ok) setOverview(result.overview);
      else setLoadError(result.error);
    } catch {
      setLoadError("Could not reach SplitLens. Check your connection.");
    }
  }, [withRetry]);

  useEffect(() => {
    cancelled.current = false;
    void load();
    return () => {
      cancelled.current = true;
    };
  }, [load]);

  // Leaving mid-import is safe (re-running continues), but warn anyway.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const setItem = (key: Key, state: ItemState) => setItems((prev) => new Map(prev).set(key, state));

  const runOne = async (key: Key) => {
    const isGroup = key.startsWith("g");
    const id = Number(key.slice(1));
    const name = isGroup
      ? (overview?.groups.find((g) => g.splitwiseGroupId === id)?.name ?? "Group")
      : (overview?.friends.find((f) => f.splitwiseUserId === id)?.name ?? "Friend");
    let totals = { ...ZERO };
    let groupId: string | null = null;
    let missing = 0;
    try {
      if (isGroup) {
        setItem(key, { state: "running", phase: "Adding members…", totals });
        const g = await withRetry(() => importGroupAction({ splitwiseGroupId: id }));
        if (!g.ok) return setItem(key, { state: "error", error: g.error, totals });
        groupId = g.groupId;
        missing = g.missing;
      }
      if (history) {
        let offset: number | null = 0;
        while (offset !== null) {
          setItem(key, { state: "running", phase: offset === 0 ? "Fetching expenses…" : "Importing…", totals });
          const target = isGroup ? { kind: "group" as const, splitwiseGroupId: id } : { kind: "friend" as const, splitwiseFriendId: id };
          const currentOffset: number = offset;
          const page = await withRetry(() => importPageAction({ target, offset: currentOffset, includeComments: comments }));
          if (!page.ok) {
            await finishImportAction({ splitwiseGroupId: isGroup ? id : null, name, counts: totals, failed: true });
            return setItem(key, { state: "error", error: page.error, totals });
          }
          const c = page.counts;
          totals = {
            created: totals.created + c.created,
            payments: totals.payments + c.payments,
            existing: totals.existing + c.existing,
            comments: totals.comments + c.comments,
            skipped: totals.skipped + c.skipped + c.invalid,
            unresolved: totals.unresolved + c.unresolved.length,
          };
          offset = page.nextOffset;
        }
      }
      await finishImportAction({ splitwiseGroupId: isGroup ? id : null, name, counts: totals, failed: false });
      setItem(key, { state: "done", totals, groupId, missing });
    } catch {
      setItem(key, { state: "error", error: "Connection lost. Retry to continue where it stopped.", totals });
    }
  };

  const start = async (keys: Key[]) => {
    setRunning(true);
    setItems((prev) => {
      const next = new Map(prev);
      keys.forEach((k) => next.set(k, { state: "queued" }));
      return next;
    });
    for (const key of keys) {
      if (cancelled.current) break;
      await runOne(key);
    }
    setRunning(false);
  };

  const groups = overview?.groups ?? [];
  const friends = overview?.friends ?? [];
  const importable = useMemo(
    () => new Set((overview?.friends ?? []).filter((f) => f.onSplitLens).map((f) => f.splitwiseUserId)),
    [overview],
  );
  const toggle = (key: Key, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  if (loadError) {
    return (
      <div role="alert" className="space-y-3 rounded-lg border p-4">
        <p className="text-sm">{loadError}</p>
        {loadError.includes("reconnect") ? (
          <Button asChild>
            <a href="/api/splitwise/connect">Reconnect Splitwise</a>
          </Button>
        ) : (
          <Button variant="outline" onClick={load}>
            <RefreshCw /> Try again
          </Button>
        )}
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading your Splitwise account">
        {waitUntil && <RateLimitNotice seconds={Math.ceil((waitUntil - now) / 1000)} />}
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  const progress = [...items.values()];
  const finished = progress.filter((s) => s.state === "done" || s.state === "error").length;

  return (
    <div className="space-y-5">
      {items.size > 0 && (
        <section aria-label="Import progress" className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{running ? "Importing…" : "Import finished"}</span>
            <span className="text-muted-foreground tabular-nums">
              {finished} / {items.size}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={items.size} aria-valuenow={finished}>
            <div className="h-full bg-primary transition-all" style={{ width: `${(finished / items.size) * 100}%` }} />
          </div>
          {waitUntil && <RateLimitNotice seconds={Math.ceil((waitUntil - now) / 1000)} />}
          <ul className="divide-y">
            {[...items.entries()].map(([key, s]) => (
              <ProgressRow
                key={key}
                name={
                  key.startsWith("g")
                    ? (groups.find((g) => `g${g.splitwiseGroupId}` === key)?.name ?? "Group")
                    : (friends.find((f) => `f${f.splitwiseUserId}` === key)?.name ?? "Friend")
                }
                isFriend={key.startsWith("f")}
                state={s}
                onRetry={running ? undefined : () => void start([key])}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="sw-history" className="flex-col items-start gap-0.5">
            <span>Expense history</span>
            <span className="text-xs font-normal text-muted-foreground">Every expense and payment, so balances match Splitwise.</span>
          </Label>
          <Switch id="sw-history" checked={history} onCheckedChange={setHistory} disabled={running} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="sw-comments" className="flex-col items-start gap-0.5">
            <span>Comments</span>
            <span className="text-xs font-normal text-muted-foreground">Slower: one extra request per commented expense.</span>
          </Label>
          <Switch id="sw-comments" checked={history && comments} onCheckedChange={setComments} disabled={running || !history} />
        </div>
      </section>

      <Tabs defaultValue="groups">
        <TabsList className="w-full">
          <TabsTrigger value="groups">Groups ({groups.length})</TabsTrigger>
          <TabsTrigger value="friends">Friends ({friends.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="groups" className="mt-3 space-y-2">
          {groups.length === 0 && <p className="text-sm text-muted-foreground">No Splitwise groups.</p>}
          {groups.map((g) => (
            <GroupRow key={g.splitwiseGroupId} group={g} checked={selected.has(`g${g.splitwiseGroupId}`)} disabled={running} onChange={(on) => toggle(`g${g.splitwiseGroupId}`, on)} />
          ))}
        </TabsContent>
        <TabsContent value="friends" className="mt-3 space-y-2">
          {friends.length === 0 && <p className="text-sm text-muted-foreground">No Splitwise friends.</p>}
          {friends.map((f) => (
            <FriendRow
              key={f.splitwiseUserId}
              friend={f}
              checked={selected.has(`f${f.splitwiseUserId}`)}
              disabled={running || !importable.has(f.splitwiseUserId)}
              onChange={(on) => toggle(`f${f.splitwiseUserId}`, on)}
            />
          ))}
        </TabsContent>
      </Tabs>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 md:bottom-4">
        <Button
          size="lg"
          className="w-full shadow-lg"
          disabled={running || selected.size === 0}
          onClick={() => {
            const keys = [...selected];
            setSelected(new Set());
            void start(keys);
          }}
        >
          {running ? <Loader2 className="animate-spin" /> : null}
          {running ? "Importing…" : selected.size === 0 ? "Choose groups or friends to import" : `Import ${selected.size} selected`}
        </Button>
      </div>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function RateLimitNotice({ seconds }: { seconds: number }) {
  return (
    <p role="status" className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <Clock className="size-4 shrink-0" aria-hidden />
      Splitwise asked us to slow down. Resuming in {Math.max(seconds, 0)}s. Nothing is lost.
    </p>
  );
}

function OnSplitLens({ people }: { people: OverviewGroup["members"] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {people.map((p) => (
        <li
          key={p.splitwiseUserId}
          className={cn(
            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
            p.onSplitLens ? "border-emerald-200 text-emerald-800 dark:border-emerald-900 dark:text-emerald-300" : "border-dashed text-muted-foreground",
          )}
        >
          {p.onSplitLens ? <CheckCircle2 className="size-3" aria-hidden /> : <Clock className="size-3" aria-hidden />}
          {p.isMe ? "You" : p.name}
          <span className="sr-only">{p.onSplitLens ? " (on SplitLens)" : " (not on SplitLens yet)"}</span>
        </li>
      ))}
    </ul>
  );
}

function GroupRow({ group, checked, disabled, onChange }: { group: OverviewGroup; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const others = group.members.filter((m) => !m.isMe);
  const missing = others.filter((m) => !m.onSplitLens);
  return (
    <Label className={cn("flex items-start gap-3 rounded-lg border p-3 font-normal", checked && "border-primary bg-accent/40")}>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} className="mt-1" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{group.name}</span>
          {group.importedGroupId && <Badge variant="secondary">Imported · re-run to sync</Badge>}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {missing.length === 0
            ? "Everyone is on SplitLens. All expenses can be imported."
            : `${others.length - missing.length} of ${others.length} on SplitLens. The rest join as placeholders. Invite them after importing.`}
        </span>
        <OnSplitLens people={group.members} />
      </span>
    </Label>
  );
}

function FriendRow({ friend, checked, disabled, onChange }: { friend: OverviewFriend; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const balances = Object.fromEntries(friend.balances.map((b) => [b.currency, b.amount]));
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border p-3", checked && "border-primary bg-accent/40")}>
      <Checkbox
        id={`friend-${friend.splitwiseUserId}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-1"
        aria-describedby={`friend-${friend.splitwiseUserId}-status`}
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={`friend-${friend.splitwiseUserId}`} className="font-medium">
          {friend.name}
        </label>
        <BalanceList balances={balances} positive="owes you" negative="you owe" zero="settled up outside groups" className="text-xs" />
        <p id={`friend-${friend.splitwiseUserId}-status`} className="mt-1 text-xs text-muted-foreground">
          {friend.onSplitLens
            ? "On SplitLens. Imports your expenses outside groups."
            : "Not on SplitLens yet. Invite them; once they join, come back to import your balance."}
        </p>
      </div>
      {!friend.onSplitLens && <InviteButton compact label={`Invite ${friend.name}`} getUrl={friendInviteLinkAction} name={friend.name} />}
    </div>
  );
}

function InviteButton({
  label,
  name,
  getUrl,
  variant = "outline",
  compact = false,
}: {
  label: string;
  compact?: boolean;
  name: string;
  getUrl: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  variant?: "outline" | "default";
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      variant={variant}
      aria-label={label}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const result = await getUrl();
          if (result.ok) await shareLink(result.url, "Join me on SplitLens", `Hi ${name}, I'm moving our shared expenses to SplitLens. Join here:`);
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Send />}
      {compact ? <span className="max-sm:sr-only">Invite</span> : label}
    </Button>
  );
}

function ProgressRow({ name, isFriend, state, onRetry }: { name: string; isFriend: boolean; state: ItemState; onRetry?: () => void }) {
  const t = "totals" in state ? state.totals : ZERO;
  const summary = [
    t.created && plural(t.created, "expense"),
    t.payments && plural(t.payments, "payment"),
    t.comments && plural(t.comments, "comment"),
    t.existing && `${t.existing} already here`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm">
      <span className="mt-0.5" aria-hidden>
        {state.state === "queued" && <Clock className="size-4 text-muted-foreground" />}
        {state.state === "running" && <Loader2 className="size-4 animate-spin" />}
        {state.state === "done" && <CheckCircle2 className="size-4 text-emerald-600" />}
        {state.state === "error" && <TriangleAlert className="size-4 text-destructive" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{name}</p>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {state.state === "queued" && "Waiting…"}
          {state.state === "running" && [state.phase, summary].filter(Boolean).join(" · ")}
          {state.state === "done" && (summary || "Members imported")}
          {state.state === "error" && <span className="text-destructive">{state.error}</span>}
        </p>
        {(state.state === "done" || state.state === "error") && t.skipped > 0 && (
          <p className="text-xs text-muted-foreground">
            {t.skipped} skipped{t.unresolved > 0 ? ": someone on them isn't on SplitLens yet. Re-run after they join." : "."}
          </p>
        )}
        {state.state === "done" && (
          <div className="mt-2 flex flex-wrap gap-2">
            {state.groupId && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/groups/${state.groupId}`}>
                  <Users /> Open group
                </Link>
              </Button>
            )}
            {state.groupId && state.missing > 0 && (
              <InviteButton
                variant="default"
                label={`Invite ${state.missing} ${state.missing === 1 ? "person" : "people"} to ${name}`}
                name="there"
                getUrl={async () => {
                  const r = await createInviteAction(state.groupId!);
                  return r.ok ? { ok: true, url: `${window.location.origin}/invite/${r.token}` } : r;
                }}
              />
            )}
            {isFriend && t.created + t.payments > 0 && (
              <Button asChild size="sm" variant="outline">
                <Link href="/friends">Open friends</Link>
              </Button>
            )}
          </div>
        )}
      </div>
      {state.state === "error" && onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      )}
    </li>
  );
}
