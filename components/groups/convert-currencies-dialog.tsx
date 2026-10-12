"use client";

import { ArrowLeftRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { convertCurrenciesAction, previewConversionAction, type ConversionPreview } from "@/app/(app)/groups/conversion-actions";
import { BalanceList, Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

/**
 * "Convert all to USD": previews every member's balance in one currency at today's ECB
 * reference rate, then records it as "Currency conversion" expenses (delete them to undo).
 */
export function ConvertCurrenciesDialog({
  groupId,
  currencies,
  defaultTarget,
  targets,
  names,
}: {
  groupId: string;
  /** Currencies the group currently has balances in. */
  currencies: string[];
  defaultTarget: string;
  /** Currencies we can convert into. */
  targets: string[];
  names: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(defaultTarget);
  const [preview, setPreview] = useState<ConversionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  const load = (to: string) =>
    startLoading(async () => {
      setError(null);
      setPreview(null);
      const result = await previewConversionAction({ groupId, target: to });
      if (result.ok) setPreview(result.preview);
      else setError(result.error);
    });

  const confirm = () =>
    startSaving(async () => {
      if (!preview) return;
      const result = await convertCurrenciesAction({
        groupId,
        target,
        expected: preview.after,
        date: new Date().toLocaleDateString("en-CA"),
      });
      if (!result.ok) {
        setError(result.error);
        load(target);
        return;
      }
      toast.success(`Balances converted to ${target}`);
      setOpen(false);
      router.refresh();
    });

  const people = preview ? [...new Set([...Object.values(preview.before).flatMap(Object.keys), ...Object.keys(preview.after)])] : [];
  const nothing = preview && preview.rates.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) load(target);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowLeftRight /> Convert all to {defaultTarget}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convert balances to one currency</DialogTitle>
          <DialogDescription>
            Balances in {currencies.filter((c) => c !== target).join(", ") || "other currencies"} become {target} at today&apos;s reference
            rate, so everyone settles in one currency.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <Label htmlFor="convert-target" className="shrink-0">
            Convert to
          </Label>
          <Select
            value={target}
            onValueChange={(v) => {
              if (!v) return;
              setTarget(v);
              load(v);
            }}
          >
            <SelectTrigger id="convert-target" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targets.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Getting today&apos;s rates…
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {preview && !loading && (
          <div className="space-y-4 text-sm">
            {preview.rates.length > 0 && (
              <p className="rounded-md bg-muted/60 p-2 text-xs">
                {preview.rates.map((r) => `1 ${preview.target} = ${r.rate} ${r.currency}`).join(" · ")}
                <br />
                <span className="text-muted-foreground">
                  {preview.source}
                  {preview.rateDate && `, ${dateFormat.format(new Date(`${preview.rateDate}T00:00:00Z`))}`}
                </span>
              </p>
            )}
            {preview.missing.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                No reference rate for {preview.missing.join(", ")}; those balances stay as they are.
              </p>
            )}
            {nothing ? (
              <p className="text-muted-foreground">Nothing to convert: everything is already in {preview.target}.</p>
            ) : (
              <>
                <table className="w-full">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-1 font-normal">Person</th>
                      <th className="pb-1 font-normal">Now</th>
                      <th className="pb-1 text-right font-normal">In {preview.target}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {people.map((id) => (
                      <tr key={id}>
                        <td className="py-1.5 pr-2">{names[id] ?? "Someone"}</td>
                        <td className="py-1.5 pr-2 text-xs">
                          <BalanceList
                            balances={Object.fromEntries(Object.entries(preview.before).map(([c, byId]) => [c, byId[id] ?? 0]))}
                            positive="gets back"
                            negative="owes"
                          />
                        </td>
                        <td className="py-1.5 text-right">
                          {preview.after[id] ? <Money amount={preview.after[id]!} currency={preview.target} tone /> : <span className="text-muted-foreground">settled</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.payments.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium">Then to settle up</p>
                    <ul className="space-y-0.5 text-xs">
                      {preview.payments.map((d) => (
                        <li key={`${d.from}-${d.to}`}>
                          {names[d.from] ?? "Someone"} → {names[d.to] ?? "someone"}: <Money amount={d.amount} currency={d.currency} className="font-medium" />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  This adds two &quot;Currency conversion&quot; entries per currency to the group, visible to everyone. To undo, delete both entries.
                </p>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!preview || loading || saving || Boolean(nothing)}>
            {saving && <Loader2 className="animate-spin" />} Convert to {target}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
