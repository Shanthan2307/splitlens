"use client";

import { AlertTriangle, Paperclip, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveExpenseAction } from "@/app/(app)/expenses/actions";
import { ItemAssigner } from "@/components/expenses/assign/item-assigner";
import { CategoryIcon } from "@/components/expenses/category-icon";
import { uploadAttachment } from "@/components/expenses/upload-attachment";
import { PersonAvatar } from "@/components/people/person-avatar";
import { ScanReceiptButton, type ScannedReceipt } from "@/components/receipts/scan-receipt-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CATEGORIES, type CategoryId } from "@/lib/categories";
import { CURRENCY_CODES } from "@/lib/currencies";
import {
  buildExpense,
  formatMinor,
  previewItemized,
  sumDraftLines,
  type DraftLine,
  type DraftPaidBy,
  type DraftSplit,
  type ExpenseDraft,
} from "@/lib/splits";
import { cn } from "@/lib/utils";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES } from "@/lib/validation/expense";

export type FormPerson = { id: string; name: string; avatarUrl: string | null };

type SplitType = DraftSplit["type"];
type ValueSplitType = Extract<SplitType, "exact" | "percentage" | "shares" | "adjustment">;

export type ExpenseFormInitial = {
  description: string;
  category: CategoryId;
  /** YYYY-MM-DD; null = today in the user's timezone. */
  date: string | null;
  notes: string;
  currency: string;
  total: string;
  paidBy: DraftPaidBy;
  split: DraftSplit;
  /** Friend-only expenses: who's on it (always includes me). */
  involvedIds?: string[];
  receiptId?: string;
};

type Props = {
  expenseId?: string;
  groupId?: string;
  /** Everyone who can be on the expense, me first. */
  people: FormPerson[];
  meId: string;
  /** Friend-only expense: pick which friends are involved. */
  friendMode: boolean;
  initial: ExpenseFormInitial;
  /** Present when "Also post to Splitwise" can apply: participant id → Splitwise user id. */
  splitwise?: { participants: Record<string, number> };
  onDone: (expenseId: string) => void;
  onCancel: () => void;
};

const POST_PREF_KEY = "splitlens:post-to-splitwise";

function readPostPref(): boolean {
  try {
    return localStorage.getItem(POST_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

const SPLIT_TYPES: { value: SplitType; label: string; hint: string }[] = [
  { value: "equal", label: "Equal", hint: "Split equally" },
  { value: "exact", label: "Exact", hint: "Exact amounts" },
  { value: "percentage", label: "%", hint: "By percentage" },
  { value: "shares", label: "Shares", hint: "By shares, e.g. 2:1:1" },
  { value: "adjustment", label: "+/−", hint: "Equal, with adjustments" },
  { value: "itemized", label: "Itemized", hint: "Tap a person, then tap what they had" },
];

const VALUE_SUFFIX: Record<ValueSplitType, (currency: string) => string> = {
  exact: (c) => c,
  percentage: () => "%",
  shares: () => "shares",
  adjustment: (c) => `± ${c}`,
};

function today() {
  return new Date().toLocaleDateString("en-CA");
}

function initialValues(split: DraftSplit): Record<ValueSplitType, Record<string, string>> {
  const empty = { exact: {}, percentage: {}, shares: {}, adjustment: {} };
  if (split.type === "equal" || split.type === "itemized") return empty;
  return { ...empty, [split.type]: Object.fromEntries(split.values.map((v) => [v.participantId, v.value])) };
}

export function ExpenseForm({ expenseId, groupId, people, meId, friendMode, initial, splitwise, onDone, onCancel }: Props) {
  const [description, setDescription] = useState(initial.description);
  const [category, setCategory] = useState<CategoryId>(initial.category);
  const [date, setDate] = useState(initial.date ?? today);
  const [notes, setNotes] = useState(initial.notes);
  const [currency, setCurrency] = useState(initial.currency);
  const [total, setTotal] = useState(initial.total);
  const [involved, setInvolved] = useState<string[]>(initial.involvedIds ?? people.map((p) => p.id));
  const [payerMode, setPayerMode] = useState<DraftPaidBy["mode"]>(initial.paidBy.mode);
  const [payerId, setPayerId] = useState(initial.paidBy.mode === "single" ? initial.paidBy.participantId : meId);
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>(
    initial.paidBy.mode === "multiple"
      ? Object.fromEntries(initial.paidBy.amounts.map((a) => [a.participantId, a.value]))
      : {},
  );
  const [splitType, setSplitType] = useState<SplitType>(initial.split.type);
  const [equalIds, setEqualIds] = useState<string[]>(
    initial.split.type === "equal" ? initial.split.participants : people.map((p) => p.id),
  );
  const [values, setValues] = useState(() => initialValues(initial.split));
  const [lines, setLines] = useState<DraftLine[]>(initial.split.type === "itemized" ? initial.split.lines : []);
  const [receiptId, setReceiptId] = useState(initial.receiptId);
  const [postToSplitwise, setPostToSplitwise] = useState(readPostPref);
  const [files, setFiles] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const participants = useMemo(
    () => (friendMode ? people.filter((p) => p.id === meId || involved.includes(p.id)) : people),
    [friendMode, people, involved, meId],
  );
  const participantIds = useMemo(() => new Set(participants.map((p) => p.id)), [participants]);

  const draft: ExpenseDraft = useMemo(() => {
    const paidBy: DraftPaidBy =
      payerMode === "single"
        ? { mode: "single", participantId: participantIds.has(payerId) ? payerId : meId }
        : {
            mode: "multiple",
            amounts: participants.map((p) => ({ participantId: p.id, value: payerAmounts[p.id] ?? "" })),
          };
    let split: DraftSplit;
    if (splitType === "equal") {
      split = { type: "equal", participants: participants.filter((p) => equalIds.includes(p.id)).map((p) => p.id) };
    } else if (splitType === "itemized") {
      split = {
        type: "itemized",
        lines: lines.map((l) => ({
          ...l,
          assignments: l.assignments.filter((a) => participantIds.has(a.participantId)),
        })),
      };
    } else {
      split = {
        type: splitType,
        values: participants.map((p) => ({ participantId: p.id, value: values[splitType][p.id] ?? "" })),
      };
    }
    return { currency, total, paidBy, split };
  }, [
    currency,
    total,
    payerMode,
    payerId,
    payerAmounts,
    participants,
    participantIds,
    meId,
    splitType,
    equalIds,
    values,
    lines,
  ]);

  const preview = useMemo(() => buildExpense(draft), [draft]);
  // Splitwise needs a matching account for everyone who paid or owes something.
  const notOnSplitwise = useMemo(() => {
    if (!splitwise || !preview.ok) return [];
    const ids = new Set([...preview.expense.payers, ...preview.expense.shares].filter((p) => p.amount !== 0).map((p) => p.participantId));
    return people.filter((p) => ids.has(p.id) && splitwise.participants[p.id] === undefined);
  }, [splitwise, preview, people]);
  const postBlocked = notOnSplitwise.length > 0 || (preview.ok && preview.expense.total < 0);
  const willPost = Boolean(splitwise) && !expenseId && postToSplitwise && !postBlocked;
  // Per-person split amounts shouldn't vanish while the payer amounts are still being typed.
  const splitPreview = useMemo(
    () => (preview.ok ? preview : buildExpense({ ...draft, paidBy: { mode: "single", participantId: meId } })),
    [preview, draft, meId],
  );
  // Live per-person totals while items are still being assigned.
  const itemized = useMemo(
    () =>
      splitType === "itemized" && draft.split.type === "itemized" ? previewItemized(draft.split.lines, currency) : null,
    [splitType, draft.split, currency],
  );
  const blockedByUnassigned = Boolean(itemized && itemized.unassigned.length > 0);
  const shareById = useMemo(
    () => new Map(splitPreview.ok ? splitPreview.expense.shares.map((s) => [s.participantId, s.amount]) : []),
    [splitPreview],
  );
  const money = (amount: number) => {
    try {
      return formatMinor(amount, currency);
    } catch {
      return String(amount);
    }
  };

  function applyScannedReceipt(receipt: ScannedReceipt) {
    setSplitType("itemized");
    setLines(receipt.lines);
    setReceiptId(receipt.receiptId);
    if (receipt.currency) setCurrency(receipt.currency);
    if (receipt.date) setDate(receipt.date);
    if (receipt.merchantName && !description.trim()) setDescription(receipt.merchantName);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (blockedByUnassigned) {
      document.querySelector("[data-unassigned]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!description.trim() || !preview.ok) return;

    startTransition(async () => {
      const result = await saveExpenseAction({
        expenseId,
        groupId,
        description,
        category,
        date,
        notes: notes.trim() || undefined,
        receiptId,
        draft,
        postToSplitwise: willPost,
      });
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      if (result.splitwise && !result.splitwise.ok) toast.warning(`Saved here, but not on Splitwise: ${result.splitwise.error}`);
      const failures: string[] = [];
      for (const file of files) {
        const uploaded = await uploadAttachment(result.expenseId, file);
        if (!uploaded.ok) failures.push(uploaded.error);
      }
      if (failures.length) toast.error(failures.join("\n"));
      toast.success(expenseId ? "Expense updated" : result.splitwise?.ok ? "Expense added here and on Splitwise" : "Expense added");
      onDone(result.expenseId);
    });
  }

  const errorFor = (field: "total" | "paidBy" | "split") =>
    !preview.ok && preview.field === field ? preview.message : null;
  // Live hints ("$4.00 left") are useful while typing; they turn red once the user tries to save.
  const hasTotal = splitType === "itemized" || total.trim() !== "";

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
        {friendMode && (
          <section className="space-y-2">
            <Label>With you and</Label>
            {people.length <= 1 ? (
              <p className="text-sm text-muted-foreground">Add friends first to split with them.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {people
                  .filter((p) => p.id !== meId)
                  .map((p) => {
                    const on = involved.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setInvolved((ids) => (on ? ids.filter((id) => id !== p.id) : [...ids, p.id]));
                          if (!on) setEqualIds((ids) => [...ids, p.id]);
                        }}
                        className={cn(
                          "flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm transition-colors",
                          on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                        )}
                      >
                        <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} className="size-6" />
                        {p.name}
                      </button>
                    );
                  })}
              </div>
            )}
          </section>
        )}

        <section className="flex items-start gap-3">
          <Select value={category} onValueChange={(v) => v && setCategory(v as CategoryId)}>
            <SelectTrigger aria-label="Category" className="h-12 w-auto px-2 [&>svg:last-child]:hidden">
              <CategoryIcon category={category} className="size-9" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(Object.groupBy(CATEGORIES, (c) => c.group)).map(([group, items]) => (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {items!.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <CategoryIcon category={c.id} className="size-6 rounded-md" />
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1 space-y-1">
            <Label htmlFor="description" className="sr-only">
              Description
            </Label>
            <Input
              id="description"
              placeholder="Enter a description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              className="h-12 text-base"
              aria-invalid={submitted && !description.trim()}
            />
            {submitted && !description.trim() && <FieldMessage error>Add a description</FieldMessage>}
          </div>
        </section>

        <section className="flex items-start gap-3">
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
          <div className="flex-1 space-y-1">
            <Label htmlFor="total" className="sr-only">
              Amount
            </Label>
            {splitType === "itemized" ? (
              <div className="flex h-12 items-center rounded-md border bg-muted/50 px-3 text-xl font-semibold tabular-nums">
                {splitPreview.ok
                  ? money(splitPreview.expense.total)
                  : (() => {
                      const sum = sumDraftLines(lines, currency);
                      return sum === null || lines.length === 0 ? "—" : money(sum);
                    })()}
                <span className="ml-auto text-xs font-normal text-muted-foreground">from items</span>
              </div>
            ) : (
              <Input
                id="total"
                inputMode="decimal"
                placeholder="0.00"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                className="h-12 text-xl font-semibold tabular-nums"
                aria-invalid={submitted && Boolean(errorFor("total"))}
              />
            )}
            {errorFor("total") && (submitted || total.trim() !== "") && (
              <FieldMessage error={submitted}>{errorFor("total")}</FieldMessage>
            )}
          </div>
        </section>

        <div className="flex justify-end">
          <ScanReceiptButton onScanned={applyScannedReceipt} />
        </div>

        {/* ---------------------------------------------------------------- paid by */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <Label htmlFor="paid-by" className="shrink-0">
              Paid by
            </Label>
            <Select
              value={payerMode === "multiple" ? "__multiple" : participantIds.has(payerId) ? payerId : meId}
              onValueChange={(v) => {
                // Radix's hidden native <select> can emit "" on re-render inside a form; ignore it.
                if (!v) return;
                if (v === "__multiple") setPayerMode("multiple");
                else {
                  setPayerMode("single");
                  setPayerId(v);
                }
              }}
            >
              <SelectTrigger id="paid-by" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {participants.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.id === meId ? "You" : p.name}
                  </SelectItem>
                ))}
                <SelectItem value="__multiple">Multiple people</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {payerMode === "multiple" && (
            <ul className="divide-y rounded-lg border">
              {participants.map((p) => (
                <PersonRow key={p.id} person={p} meId={meId}>
                  <AmountInput
                    label={`Paid by ${p.name}`}
                    value={payerAmounts[p.id] ?? ""}
                    suffix={currency}
                    onChange={(v) => setPayerAmounts((a) => ({ ...a, [p.id]: v }))}
                  />
                </PersonRow>
              ))}
            </ul>
          )}
          {hasTotal && errorFor("paidBy") && <FieldMessage error={submitted}>{errorFor("paidBy")}</FieldMessage>}
        </section>

        {/* ------------------------------------------------------------------ split */}
        <section className="space-y-3">
          <div className="space-y-2">
            <Label>Split</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={splitType}
              onValueChange={(v) => v && setSplitType(v as SplitType)}
              className="grid w-full grid-cols-3 gap-1 sm:grid-cols-6"
            >
              {SPLIT_TYPES.map((t) => (
                <ToggleGroupItem key={t.value} value={t.value} aria-label={t.hint} className="px-2">
                  {t.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">{SPLIT_TYPES.find((t) => t.value === splitType)?.hint}</p>
          </div>

          {splitType === "equal" && (
            <ul className="divide-y rounded-lg border">
              {participants.map((p) => {
                const on = equalIds.includes(p.id);
                return (
                  <PersonRow
                    key={p.id}
                    person={p}
                    meId={meId}
                    amount={on ? shareById.get(p.id) : undefined}
                    money={money}
                  >
                    <Checkbox
                      checked={on}
                      aria-label={`Include ${p.name}`}
                      onCheckedChange={(checked) =>
                        setEqualIds((ids) => (checked ? [...ids, p.id] : ids.filter((id) => id !== p.id)))
                      }
                      className="size-5"
                    />
                  </PersonRow>
                );
              })}
            </ul>
          )}

          {(splitType === "exact" ||
            splitType === "percentage" ||
            splitType === "shares" ||
            splitType === "adjustment") && (
            <ul className="divide-y rounded-lg border">
              {participants.map((p) => (
                <PersonRow key={p.id} person={p} meId={meId} amount={shareById.get(p.id)} money={money}>
                  <AmountInput
                    label={`${p.name} ${splitType}`}
                    value={values[splitType][p.id] ?? ""}
                    suffix={VALUE_SUFFIX[splitType](currency)}
                    onChange={(v) => setValues((all) => ({ ...all, [splitType]: { ...all[splitType], [p.id]: v } }))}
                  />
                </PersonRow>
              ))}
            </ul>
          )}

          {splitType === "itemized" && itemized && (
            <ItemAssigner
              lines={lines}
              setLines={setLines}
              people={participants}
              meId={meId}
              currency={currency}
              preview={itemized}
            />
          )}

          {hasTotal && errorFor("split") && !(splitType === "itemized" && blockedByUnassigned) && (
            <FieldMessage error={submitted}>{errorFor("split")}</FieldMessage>
          )}
        </section>

        {/* ------------------------------------------------------------------ extras */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="attachments">Attachments</Label>
            <label
              htmlFor="attachments"
              className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground hover:bg-accent"
            >
              <Paperclip className="size-4" aria-hidden />
              Add files
            </label>
            <input
              id="attachments"
              type="file"
            accept={ATTACHMENT_MIME_TYPES.join(",")}
              multiple
              className="sr-only"
              onChange={(e) => {
                const chosen = [...(e.target.files ?? [])];
                const tooBig = chosen.filter((f) => f.size > ATTACHMENT_MAX_BYTES);
                if (tooBig.length) toast.error(`${tooBig.map((f) => f.name).join(", ")}: max 10 MB per file`);
                setFiles((fs) => [...fs, ...chosen.filter((f) => f.size <= ATTACHMENT_MAX_BYTES)]);
                e.target.value = "";
              }}
            />
          </div>
        </section>
        {files.length > 0 && (
          <ul className="space-y-1 text-sm">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                <Paperclip className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="truncate">{f.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} />
        </div>

        {splitwise && !expenseId && (
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor="post-splitwise" className="flex-col items-start gap-0.5">
              <span>Also post to Splitwise</span>
              <span className="text-xs font-normal text-muted-foreground" id="post-splitwise-hint">
                {notOnSplitwise.length > 0
                  ? `${notOnSplitwise.map((p) => p.name).join(", ")} ${notOnSplitwise.length === 1 ? "isn't" : "aren't"} on Splitwise.`
                  : preview.ok && preview.expense.total < 0
                    ? "Splitwise doesn't support refunds."
                    : "Adds the same expense and split on Splitwise."}
              </span>
            </Label>
            <Switch
              id="post-splitwise"
              aria-describedby="post-splitwise-hint"
              checked={postToSplitwise && !postBlocked}
              disabled={postBlocked}
              onCheckedChange={(on) => {
                setPostToSplitwise(on);
                try {
                  localStorage.setItem(POST_PREF_KEY, on ? "1" : "0");
                } catch {}
              }}
            />
          </div>
        )}
      </div>

      <footer className="border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        {itemized && (
          <div
            className="mb-3 flex items-center gap-2 overflow-x-auto"
            aria-live="polite"
            aria-label="Per-person totals"
          >
            {participants.map((p) => {
              const owed = itemized.breakdown.find((b) => b.participantId === p.id)?.owed;
              return (
                <span
                  key={p.id}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs"
                >
                  <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} className="size-6" />
                  <span className="sr-only">{p.id === meId ? "You" : p.name}</span>
                  <span className="tabular-nums">{owed !== undefined ? money(owed) : money(0)}</span>
                </span>
              );
            })}
            {itemized.unassigned.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  document.querySelector("[data-unassigned]")?.scrollIntoView({ behavior: "smooth", block: "center" })
                }
                className="flex shrink-0 items-center gap-1 rounded-full border border-amber-500/70 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-800 dark:text-amber-300"
              >
                <AlertTriangle className="size-3.5" aria-hidden />
                {itemized.unassigned.length} unassigned · {money(itemized.unassignedTotal)}
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-3">
          {serverError && (
            <p className="flex-1 text-sm text-destructive" role="alert">
              {serverError}
            </p>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || blockedByUnassigned}
              title={blockedByUnassigned ? "Assign every item first" : undefined}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </footer>
    </form>
  );
}

function FieldMessage({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <p
      className={cn("text-sm", error ? "text-destructive" : "text-muted-foreground")}
      role={error ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

function PersonRow({
  person,
  meId,
  amount,
  money,
  children,
}: {
  person: FormPerson;
  meId: string;
  amount?: number;
  money?: (amount: number) => string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <PersonAvatar name={person.name} avatarUrl={person.avatarUrl} className="size-8" />
      <span className="min-w-0 flex-1 truncate text-sm">{person.id === meId ? "You" : person.name}</span>
      {amount !== undefined && money && (
        <span className="text-sm text-muted-foreground tabular-nums">{money(amount)}</span>
      )}
      {children}
    </li>
  );
}

function AmountInput({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: string;
  suffix: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        aria-label={label}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-24 text-right tabular-nums"
        placeholder="0"
      />
      <span className="w-12 text-xs text-muted-foreground">{suffix}</span>
    </div>
  );
}
