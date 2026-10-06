import type { Metadata } from "next";
import Link from "next/link";
import { GroupAvatar } from "@/components/groups/group-type";
import { InviteJoin } from "@/components/groups/invite-join";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getInvite } from "@/lib/db/invites";

export const metadata: Metadata = { title: "Join group · SplitLens" };

const REASONS = {
  not_found: "This invite link doesn't exist.",
  group_deleted: "This group has been deleted.",
  revoked: "This invite link was turned off.",
  expired: "This invite link has expired.",
  used_up: "This invite link has already been used.",
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { supabase } = await requireUser();
  const invite = await getInvite(supabase, token);

  return (
    <div className="mx-auto max-w-md pt-4">
      <Card>
        {!invite.valid ? (
          <CardHeader>
            <CardTitle>Invite unavailable</CardTitle>
            <CardDescription>{REASONS[invite.reason]} Ask a group member for a new link.</CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader className="items-center text-center">
              <GroupAvatar type={invite.group.type} coverUrl={null} className="mx-auto size-14" />
              <CardTitle className="text-xl">{invite.group.name}</CardTitle>
              <CardDescription>
                {invite.inviterName ? `${invite.inviterName} invited you` : "You're invited"} · {invite.memberCount}{" "}
                {invite.memberCount === 1 ? "member" : "members"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {invite.alreadyMember ? (
                <Button asChild className="w-full">
                  <Link href={`/groups/${invite.group.id}`}>You&apos;re already a member. Open group</Link>
                </Button>
              ) : (
                <InviteJoin token={token} placeholders={invite.placeholders} claimMemberId={invite.claimMemberId} />
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
