"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { userMessage } from "@/lib/db/client";
import { cancelFriendRequest, respondFriendRequest, sendFriendRequest, type FriendRequestResult } from "@/lib/db/friends";
import { friendEmailSchema } from "@/lib/validation/friend";
import { firstIssue, type ActionResult } from "@/lib/validation/result";

const MESSAGES: Record<FriendRequestResult, { ok: boolean; message: string }> = {
  requested: { ok: true, message: "Friend request sent." },
  accepted: { ok: true, message: "They'd already invited you. You're now friends." },
  already_friends: { ok: true, message: "You're already friends." },
  already_requested: { ok: true, message: "Request already sent." },
  not_found: { ok: false, message: "No SplitLens account uses that email yet. Ask them to sign up, then add them." },
  self: { ok: false, message: "That's your own email." },
};

export async function sendFriendRequestAction(input: unknown): Promise<ActionResult<{ message: string }>> {
  const parsed = friendEmailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const { supabase } = await requireUser();
  try {
    const result = MESSAGES[await sendFriendRequest(supabase, parsed.data.email)];
    revalidatePath("/friends");
    return result.ok ? { ok: true, message: result.message } : { ok: false, error: result.message, field: "email" };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not send the friend request.") };
  }
}

const idSchema = z.uuid();

export async function respondFriendRequestAction(friendshipId: string, accept: boolean): Promise<ActionResult> {
  if (!idSchema.safeParse(friendshipId).success) return { ok: false, error: "Invalid request" };
  const { supabase } = await requireUser();
  try {
    await respondFriendRequest(supabase, friendshipId, accept);
    revalidatePath("/friends");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not update the request.") };
  }
}

export async function cancelFriendRequestAction(friendshipId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(friendshipId).success) return { ok: false, error: "Invalid request" };
  const { supabase } = await requireUser();
  try {
    await cancelFriendRequest(supabase, friendshipId);
    revalidatePath("/friends");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not cancel the request.") };
  }
}
