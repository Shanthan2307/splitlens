"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { userMessage } from "@/lib/db/client";
import { redeemFriendInvite, redeemInvite } from "@/lib/db/invites";
import type { ActionResult } from "@/lib/validation/result";

const schema = z.object({ token: z.string().min(16).max(128), claimMemberId: z.uuid().nullable() });

export async function redeemInviteAction(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid invite" };
  const { supabase } = await requireUser();
  let groupId: string;
  try {
    groupId = await redeemInvite(supabase, parsed.data.token, parsed.data.claimMemberId);
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not join the group.") };
  }
  redirect(`/groups/${groupId}`);
}

const friendSchema = z.object({ token: z.string().min(16).max(128) });

export async function redeemFriendInviteAction(input: unknown): Promise<ActionResult> {
  const parsed = friendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid invite" };
  const { supabase } = await requireUser();
  let friendId: string;
  try {
    friendId = await redeemFriendInvite(supabase, parsed.data.token);
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not accept the invite.") };
  }
  redirect(`/friends/${friendId}`);
}
