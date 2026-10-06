import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DangerZone } from "@/components/groups/danger-zone";
import { GroupSettingsForm } from "@/components/groups/group-settings-form";
import { MembersManager } from "@/components/groups/members-manager";
import { Separator } from "@/components/ui/separator";
import { requireUser } from "@/lib/auth";
import { getGroup } from "@/lib/db/groups";
import { listInvites } from "@/lib/db/invites";

export const metadata: Metadata = { title: "Group settings · SplitLens" };

export default async function GroupSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, supabase } = await requireUser();
  const group = await getGroup(supabase, id);
  if (!group || !group.members.some((m) => m.userId === user.id)) notFound();
  const invites = await listInvites(supabase, id);

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/groups/${id}`} className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          {group.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Group settings</h1>
      </div>
      <GroupSettingsForm key={group.defaultSplitType + group.members.length} group={group} />
      <Separator />
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Members</h2>
        <MembersManager groupId={id} members={group.members} invites={invites} myUserId={user.id} />
      </section>
      <Separator />
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Leave or delete</h2>
        <DangerZone groupId={id} groupName={group.name} />
      </section>
    </div>
  );
}
