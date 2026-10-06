import { Banknote, MessageSquare, Receipt, UserPlus, Users, Zap, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/money";
import type { ActivityItem } from "@/lib/db/activity";
import { cn } from "@/lib/utils";
import { describeActivity, type ActivityKind } from "./describe";

const ICONS: Record<ActivityKind, LucideIcon> = {
  expense: Receipt,
  payment: Banknote,
  comment: MessageSquare,
  group: Users,
  member: UserPlus,
  friend: UserPlus,
  other: Zap,
};

const timeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export function ActivityFeed({ items, meUserId }: { items: ActivityItem[]; meUserId: string }) {
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((item) => {
        const d = describeActivity(item, meUserId);
        const Icon = ICONS[d.kind];
        const body = (
          <>
            <span
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted",
                d.kind === "payment" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
              )}
              aria-hidden
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm break-words", d.deleted && "text-muted-foreground line-through")}>{d.text}</span>
              <time dateTime={item.createdAt} className="text-xs text-muted-foreground">
                {timeFormat.format(new Date(item.createdAt))}
              </time>
            </span>
            {d.impact && d.impact.amount !== 0 && (
              <span className="shrink-0 text-right text-xs">
                <span className="block text-muted-foreground">
                  {d.kind === "payment" ? (d.impact.amount > 0 ? "you paid" : "you received") : d.impact.amount > 0 ? "you get back" : "you owe"}
                </span>
                <Money amount={d.impact.amount} currency={d.impact.currency} tone={d.kind !== "payment"} absolute className="text-sm font-medium" />
              </span>
            )}
          </>
        );
        return (
          <li key={item.id}>
            {d.href && !(d.kind === "group" && d.deleted) ? (
              <Link href={d.href} className="flex items-start gap-3 px-3 py-3 hover:bg-accent/50">
                {body}
              </Link>
            ) : (
              <div className="flex items-start gap-3 px-3 py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
