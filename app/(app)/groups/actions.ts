"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { userMessage, type DbClient } from "@/lib/db/client";
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  getGroup,
  removeGroupMember,
  updateGroup,
  uploadGroupCover,
  type AddMemberStatus,
} from "@/lib/db/groups";
import { createInvite, revokeInvite } from "@/lib/db/invites";
import { loadGroupLedger } from "@/lib/db/ledger";
import { netBalances, parseBasisPoints, parseScaled, SplitError } from "@/lib/splits";
import { addMemberSchema, createGroupSchema, groupCoverSchema, updateGroupSchema } from "@/lib/validation/group";
import { firstIssue, type ActionResult } from "@/lib/validation/result";

const idSchema = z.uuid();

function revalidateGroup(groupId: string) {
  revalidatePath(`/groups/${groupId}`, "layout");
  revalidatePath("/groups");
}

export async function createGroupAction(input: unknown): Promise<ActionResult<{ groupId: string }>> {
  const parsed = createGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const { supabase } = await requireUser();
  try {
    const groupId = await createGroup(supabase, parsed.data);
    revalidatePath("/groups");
    return { ok: true, groupId };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not create the group.") };
  }
}

export async function updateGroupAction(input: unknown): Promise<ActionResult> {
  const parsed = updateGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const { groupId, defaultSplitType, memberWeights, ...rest } = parsed.data;

  let weights: { member_id: string; weight: number | null }[];
  try {
    weights = memberWeights.map((w) => ({
      member_id: w.memberId,
      weight:
        defaultSplitType === "equal" || w.value === ""
          ? null
          : defaultSplitType === "percentage"
            ? parseBasisPoints(w.value)
            : parseScaled(w.value, 0),
    }));
  } catch (error) {
    return { ok: false, error: error instanceof SplitError ? error.message : "Invalid default split", field: "memberWeights" };
  }

  const { supabase } = await requireUser();
  try {
    await updateGroup(supabase, groupId, {
      name: rest.name,
      type: rest.type,
      default_currency: rest.defaultCurrency,
      simplify_debts: rest.simplifyDebts,
      default_split_type: defaultSplitType,
      member_weights: weights,
    });
    revalidateGroup(groupId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not save group settings.") };
  }
}

export async function uploadGroupCoverAction(formData: FormData): Promise<ActionResult> {
  const groupId = idSchema.safeParse(formData.get("groupId"));
  const file = groupCoverSchema.safeParse(formData.get("cover"));
  if (!groupId.success) return { ok: false, error: "Invalid group" };
  if (!file.success) return { ok: false, ...firstIssue(file.error) };
  const { supabase } = await requireUser();
  try {
    const path = await uploadGroupCover(supabase, groupId.data, file.data);
    await updateGroup(supabase, groupId.data, { cover_image_path: path });
    revalidateGroup(groupId.data);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not upload the cover image.") };
  }
}

const ADD_MEMBER_MESSAGES: Record<AddMemberStatus, string> = {
  added: "Added to the group.",
  rejoined: "Added back to the group.",
  invited: "Not on SplitLens yet. Added as a placeholder; they'll be linked when they sign up with that email.",
  placeholder: "Placeholder added. Share an invite link so they can claim it.",
  already_member: "Already in this group.",
};

export async function addMemberAction(input: unknown): Promise<ActionResult<{ message: string }>> {
  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const { supabase } = await requireUser();
  try {
    const result = await addGroupMember(supabase, {
      groupId: parsed.data.groupId,
      email: parsed.data.email || undefined,
      name: parsed.data.name || undefined,
    });
    revalidateGroup(parsed.data.groupId);
    return { ok: true, message: ADD_MEMBER_MESSAGES[result.status] };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not add that member.") };
  }
}

/** True when the member is owed or owes anything in this group, in any currency. */
async function hasUnsettledBalance(db: DbClient, groupId: string, memberId: string) {
  const { entries } = await loadGroupLedger(db, groupId);
  return Object.values(netBalances(entries)).some((byMember) => memberId in byMember);
}

export async function removeMemberAction(groupId: string, memberId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(groupId).success || !idSchema.safeParse(memberId).success) {
    return { ok: false, error: "Invalid member" };
  }
  const { supabase } = await requireUser();
  try {
    if (await hasUnsettledBalance(supabase, groupId, memberId)) {
      return { ok: false, error: "Settle up this member's balance before removing them." };
    }
    await removeGroupMember(supabase, memberId);
    revalidateGroup(groupId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not remove that member.") };
  }
}

export async function leaveGroupAction(groupId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(groupId).success) return { ok: false, error: "Invalid group" };
  const { user, supabase } = await requireUser();
  const group = await getGroup(supabase, groupId);
  const me = group?.members.find((m) => m.userId === user.id);
  if (!group || !me) return { ok: false, error: "You are not in this group." };
  try {
    if (await hasUnsettledBalance(supabase, groupId, me.memberId)) {
      return { ok: false, error: "Settle up your balance in this group before leaving." };
    }
    await removeGroupMember(supabase, me.memberId);
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not leave the group.") };
  }
  revalidatePath("/groups");
  redirect("/groups");
}

export async function deleteGroupAction(groupId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(groupId).success) return { ok: false, error: "Invalid group" };
  const { supabase } = await requireUser();
  try {
    await deleteGroup(supabase, groupId);
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not delete the group.") };
  }
  revalidatePath("/groups");
  redirect("/groups");
}

export async function createInviteAction(groupId: string, memberId?: string): Promise<ActionResult<{ token: string }>> {
  if (!idSchema.safeParse(groupId).success || (memberId && !idSchema.safeParse(memberId).success)) {
    return { ok: false, error: "Invalid group" };
  }
  const { user, supabase } = await requireUser();
  try {
    const invite = await createInvite(supabase, user.id, groupId, memberId);
    revalidatePath(`/groups/${groupId}/settings`);
    return { ok: true, token: invite.token };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not create an invite link.") };
  }
}

export async function revokeInviteAction(groupId: string, inviteId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(inviteId).success) return { ok: false, error: "Invalid invite" };
  const { supabase } = await requireUser();
  try {
    await revokeInvite(supabase, inviteId);
    revalidatePath(`/groups/${groupId}/settings`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not revoke the invite link.") };
  }
}
