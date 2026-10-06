"use client";

import { createAttachmentUploadAction, registerAttachmentAction } from "@/app/(app)/expenses/actions";
import { uploadToSignedPath } from "@/lib/db/attachments";
import { createClient } from "@/lib/supabase/client";

/** Signed-URL upload: server issues a token, the browser sends the bytes to Storage, server records the row. */
export async function uploadAttachment(expenseId: string, file: File): Promise<{ ok: true } | { ok: false; error: string }> {
  const meta = { expenseId, fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size };
  const signed = await createAttachmentUploadAction(meta);
  if (!signed.ok) return signed;
  try {
    await uploadToSignedPath(createClient(), signed.path, signed.token, file);
  } catch {
    return { ok: false, error: `Could not upload ${file.name}.` };
  }
  const registered = await registerAttachmentAction({ ...meta, path: signed.path });
  return registered.ok ? { ok: true } : registered;
}
