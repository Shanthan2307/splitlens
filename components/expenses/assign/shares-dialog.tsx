"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { PersonAvatar } from "@/components/people/person-avatar";
import type { FormPerson } from "@/components/expenses/expense-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DraftLine } from "@/lib/splits";

const MAX_WEIGHT = 20;

/** Uneven shares for one item: e.g. Ada had 2 of the 3 beers → Ada 2, Bob 1. */
export function SharesDialog({
  line,
  people,
  meId,
  onSave,
  onClose,
}: {
  line: DraftLine;
  people: FormPerson[];
  meId: string;
  onSave: (assignments: DraftLine["assignments"]) => void;
  onClose: () => void;
}) {
  const [weights, setWeights] = useState<Record<string, number>>(() =>
    Object.fromEntries(people.map((p) => [p.id, line.assignments.find((a) => a.participantId === p.id)?.weight ?? (line.assignments.some((a) => a.participantId === p.id) ? 1 : 0)])),
  );
  const step = (id: string, delta: number) =>
    setWeights((w) => ({ ...w, [id]: Math.max(0, Math.min(MAX_WEIGHT, (w[id] ?? 0) + delta)) }));
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Shares of {line.name || "this item"}</DialogTitle>
          <DialogDescription>Give someone 2 shares if they had twice as much.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-lg border">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} className="size-8" />
              <span className="min-w-0 flex-1 truncate text-sm">{p.id === meId ? "You" : p.name}</span>
              <Button type="button" variant="outline" size="icon-sm" aria-label={`Fewer shares for ${p.name}`} onClick={() => step(p.id, -1)} disabled={!weights[p.id]}>
                <Minus />
              </Button>
              <output className="w-6 text-center tabular-nums" aria-label={`${p.name} shares`}>
                {weights[p.id] ?? 0}
              </output>
              <Button type="button" variant="outline" size="icon-sm" aria-label={`More shares for ${p.name}`} onClick={() => step(p.id, 1)} disabled={(weights[p.id] ?? 0) >= MAX_WEIGHT}>
                <Plus />
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            type="button"
            disabled={total === 0}
            onClick={() =>
              onSave(people.filter((p) => weights[p.id] > 0).map((p) => ({ participantId: p.id, weight: weights[p.id] })))
            }
          >
            Save shares
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
