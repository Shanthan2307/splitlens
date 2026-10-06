"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { userMessage } from "@/lib/db/client";
import { createReceiptUpload } from "@/lib/db/receipts";
import type { ActionResult } from "@/lib/validation/result";

const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as const;
const schema = z.object({ mimeType: z.enum(Object.keys(EXTENSIONS) as [keyof typeof EXTENSIONS, ...(keyof typeof EXTENSIONS)[]]) });

/** Signed upload for a receipt photo; the browser uploads the (compressed) image directly to Storage. */
export async function createReceiptUploadAction(
  input: unknown,
): Promise<ActionResult<{ receiptId: string; path: string; token: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Use a JPEG, PNG or WebP photo." };
  const { user, supabase } = await requireUser();
  try {
    return { ok: true, ...(await createReceiptUpload(supabase, user.id, EXTENSIONS[parsed.data.mimeType])) };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Couldn't start the upload. Try again.") };
  }
}
