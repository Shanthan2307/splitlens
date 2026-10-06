"use client";

import { Send, Trash2, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { addCommentAction, deleteCommentAction } from "@/app/(app)/comments/actions";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Comment, CommentTarget } from "@/lib/db/comments";
import { createClient } from "@/lib/supabase/client";

type Author = { name: string; avatarUrl: string | null };

const timeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

type CommentRow = { id: string; author_id: string | null; body: string; created_at: string; is_deleted: boolean };

/**
 * Comment thread for an expense or payment. New comments from anyone appear live via
 * Supabase Realtime (postgres_changes respects RLS, so only people who can see the
 * expense receive them).
 */
export function Comments({
  target,
  initial,
  authors,
  meUserId,
}: {
  target: CommentTarget;
  initial: Comment[];
  /** user id → display info for everyone likely to comment. */
  authors: Record<string, Author>;
  meUserId: string;
}) {
  const [comments, setComments] = useState(initial);
  const [body, setBody] = useState("");
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");
  const liveLabel = live === "live" ? "Live" : null;
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLLIElement>(null);
  const column = "expenseId" in target ? "expense_id" : "settlement_id";
  const targetId = "expenseId" in target ? target.expenseId : target.settlementId;

  useEffect(() => setComments(initial), [initial]);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      // Realtime evaluates RLS with the user's JWT; make sure it has it before joining.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      // Unique topic per mount: the browser client is a singleton and dev Strict Mode mounts twice.
      channel = supabase
        .channel(`comments:${targetId}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "comments", filter: `${column}=eq.${targetId}` },
          (payload) => {
            const row = payload.new as Partial<CommentRow>;
            if (!row.id) return;
            setComments((current) => {
              if (row.is_deleted) return current.filter((c) => c.id !== row.id);
              if (current.some((c) => c.id === row.id)) return current;
              return [
                ...current,
                { id: row.id!, authorId: row.author_id ?? null, body: row.body ?? "", createdAt: row.created_at ?? new Date().toISOString() },
              ];
            });
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") setLive("live");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setLive("offline");
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [column, targetId]);

  const sorted = useMemo(() => [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [comments]);

  const post = (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    startTransition(async () => {
      const result = await addCommentAction({ target, body: text });
      if (!result.ok) return void toast.error(result.error);
      setBody("");
      // Realtime may deliver the same row; ids are de-duplicated.
      setComments((current) => (current.some((c) => c.id === result.comment.id) ? current : [...current, result.comment]));
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "nearest" }));
    });
  };

  const remove = (id: string) =>
    startTransition(async () => {
      const result = await deleteCommentAction(id);
      if (!result.ok) toast.error(result.error);
      else setComments((current) => current.filter((c) => c.id !== id));
    });

  return (
    <div className="space-y-4">
      {liveLabel && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
          {liveLabel}
        </p>
      )}
      {live === "offline" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <WifiOff className="size-3.5" aria-hidden />
          Live updates paused. Refresh to see new comments.
        </p>
      )}
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet. Start the conversation.</p>
      ) : (
        <ul className="space-y-4" aria-live="polite">
          {sorted.map((c) => {
            const author = (c.authorId && authors[c.authorId]) || { name: "Someone", avatarUrl: null };
            const mine = c.authorId === meUserId;
            return (
              <li key={c.id} className="flex gap-3">
                <PersonAvatar name={author.name} avatarUrl={author.avatarUrl} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{mine ? "You" : author.name}</span>{" "}
                    <span className="text-xs text-muted-foreground">{timeFormat.format(new Date(c.createdAt))}</span>
                  </p>
                  <p className="text-sm break-words whitespace-pre-wrap">{c.body}</p>
                </div>
                {mine && (
                  <Button variant="ghost" size="icon-sm" aria-label="Delete comment" onClick={() => remove(c.id)} disabled={pending}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            );
          })}
          <li ref={endRef} aria-hidden />
        </ul>
      )}
      <form onSubmit={post} className="flex items-end gap-2">
        <Textarea
          aria-label="Add a comment"
          placeholder="Add a comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(e);
          }}
          maxLength={4000}
          rows={2}
          className="min-h-0"
        />
        <Button type="submit" size="icon" disabled={pending || !body.trim()} aria-label="Post comment">
          <Send />
        </Button>
      </form>
    </div>
  );
}
