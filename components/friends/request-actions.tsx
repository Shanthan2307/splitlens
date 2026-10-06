"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { cancelFriendRequestAction, respondFriendRequestAction } from "@/app/(app)/friends/actions";
import { Button } from "@/components/ui/button";

export function IncomingRequestActions({ friendshipId }: { friendshipId: string }) {
  const [pending, startTransition] = useTransition();
  const respond = (accept: boolean) =>
    startTransition(async () => {
      const result = await respondFriendRequestAction(friendshipId, accept);
      if (!result.ok) toast.error(result.error);
      else toast.success(accept ? "Friend request accepted" : "Request declined");
    });
  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => respond(true)} disabled={pending}>
        Accept
      </Button>
      <Button size="sm" variant="ghost" onClick={() => respond(false)} disabled={pending}>
        Decline
      </Button>
    </div>
  );
}

export function CancelRequestButton({ friendshipId }: { friendshipId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await cancelFriendRequestAction(friendshipId);
          if (!result.ok) toast.error(result.error);
        })
      }
    >
      Cancel
    </Button>
  );
}
