"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExpenseForm, type ExpenseFormInitial, type FormPerson } from "@/components/expenses/expense-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export type ExpenseDialogProps = {
  trigger: React.ReactNode;
  expenseId?: string;
  groupId?: string;
  people: FormPerson[];
  meId: string;
  friendMode?: boolean;
  initial: ExpenseFormInitial;
  splitwise?: { participants: Record<string, number> };
  /** Where to go after saving a new expense. Defaults to staying on the page. */
  navigateToNew?: boolean;
};

/** Add/edit expense: full-screen sheet on phones, centered dialog on larger screens. */
export function ExpenseDialog({ trigger, navigateToNew, friendMode = false, ...form }: ExpenseDialogProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const title = form.expenseId ? "Edit expense" : "Add an expense";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 rounded-none p-0 sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-xl"
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          // Start in the description for new expenses (Radix would focus the category button).
          if (form.expenseId) return;
          e.preventDefault();
          document.getElementById("description")?.focus();
        }}
      >
        <header className="flex items-center gap-2 border-b px-4 py-3 sm:px-6">
          <DialogTitle className="flex-1 text-base">{title}</DialogTitle>
          <DialogDescription className="sr-only">Enter the amount, who paid, and how to split it.</DialogDescription>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X />
            </Button>
          </DialogClose>
        </header>
        {open && (
          <ExpenseForm
            {...form}
            friendMode={friendMode}
            onCancel={() => setOpen(false)}
            onDone={(expenseId) => {
              setOpen(false);
              if (navigateToNew && !form.expenseId) router.push(`/expenses/${expenseId}`);
              else router.refresh();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
