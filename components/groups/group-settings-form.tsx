"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateGroupAction, uploadGroupCoverAction } from "@/app/(app)/groups/actions";
import { GROUP_TYPE_META, GroupAvatar } from "@/components/groups/group-type";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CURRENCY_CODES } from "@/lib/currencies";
import type { GroupDetail } from "@/lib/db/groups";
import { formatScaled } from "@/lib/splits";
import { DEFAULT_SPLIT_TYPES, GROUP_COVER_MIME_TYPES, GROUP_TYPES } from "@/lib/validation/group";

type SplitType = (typeof DEFAULT_SPLIT_TYPES)[number];

function weightToString(type: SplitType, weight: number | null) {
  if (weight === null || type === "equal") return "";
  return type === "percentage" ? formatScaled(weight, 2) : String(weight);
}

export function GroupSettingsForm({ group }: { group: GroupDetail }) {
  const router = useRouter();
  const [name, setName] = useState(group.name);
  const [type, setType] = useState(group.type);
  const [currency, setCurrency] = useState(group.defaultCurrency);
  const [simplify, setSimplify] = useState(group.simplifyDebts);
  const [splitType, setSplitType] = useState<SplitType>(group.defaultSplitType);
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(group.members.map((m) => [m.memberId, weightToString(group.defaultSplitType, m.defaultSplitWeight)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const changeSplitType = (next: SplitType) => {
    setSplitType(next);
    // Reasonable starting values when switching.
    if (next === "shares") setWeights(Object.fromEntries(group.members.map((m) => [m.memberId, "1"])));
    if (next === "percentage") setWeights(Object.fromEntries(group.members.map((m) => [m.memberId, ""])));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateGroupAction({
        groupId: group.id,
        name,
        type,
        defaultCurrency: currency,
        simplifyDebts: simplify,
        defaultSplitType: splitType,
        memberWeights: group.members.map((m) => ({ memberId: m.memberId, value: weights[m.memberId] ?? "" })),
      });
      if (!result.ok) return setError(result.error);
      toast.success("Group settings saved");
      router.refresh();
    });
  };

  const uploadCover = (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("groupId", group.id);
    fd.set("cover", file);
    startTransition(async () => {
      const result = await uploadGroupCoverAction(fd);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Cover image updated");
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="flex items-center gap-4">
        <GroupAvatar type={type} coverUrl={group.coverUrl} className="size-16" />
        <div className="space-y-1">
          <Label htmlFor="cover">Cover image</Label>
          <Input
            id="cover"
            type="file"
            accept={GROUP_COVER_MIME_TYPES.join(",")}
            onChange={(e) => uploadCover(e.target.files?.[0])}
            disabled={pending}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
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
        <Label htmlFor="currency">Default currency</Label>
        <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
          <SelectTrigger id="currency" className="w-full">
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
        <Label htmlFor="simplify" className="flex flex-col items-start gap-1">
          Simplify debts
          <span className="text-xs font-normal text-muted-foreground">
            Combine debts so everyone settles up with the fewest payments.
          </span>
        </Label>
        <Switch id="simplify" checked={simplify} onCheckedChange={setSimplify} />
      </div>

      <div className="space-y-3">
        <Label>Default split for new expenses</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={splitType}
          onValueChange={(v) => v && changeSplitType(v as SplitType)}
          className="w-full"
        >
          <ToggleGroupItem value="equal" className="flex-1">Equally</ToggleGroupItem>
          <ToggleGroupItem value="percentage" className="flex-1">By %</ToggleGroupItem>
          <ToggleGroupItem value="shares" className="flex-1">By shares</ToggleGroupItem>
        </ToggleGroup>
        {splitType !== "equal" && (
          <ul className="divide-y rounded-lg border">
            {group.members.map((m) => (
              <li key={m.memberId} className="flex items-center gap-3 px-3 py-2">
                <PersonAvatar name={m.name} avatarUrl={m.avatarUrl} className="size-8" />
                <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                <Input
                  aria-label={`${m.name} default ${splitType}`}
                  inputMode="decimal"
                  value={weights[m.memberId] ?? ""}
                  onChange={(e) => setWeights((w) => ({ ...w, [m.memberId]: e.target.value }))}
                  className="h-9 w-20 text-right"
                />
                <span className="w-12 text-xs text-muted-foreground">{splitType === "percentage" ? "%" : "shares"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
