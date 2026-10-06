"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { lineTotalFromUnit, type DraftLine } from "@/lib/splits";

export const LINE_KINDS: { value: DraftLine["kind"]; label: string }[] = [
  { value: "item", label: "Item" },
  { value: "tax", label: "Tax" },
  { value: "tip", label: "Tip" },
  { value: "service", label: "Service charge" },
  { value: "fee", label: "Fee" },
  { value: "discount", label: "Discount" },
];

/** Edit (or create) one receipt line: name, quantity × unit price, total, type. */
export function ItemEditDialog({
  line,
  currency,
  isNew,
  onSave,
  onDelete,
  onClose,
}: {
  line: DraftLine;
  currency: string;
  isNew: boolean;
  onSave: (line: DraftLine) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(line);
  const set = (patch: Partial<DraftLine>) => setDraft((d) => ({ ...d, ...patch }));
  // Changing quantity or unit price recomputes the total (exactly, in lib/splits).
  const recompute = (patch: Partial<DraftLine>) => {
    const next = { ...draft, ...patch };
    const total = next.unitPrice && next.quantity ? lineTotalFromUnit(next.unitPrice, next.quantity, currency) : null;
    setDraft(total ? { ...next, amount: total } : next);
  };
  const isItem = draft.kind === "item";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            // React events bubble through portals: don't also submit the expense form around us.
            e.stopPropagation();
            onSave({ ...draft, name: draft.name.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle>{isNew ? "Add line" : "Edit line"}</DialogTitle>
            <DialogDescription>
              {draft.originalName ? <span lang="und">On the receipt: {draft.originalName}</span> : `Amounts in ${currency}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="line-kind">Type</Label>
            <Select value={draft.kind} onValueChange={(v) => v && set({ kind: v as DraftLine["kind"] })}>
              <SelectTrigger id="line-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINE_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="line-name">Name</Label>
            <Input id="line-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} required={isItem} autoFocus />
          </div>
          {isItem && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="line-qty">Quantity</Label>
                <Input id="line-qty" inputMode="decimal" value={draft.quantity ?? ""} placeholder="1" onChange={(e) => recompute({ quantity: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="line-unit">Unit price</Label>
                <Input id="line-unit" inputMode="decimal" value={draft.unitPrice ?? ""} placeholder="—" onChange={(e) => recompute({ unitPrice: e.target.value })} />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="line-total">{draft.kind === "discount" ? "Amount (negative)" : "Total"}</Label>
            <Input id="line-total" inputMode="decimal" value={draft.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0.00" required />
          </div>
          <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
            {!isNew ? (
              <Button type="button" variant="ghost" className="text-destructive" onClick={onDelete}>
                <Trash2 aria-hidden />
                Delete
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit">{isNew ? "Add" : "Done"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
