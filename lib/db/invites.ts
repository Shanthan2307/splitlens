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
      group: { id: string; name: string; type: Enums<"group_type"> };
      inviterName: string | null;
      memberCount: number;
      alreadyMember: boolean;
      claimMemberId: string | null;
      placeholders: { id: string; name: string }[];
    };

export async function getInvite(db: DbClient, token: string): Promise<InviteInfo> {
  const { data, error } = await db.rpc("get_invite", { p_token: token });
  if (error) throw dbError("Could not load invite", error);
  const d = data as Record<string, unknown>;
  if (!d.valid) return { valid: false, reason: d.reason as Extract<InviteInfo, { valid: false }>["reason"] };
  return {
    valid: true,
    group: d.group as Extract<InviteInfo, { valid: true }>["group"],
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
