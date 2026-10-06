"use client";

import { ArrowLeftRight, ArrowRight, ExternalLink, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSettlementAction } from "@/app/(app)/settlements/actions";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CURRENCY_CODES } from "@/lib/currencies";
import { paypalMeUrl, venmoPayUrl } from "@/lib/payments/deep-links";
import { parseSettlementAmount } from "@/lib/splits";
import { PAYMENT_METHODS, toServerMethod, type PaymentMethod } from "./methods";

export type SettlePerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  venmoUsername?: string | null;
  paypalUsername?: string | null;
};

type Method = PaymentMethod;
const METHODS = PAYMENT_METHODS;

export type SettleUpInitial = {
  from: string;
  to: string;
  /** Major units, e.g. "25.00". */
  amount: string;
  currency: string;
  date?: string;
  method?: Method;
  notes?: string;
};

type Props = {
  trigger: React.ReactNode;
  groupId?: string;
  settlementId?: string;
  people: SettlePerson[];
  meId: string;
  initial: SettleUpInitial;
  /** Shown in the deep-link note, e.g. the group name. */
  context?: string;
};

export function SettleUpDialog({ trigger, groupId, settlementId, people, meId, initial, context }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 rounded-none p-0 sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-xl"
      >
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <DialogTitle className="flex-1 text-base">{settlementId ? "Edit payment" : "Settle up"}</DialogTitle>
          <DialogDescription className="sr-only">Record a payment between two people.</DialogDescription>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X />
            </Button>
          </DialogClose>
        </header>
        {open && (
          <SettleUpForm
            groupId={groupId}
            settlementId={settlementId}
            people={people}
            meId={meId}
            initial={initial}
            context={context}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettleUpForm({
  groupId,
  settlementId,
  people,
  meId,
  initial,
  context,
  onDone,
}: Omit<Props, "trigger"> & { onDone: () => void }) {
  const router = useRouter();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [amount, setAmount] = useState(initial.amount);
  const [currency, setCurrency] = useState(initial.currency);
  const [date, setDate] = useState(initial.date ?? (() => new Date().toLocaleDateString("en-CA")));
  const [method, setMethod] = useState<Method>(initial.method ?? "cash");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const payee = byId.get(to);
  const label = (id: string) => (id === meId ? "You" : (byId.get(id)?.name ?? "Someone"));
  const parsed = parseSettlementAmount(amount, currency);

  // Deep link to pay the recipient, offered when *I* am the one paying.
  const note = `SplitLens${context ? `: ${context}` : ""}`;
  let payLink: { href: string; label: string } | null = null;
  let payHint: string | null = null;
  if (from === meId && parsed.ok && payee) {
    if (method === "venmo") {
      if (!payee.venmoUsername) payHint = `${payee.name} hasn't added a Venmo username.`;
      else {
        const href = venmoPayUrl({ username: payee.venmoUsername, amount: parsed.amount, currency, note });
        if (href) payLink = { href, label: `Pay ${payee.name} on Venmo` };
        else payHint = "Venmo only supports USD.";
      }
    }
    if (method === "paypal") {
      if (!payee.paypalUsername) payHint = `${payee.name} hasn't added a PayPal.me name.`;
      else payLink = { href: paypalMeUrl({ username: payee.paypalUsername, amount: parsed.amount, currency }), label: `Pay ${payee.name} on PayPal` };
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (from === to) return setError("Someone can't pay themselves.");
    if (!parsed.ok) return setError(parsed.message);
    startTransition(async () => {
      const result = await saveSettlementAction({
        settlementId,
        groupId,
        from,
        to,
        amount,
        currency,
        date,
        notes: notes.trim() || undefined,
        ...toServerMethod(method),
      });
      if (!result.ok) return setError(result.error);
      toast.success(settlementId ? "Payment updated" : `Recorded: ${label(from)} paid ${to === meId ? "you" : label(to)}`);
      onDone();
      router.refresh();
    });
  };

  const personSelect = (value: string, onChange: (v: string) => void, aria: string) => (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger aria-label={aria} className="h-auto w-full py-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {people.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} className="size-6" />
            {p.id === meId ? "You" : p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Paid by</Label>
            {personSelect(from, setFrom, "Paid by")}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-5"
            aria-label="Swap who paid"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
          >
            <ArrowLeftRight />
          </Button>
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Paid to</Label>
            {personSelect(to, setTo, "Paid to")}
          </div>
        </div>

        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          {label(from)} <ArrowRight className="size-4" aria-hidden /> {label(to)}
        </p>

        <div className="flex gap-3">
          <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
            <SelectTrigger aria-label="Currency" className="h-12 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCY_CODES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="Amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-12 flex-1 text-xl font-semibold tabular-nums"
            placeholder="0.00"
          />
        </div>

        <div className="space-y-2">
          <Label>How</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={method}
            onValueChange={(v) => v && setMethod(v as Method)}
            className="flex w-full flex-wrap"
          >
            {METHODS.map((m) => (
              <ToggleGroupItem key={m.value} value={m.value} className="flex-1">
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {payLink && (
            <Button asChild variant="secondary" className="w-full">
              <a href={payLink.href} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                {payLink.label}
              </a>
            </Button>
          )}
          {payLink && <p className="text-xs text-muted-foreground">Pay in the app, then come back and record the payment.</p>}
          {payHint && <p className="text-xs text-muted-foreground">{payHint}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="settle-date">Date</Label>
            <Input id="settle-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="settle-notes">Notes</Label>
          <Textarea id="settle-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} />
        </div>
      </div>
      <footer className="flex items-center gap-3 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {error && (
          <p className="flex-1 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="ml-auto">
          {pending ? "Saving…" : settlementId ? "Save" : "Record payment"}
        </Button>
      </footer>
    </form>
  );
}
