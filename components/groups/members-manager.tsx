"use client";

import { Copy, Link2, Trash2, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addMemberAction, createInviteAction, removeMemberAction, revokeInviteAction } from "@/app/(app)/groups/actions";
import { PersonAvatar } from "@/components/people/person-avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { GroupMember } from "@/lib/db/groups";
import type { InviteLink } from "@/lib/db/invites";

async function copyInvite(token: string) {
  const url = `${window.location.origin}/invite/${token}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  } catch {
    toast.message("Invite link", { description: url });
  }
}

export function MembersManager({
  groupId,
  members,
  invites,
  myUserId,
}: {
  groupId: string;
  members: GroupMember[];
  invites: InviteLink[];
  myUserId: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"email" | "name">("email");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addMemberAction(mode === "email" ? { groupId, email: value } : { groupId, name: value });
      if (!result.ok) return setError(result.error);
      toast.success(result.message);
      setValue("");
      router.refresh();
    });
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(success);
        router.refresh();
      }
    });

  const invite = (memberId?: string) =>
    startTransition(async () => {
      const result = await createInviteAction(groupId, memberId);
      if (!result.ok) return void toast.error(result.error);
      await copyInvite(result.token);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <ul className="divide-y rounded-lg border">
        {members.map((m) => (
          <li key={m.memberId} className="flex items-center gap-3 px-3 py-2">
            <PersonAvatar name={m.name} avatarUrl={m.avatarUrl} className="size-9" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {m.userId === myUserId ? `${m.name} (you)` : m.name}
                {m.isPlaceholder && (
                  <Badge variant="secondary" className="ml-2">
                    {m.placeholderEmail ? "invited" : "placeholder"}
                  </Badge>
                )}
              </p>
              {m.email && <p className="truncate text-xs text-muted-foreground">{m.email}</p>}
            </div>
            {m.isPlaceholder && (
              <Button variant="ghost" size="icon-sm" aria-label={`Invite link for ${m.name}`} onClick={() => invite(m.memberId)} disabled={pending}>
                <Link2 />
              </Button>
            )}
            {m.userId !== myUserId && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.name}`} disabled={pending}>
                    <UserMinus />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove {m.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      They can only be removed once their balance in this group is settled. Their past expenses stay.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => run(() => removeMemberAction(groupId, m.memberId), `${m.name} removed`)}>
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="add-member">Add someone</Label>
          <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as typeof mode)}>
            <ToggleGroupItem value="email">By email</ToggleGroupItem>
            <ToggleGroupItem value="name">Name only</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex gap-2">
          <Input
            id="add-member"
            type={mode === "email" ? "email" : "text"}
            placeholder={mode === "email" ? "friend@example.com" : "Their name"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={mode === "email" ? 254 : 80}
            required
          />
          <Button type="submit" disabled={pending}>
            Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {mode === "email"
            ? "If they're not on SplitLens yet, they'll be linked automatically when they sign up with this email."
            : "Adds a placeholder you can split with now. Send them an invite link to claim it later."}
        </p>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </form>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Invite links</h3>
          <Button variant="outline" size="sm" onClick={() => invite()} disabled={pending}>
            <Link2 aria-hidden />
            Create link
          </Button>
        </div>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">Anyone with a link can join this group.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {inv.memberId ? `For ${members.find((m) => m.memberId === inv.memberId)?.name ?? "a placeholder"}` : "Anyone"}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">…{inv.token.slice(-6)}</span>
                </span>
                <Button variant="ghost" size="icon-sm" aria-label="Copy invite link" onClick={() => copyInvite(inv.token)}>
                  <Copy />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Revoke invite link"
                  onClick={() => run(() => revokeInviteAction(groupId, inv.id), "Invite link revoked")}
                  disabled={pending}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
