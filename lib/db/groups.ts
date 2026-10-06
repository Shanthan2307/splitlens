import type { Enums } from "./client";
import { DbError, dbError, type DbClient } from "./client";
import { PROFILE_LITE, type Person, type ProfileLite } from "./people";

export type GroupMember = Person & {
  memberId: string;
  role: Enums<"group_role">;
  defaultSplitWeight: number | null;
  placeholderEmail: string | null;
};

export type GroupSummary = {
  id: string;
  name: string;
  type: Enums<"group_type">;
  coverUrl: string | null;
  defaultCurrency: string;
};

export type GroupDetail = GroupSummary & {
  coverImagePath: string | null;
  defaultSplitType: "equal" | "percentage" | "shares";
  simplifyDebts: boolean;
  createdBy: string | null;
  members: GroupMember[];
  /** Includes former members, so old expenses can still show their names. */
  allMembers: GroupMember[];
};

export function coverUrl(db: DbClient, path: string | null): string | null {
  return path ? db.storage.from("group-covers").getPublicUrl(path).data.publicUrl : null;
}

const GROUP_COLUMNS = "id, name, type, cover_image_path, default_currency" as const;

export async function listMyGroups(db: DbClient, userId: string): Promise<GroupSummary[]> {
  const { data, error } = await db
    .from("group_members")
    .select(`group:groups!inner(${GROUP_COLUMNS}, updated_at)`)
    .eq("user_id", userId)
    .is("left_at", null)
    .is("group.deleted_at", null);
  if (error) throw dbError("Could not load groups", error);
  return data
    .map((row) => row.group)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      coverUrl: coverUrl(db, g.cover_image_path),
      defaultCurrency: g.default_currency,
    }));
}

type MemberRow = {
  id: string;
  user_id: string | null;
  placeholder_name: string | null;
  placeholder_email: string | null;
  role: Enums<"group_role">;
  default_split_weight: number | null;
  left_at: string | null;
  profile: ProfileLite | null;
};

function toMember(m: MemberRow): GroupMember {
  return {
    id: m.id,
    memberId: m.id,
    userId: m.user_id,
    name: m.profile?.display_name || m.placeholder_name || m.profile?.email?.split("@")[0] || "Someone",
    avatarUrl: m.profile?.avatar_url ?? null,
    email: m.profile?.email ?? m.placeholder_email,
    isPlaceholder: m.user_id === null,
    venmoUsername: m.profile?.venmo_username ?? null,
    paypalUsername: m.profile?.paypal_username ?? null,
    role: m.role,
    defaultSplitWeight: m.default_split_weight,
    placeholderEmail: m.placeholder_email,
  };
}

export async function getGroup(db: DbClient, groupId: string): Promise<GroupDetail | null> {
  const { data, error } = await db
    .from("groups")
    .select(
      `${GROUP_COLUMNS}, default_split_type, simplify_debts, created_by, deleted_at,
       group_members(id, user_id, placeholder_name, placeholder_email, role, default_split_weight, left_at, joined_at,
                     profile:profiles(${PROFILE_LITE}))`,
    )
    .eq("id", groupId)
    .maybeSingle();
  if (error) throw dbError("Could not load group", error);
  if (!data || data.deleted_at) return null;

  const all = [...data.group_members].sort((a, b) => a.joined_at.localeCompare(b.joined_at)).map((m) => ({ row: m, member: toMember(m) }));
  return {
    id: data.id,
    name: data.name,
    type: data.type,
    coverImagePath: data.cover_image_path,
    coverUrl: coverUrl(db, data.cover_image_path),
    defaultCurrency: data.default_currency,
    defaultSplitType: data.default_split_type as GroupDetail["defaultSplitType"],
    simplifyDebts: data.simplify_debts,
    createdBy: data.created_by,
    members: all.filter((m) => m.row.left_at === null).map((m) => m.member),
    allMembers: all.map((m) => m.member),
  };
}

export async function createGroup(
  db: DbClient,
  input: { name: string; type: Enums<"group_type">; defaultCurrency: string; simplifyDebts: boolean },
): Promise<string> {
  const { data, error } = await db.rpc("create_group", {
    p_name: input.name,
    p_type: input.type,
    p_default_currency: input.defaultCurrency,
    p_simplify_debts: input.simplifyDebts,
  });
  if (error) throw dbError("Could not create group", error);
  return data;
}

export type GroupPatch = {
  name?: string;
  type?: Enums<"group_type">;
  default_currency?: string;
  default_split_type?: "equal" | "percentage" | "shares";
  simplify_debts?: boolean;
  cover_image_path?: string | null;
  member_weights?: { member_id: string; weight: number | null }[];
};

export async function updateGroup(db: DbClient, groupId: string, patch: GroupPatch) {
  const { error } = await db.rpc("update_group", { p_group_id: groupId, p_patch: patch });
  if (error) throw dbError("Could not update group", error);
}

export type AddMemberStatus = "added" | "rejoined" | "invited" | "placeholder" | "already_member";

export async function addGroupMember(
  db: DbClient,
  input: { groupId: string; email?: string; name?: string },
): Promise<{ memberId: string; status: AddMemberStatus }> {
  const { data, error } = await db.rpc("add_group_member", {
    p_group_id: input.groupId,
    p_email: input.email ?? "",
    p_name: input.name ?? "",
  });
  if (error) throw dbError("Could not add member", error);
  const result = data as { member_id: string; status: AddMemberStatus };
  return { memberId: result.member_id, status: result.status };
}

export async function removeGroupMember(db: DbClient, memberId: string) {
  const { error } = await db.rpc("remove_group_member", { p_member_id: memberId });
  if (error) throw dbError("Could not remove member", error);
}

export async function deleteGroup(db: DbClient, groupId: string) {
  const { error } = await db.rpc("delete_group", { p_group_id: groupId });
  if (error) throw dbError("Could not delete group", error);
}

/** Uploads a cover image and returns its storage path. */
export async function uploadGroupCover(db: DbClient, groupId: string, file: File): Promise<string> {
  const path = `${groupId}/cover-${Date.now()}`;
  const { error } = await db.storage.from("group-covers").upload(path, file, { contentType: file.type, cacheControl: "31536000" });
  if (error) throw new DbError("Could not upload cover image", error);
  return path;
}
