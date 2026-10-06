"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { setExpenseDeletedAction } from "@/app/(app)/expenses/actions";
import { setSettlementDeletedAction } from "@/app/(app)/settlements/actions";
import { Button } from "@/components/ui/button";

const ACTIONS = { expense: setExpenseDeletedAction, settlement: setSettlementDeletedAction };
const LABELS = { expense: "Expense", settlement: "Payment" };

/** Soft delete with an Undo toast; on a deleted item it becomes a Restore button. */
export function SoftDeleteButton({
  kind,
  id,
  groupId,
  deleted,
}: {
  kind: keyof typeof ACTIONS;
  id: string;
  groupId: string | null;
  deleted: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const setDeleted = (value: boolean, withUndo: boolean) =>
    startTransition(async () => {
      const result = await ACTIONS[kind](id, value, groupId);
      if (!result.ok) return void toast.error(result.error);
      router.refresh();
      if (withUndo) {
        toast(`${LABELS[kind]} deleted`, { action: { label: "Undo", onClick: () => setDeleted(false, false) }, duration: 8000 });
      } else {
        toast.success(`${LABELS[kind]} ${value ? "deleted" : "restored"}`);
      }
    });

  return deleted ? (
    <Button variant="outline" onClick={() => setDeleted(false, false)} disabled={pending}>
      <RotateCcw aria-hidden />
      Restore
    </Button>
  ) : (
    <Button variant="outline" onClick={() => setDeleted(true, true)} disabled={pending}>
      <Trash2 aria-hidden />
      Delete
    </Button>
  );
}
