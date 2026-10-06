"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function GroupFilter({ groups, value }: { groups: { id: string; name: string }[]; value: string | undefined }) {
  const router = useRouter();
  return (
    <Select
      value={value ?? "all"}
      onValueChange={(v) => v && router.push(v === "all" ? "/activity" : `/activity?group=${v}`)}
    >
      <SelectTrigger aria-label="Filter by group" className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All activity</SelectItem>
        {groups.map((g) => (
          <SelectItem key={g.id} value={g.id}>
            {g.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
