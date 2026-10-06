import type { Metadata } from "next";
import Link from "next/link";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { GroupFilter } from "@/components/activity/group-filter";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { listActivity } from "@/lib/db/activity";
import { listMyGroups } from "@/lib/db/groups";

export const metadata: Metadata = { title: "Activity · SplitLens" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ group?: string; before?: string }> }) {
  const { group, before } = await searchParams;
  const { user, supabase } = await requireUser();
  const groups = await listMyGroups(supabase, user.id);
  const groupId = groups.some((g) => g.id === group) ? group : undefined;
  const cursor = before && /^\d+$/.test(before) ? Number(before) : undefined;
  const { items, nextCursor } = await listActivity(supabase, { groupId, before: cursor });
  const query = (extra: Record<string, string>) =>
    `/activity?${new URLSearchParams({ ...(groupId ? { group: groupId } : {}), ...extra }).toString()}`;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Activity" description="Every expense, payment and comment you can see." />
        {groups.length > 0 && <GroupFilter groups={groups.map((g) => ({ id: g.id, name: g.name }))} value={groupId} />}
      </div>
      {items.length === 0 ? (
        <EmptyState title={cursor ? "No older activity" : "No activity yet"}>
          {groupId ? "Nothing has happened in this group yet." : "Expenses, payments and comments will show up here."}
        </EmptyState>
      ) : (
        <ActivityFeed items={items} meUserId={user.id} />
      )}
      <div className="mt-4 flex justify-between gap-2">
        {cursor ? (
          <Button asChild variant="ghost">
            <Link href={query({})}>Newest</Link>
          </Button>
        ) : (
          <span />
        )}
        {nextCursor && (
          <Button asChild variant="outline">
            <Link href={query({ before: String(nextCursor) })}>Older</Link>
          </Button>
        )}
      </div>
    </>
  );
}
