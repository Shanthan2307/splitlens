import { Heart, House, Plane, Users, type LucideIcon } from "lucide-react";
import type { Enums } from "@/lib/db/client";
import { cn } from "@/lib/utils";

export const GROUP_TYPE_META: Record<Enums<"group_type">, { label: string; icon: LucideIcon }> = {
  home: { label: "Home", icon: House },
  trip: { label: "Trip", icon: Plane },
  couple: { label: "Couple", icon: Heart },
  other: { label: "Other", icon: Users },
};

export function GroupAvatar({
  type,
  coverUrl,
  className,
}: {
  type: Enums<"group_type">;
  coverUrl: string | null;
  className?: string;
}) {
  const Icon = GROUP_TYPE_META[type].icon;
  return coverUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- Supabase storage URL, sized by CSS
    <img src={coverUrl} alt="" className={cn("size-12 shrink-0 rounded-lg object-cover", className)} />
  ) : (
    <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary", className)}>
      <Icon className="size-6" aria-hidden />
    </span>
  );
}
