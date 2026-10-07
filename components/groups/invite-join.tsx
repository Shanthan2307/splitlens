"use client";

import { useState, useTransition } from "react";
import { redeemFriendInviteAction, redeemInviteAction } from "@/app/(app)/invite/[token]/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export function InviteJoin({
  token,
  placeholders,
  claimMemberId,
}: {
  token: string;
  placeholders: { id: string; name: string }[];
  claimMemberId: string | null;
}) {
  const [choice, setChoice] = useState<string>(claimMemberId ?? "__new");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const join = () =>
    startTransition(async () => {
      const result = await redeemInviteAction({ token, claimMemberId: choice === "__new" ? null : choice });
      // Success redirects to the group.
      if (result && !result.ok) setError(result.error);
    });

  return (
    <div className="space-y-4">
      {placeholders.length > 0 && (
        <div className="space-y-2">
          <Label>Are you one of these people?</Label>
          <p className="text-xs text-muted-foreground">Claiming a name keeps the expenses already added for them.</p>
          <RadioGroup value={choice} onValueChange={setChoice} className="gap-2">
            {placeholders.map((p) => (
              <Label key={p.id} className="flex items-center gap-3 rounded-md border p-3 font-normal">
                <RadioGroupItem value={p.id} />
                I&apos;m {p.name}
              </Label>
            ))}
            {!claimMemberId && (
              <Label className="flex items-center gap-3 rounded-md border p-3 font-normal">
                <RadioGroupItem value="__new" />
                Join as a new member
              </Label>
            )}
          </RadioGroup>
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button onClick={join} disabled={pending} className="w-full">
        {pending ? "Joining…" : "Join group"}
      </Button>
    </div>
  );
}

export function FriendInviteAccept({ token, name }: { token: string; name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await redeemFriendInviteAction({ token });
            if (result && !result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Adding…" : `Add ${name} as a friend`}
      </Button>
    </div>
  );
}
