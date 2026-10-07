"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { userMessage } from "@/lib/db/client";
import { friendInvite } from "@/lib/db/invites";
import { getMe } from "@/lib/db/me";
import { importedGroups, logImport, setSyncState, unlinkSplitwiseAccount, type ImportCounts } from "@/lib/db/splitwise";
import { SplitwiseAuthError, SplitwiseRateLimitError } from "@/lib/splitwise/api";
import { importExpensePage, importSplitwiseGroup, loadOverview, type Overview } from "@/lib/splitwise/importer";
import { splitwiseFor, SplitwiseNotConnectedError } from "@/lib/splitwise/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";
import type { ActionResult } from "@/lib/validation/result";

/** Splitwise errors → messages; rate limits come back as data so the wizard can wait and resume. */
function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof SplitwiseNotConnectedError) return { ok: false, error: "Connect Splitwise first." };
  if (error instanceof SplitwiseAuthError) return { ok: false, error: "Splitwise needs you to reconnect your account." };
  const message = userMessage(error, "");
  if (!message) console.error(fallback, error instanceof Error ? error.message : error);
  return { ok: false, error: message || fallback };
}

type RateLimited = { ok: true; rateLimited: true; retryAfter: number };

export async function loadOverviewAction(): Promise<ActionResult<{ overview: Overview }> | RateLimited> {
  const { user, supabase } = await requireUser();
  try {
    const { api, splitwiseUserId, admin } = await splitwiseFor(user.id);
    return { ok: true, overview: await loadOverview(api, admin, supabase, splitwiseUserId) };
  } catch (error) {
    if (error instanceof SplitwiseRateLimitError) return { ok: true, rateLimited: true, retryAfter: error.retryAfterSeconds };
    return failure(error, "Could not load your Splitwise account.");
  }
}

const groupSchema = z.object({ splitwiseGroupId: z.number().int().positive() });

export async function importGroupAction(
  input: unknown,
): Promise<ActionResult<{ groupId: string; created: boolean; missing: number }> | RateLimited> {
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid group" };
  const { user, supabase } = await requireUser();
  try {
    const { api, admin } = await splitwiseFor(user.id);
    await setSyncState(admin, user.id, { status: "running" });
    const me = await getMe(supabase, user.id);
    const result = await importSplitwiseGroup(api, admin, user.id, parsed.data.splitwiseGroupId, me.defaultCurrency);
    return { ok: true, groupId: result.groupId, created: result.created, missing: result.members.filter((m) => !m.registered).length };
  } catch (error) {
    if (error instanceof SplitwiseRateLimitError) return { ok: true, rateLimited: true, retryAfter: error.retryAfterSeconds };
    return failure(error, "Could not import this group.");
  }
}

const pageSchema = z.object({
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("group"), splitwiseGroupId: z.number().int().positive() }),
    z.object({ kind: z.literal("friend"), splitwiseFriendId: z.number().int().positive() }),
  ]),
  offset: z.number().int().min(0).max(1_000_000),
  includeComments: z.boolean(),
});

export async function importPageAction(
  input: unknown,
): Promise<ActionResult<{ counts: ImportCounts & { invalid: number }; nextOffset: number | null }> | RateLimited> {
  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid import request" };
  const { user, supabase } = await requireUser();
  const { target, offset, includeComments } = parsed.data;
  try {
    const { api, admin } = await splitwiseFor(user.id);
    let resolved: Parameters<typeof importExpensePage>[3];
    if (target.kind === "group") {
      // The SplitLens group must already be imported and the user a member (RLS hides others).
      const groupId = (await importedGroups(supabase, [target.splitwiseGroupId])).get(target.splitwiseGroupId);
      if (!groupId) return { ok: false, error: "Import the group first." };
      resolved = { ...target, groupId };
    } else {
      resolved = target;
    }
    const page = await importExpensePage(api, admin, user.id, resolved, offset, includeComments);
    return { ok: true, counts: page.counts, nextOffset: page.nextOffset };
  } catch (error) {
    if (error instanceof SplitwiseRateLimitError) return { ok: true, rateLimited: true, retryAfter: error.retryAfterSeconds };
    return failure(error, "Could not import expenses.");
  }
}

const finishSchema = z.object({
  splitwiseGroupId: z.number().int().positive().nullable(),
  name: z.string().max(200),
  counts: z.object({ created: z.number().int(), payments: z.number().int(), comments: z.number().int() }),
  failed: z.boolean(),
});

/** Records one activity entry per imported group/friend and the connection's sync state. */
export async function finishImportAction(input: unknown): Promise<ActionResult> {
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid import summary" };
  const { user, supabase } = await requireUser();
  const admin = createAdminClient();
  const { splitwiseGroupId, name, counts, failed } = parsed.data;
  try {
    const groupId = splitwiseGroupId ? ((await importedGroups(supabase, [splitwiseGroupId])).get(splitwiseGroupId) ?? null) : null;
    if (!failed && (groupId || counts.created + counts.payments > 0)) {
      await logImport(admin, user.id, groupId, { name, ...counts, source: "splitwise" });
    }
    await setSyncState(admin, user.id, failed ? { status: "failed", error: "partial" } : { status: "succeeded", synced: true });
  } catch (error) {
    return failure(error, "Could not record the import.");
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** A link that makes whoever opens it your friend (for Splitwise friends not on SplitLens yet). */
export async function friendInviteLinkAction(): Promise<ActionResult<{ url: string }>> {
  const { user, supabase } = await requireUser();
  try {
    const token = await friendInvite(supabase, user.id);
    return { ok: true, url: `${await siteUrl()}/invite/${token}` };
  } catch (error) {
    return failure(error, "Could not create an invite link.");
  }
}

/** Deletes stored tokens and the verified Splitwise id. Imported data stays. */
export async function disconnectSplitwiseAction(): Promise<ActionResult> {
  const { user } = await requireUser();
  try {
    await unlinkSplitwiseAccount(createAdminClient(), user.id);
  } catch {
    return { ok: false, error: "Could not disconnect Splitwise. Try again." };
  }
  revalidatePath("/account");
  revalidatePath("/import/splitwise");
  return { ok: true };
}
