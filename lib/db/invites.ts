import { dbError, type DbClient, type Enums } from "./client";

export type InviteLink = { id: string; token: string; memberId: string | null; createdAt: string };

export async function createInvite(db: DbClient, userId: string, groupId: string, memberId?: string): Promise<InviteLink> {
  const { data, error } = await db
    .from("invite_links")
    .insert({ created_by: userId, group_id: groupId, member_id: memberId ?? null })
    .select("id, token, member_id, created_at")
    .single();
  if (error) throw dbError("Could not create invite link", error);
  return { id: data.id, token: data.token, memberId: data.member_id, createdAt: data.created_at };
}

/** Invite someone to become friends with `userId` (e.g. a Splitwise friend who isn't on SplitLens yet). Reuses an open link. */
export async function friendInvite(db: DbClient, userId: string): Promise<string> {
  const { data: existing, error: readError } = await db
    .from("invite_links")
    .select("token")
    .eq("created_by", userId)
    .is("group_id", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) throw dbError("Could not load invite link", readError);
  if (existing) return existing.token;
  const { data, error } = await db.from("invite_links").insert({ created_by: userId }).select("token").single();
  if (error) throw dbError("Could not create invite link", error);
  return data.token;
}

export async function listInvites(db: DbClient, groupId: string): Promise<InviteLink[]> {
  const { data, error } = await db
    .from("invite_links")
    .select("id, token, member_id, created_at")
    .eq("group_id", groupId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw dbError("Could not load invite links", error);
  return data.map((d) => ({ id: d.id, token: d.token, memberId: d.member_id, createdAt: d.created_at }));
}

export async function revokeInvite(db: DbClient, inviteId: string) {
  const { error } = await db.from("invite_links").update({ revoked_at: new Date().toISOString() }).eq("id", inviteId);
  if (error) throw dbError("Could not revoke invite link", error);
}

export type InviteInfo =
  | { valid: false; reason: "not_found" | "group_deleted" | "revoked" | "expired" | "used_up" }
  | {
      valid: true;
      kind: "group";
      group: { id: string; name: string; type: Enums<"group_type"> };
      inviterName: string | null;
      memberCount: number;
      alreadyMember: boolean;
      claimMemberId: string | null;
      placeholders: { id: string; name: string }[];
    }
  | { valid: true; kind: "friend"; inviterId: string; inviterName: string | null; self: boolean; alreadyFriends: boolean };

export async function getInvite(db: DbClient, token: string): Promise<InviteInfo> {
  const { data, error } = await db.rpc("get_invite", { p_token: token });
  if (error) throw dbError("Could not load invite", error);
  const d = data as Record<string, unknown>;
  if (!d.valid) return { valid: false, reason: d.reason as Extract<InviteInfo, { valid: false }>["reason"] };
  if (d.kind === "friend") {
    return {
      valid: true,
      kind: "friend",
      inviterId: d.inviter_id as string,
      inviterName: (d.inviter_name as string | null) ?? null,
      self: Boolean(d.self),
      alreadyFriends: Boolean(d.already_friends),
    };
  }
  return {
    valid: true,
    kind: "group",
    group: d.group as Extract<InviteInfo, { kind: "group" }>["group"],
    inviterName: (d.inviter_name as string | null) ?? null,
    memberCount: Number(d.member_count),
    alreadyMember: Boolean(d.already_member),
    claimMemberId: (d.claim_member_id as string | null) ?? null,
    placeholders: d.placeholders as { id: string; name: string }[],
  };
}

export async function redeemInvite(db: DbClient, token: string, claimMemberId: string | null): Promise<string> {
  const { data, error } = await db.rpc("redeem_invite", { p_token: token, p_claim_member_id: claimMemberId ?? undefined });
  if (error) throw dbError("Could not join group", error);
  return data;
}

/** Becomes friends with the link's creator. Returns their user id. */
export async function redeemFriendInvite(db: DbClient, token: string): Promise<string> {
  const { data, error } = await db.rpc("redeem_friend_invite", { p_token: token });
  if (error) throw dbError("Could not accept invite", error);
  return data;
}
