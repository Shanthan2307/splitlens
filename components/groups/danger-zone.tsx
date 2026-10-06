"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { deleteGroupAction, leaveGroupAction } from "@/app/(app)/groups/actions";
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
import { Button } from "@/components/ui/button";

function Confirm({
  label,
  title,
  description,
  onConfirm,
  pending,
}: {
  label: string;
  title: string;
  description: string;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={pending}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DangerZone({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [pending, startTransition] = useTransition();
  // On success these actions redirect; they only return on failure.
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      if (result && !result.ok) toast.error(result.error);
    });

  return (
    <div className="flex flex-wrap gap-3">
      <Confirm
        label="Leave group"
        title={`Leave ${groupName}?`}
        description="You can only leave once your balance in this group is settled."
        onConfirm={() => run(() => leaveGroupAction(groupId))}
        pending={pending}
      />
      <Confirm
        label="Delete group"
        title={`Delete ${groupName}?`}
        description="The group and its expenses will be hidden for everyone. Balances from this group will no longer count."
        onConfirm={() => run(() => deleteGroupAction(groupId))}
        pending={pending}
      />
    </div>
  );
}
