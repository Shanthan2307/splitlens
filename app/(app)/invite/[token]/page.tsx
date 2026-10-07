import type { Metadata } from "next";
import Link from "next/link";
import { GroupAvatar } from "@/components/groups/group-type";
import { FriendInviteAccept, InviteJoin } from "@/components/groups/invite-join";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getInvite } from "@/lib/db/invites";

export const metadata: Metadata = { title: "Invite · SplitLens" };

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
        ) : invite.kind === "friend" ? (
          <>
            <CardHeader className="items-center text-center">
              <PersonAvatar name={invite.inviterName ?? "?"} avatarUrl={null} className="mx-auto size-14" />
              <CardTitle className="text-xl">{invite.inviterName ?? "Someone"} invited you to SplitLens</CardTitle>
              <CardDescription>
                {invite.self
                  ? "This is your own invite link. Send it to a friend."
                  : "Become friends to share expenses. Anything they imported from Splitwise with you can then be brought over."}
              </CardDescription>
            </CardHeader>
            {!invite.self && (
              <CardContent>
                {invite.alreadyFriends ? (
                  <Button asChild className="w-full">
                    <Link href={`/friends/${invite.inviterId}`}>You&apos;re already friends. Open</Link>
                  </Button>
                ) : (
                  <FriendInviteAccept token={token} name={invite.inviterName ?? "them"} />
                )}
              </CardContent>
            )}
          </>
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
