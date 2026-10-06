"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createGroupAction } from "@/app/(app)/groups/actions";
import { GROUP_TYPE_META } from "@/components/groups/group-type";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CURRENCY_CODES } from "@/lib/currencies";
import { GROUP_TYPES } from "@/lib/validation/group";

export function CreateGroupDialog({ defaultCurrency }: { defaultCurrency: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof GROUP_TYPES)[number]>("trip");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [simplify, setSimplify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createGroupAction({ name, type, defaultCurrency: currency, simplifyDebts: simplify });
      if (!result.ok) return setError(result.error);
      toast.success("Group created");
      setOpen(false);
      router.push(`/groups/${result.groupId}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          New group
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Start a new group</DialogTitle>
            <DialogDescription>You can add people after creating it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <ToggleGroup type="single" variant="outline" value={type} onValueChange={(v) => v && setType(v as typeof type)} className="w-full">
              {GROUP_TYPES.map((t) => {
                const { label, icon: Icon } = GROUP_TYPE_META[t];
                return (
                  <ToggleGroupItem key={t} value={t} className="flex-1 gap-1.5">
                    <Icon aria-hidden />
                    {label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>
          <div className="space-y-2">
            <Label htmlFor="group-currency">Default currency</Label>
            <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
              <SelectTrigger id="group-currency" className="w-full">
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
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="group-simplify" className="flex flex-col items-start gap-1">
              Simplify debts
              <span className="text-xs font-normal text-muted-foreground">Settle up with the fewest payments.</span>
            </Label>
            <Switch id="group-simplify" checked={simplify} onCheckedChange={setSimplify} />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
