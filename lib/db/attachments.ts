import { DbError, dbError, type DbClient } from "./client";

function safeFileName(name: string) {
  return name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-100) || "file";
}

/**
 * Step 1 (server): reserve a path under attachments/{expenseId}/ and return a signed upload
 * token. Storage checks the caller's INSERT policy (can_access_expense) when signing.
 */
export async function createAttachmentUpload(db: DbClient, expenseId: string, fileName: string) {
  const path = `${expenseId}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
  const { data, error } = await db.storage.from("attachments").createSignedUploadUrl(path);
  if (error) throw new DbError("Could not prepare upload", error, "You can't add attachments to this expense.");
  return { path: data.path, token: data.token };
}

/** Step 2 (browser): upload the bytes directly to Storage, bypassing server body limits. */
export async function uploadToSignedPath(db: DbClient, path: string, token: string, file: File) {
  const { error } = await db.storage
    .from("attachments")
    .uploadToSignedUrl(path, token, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw new DbError("Could not upload attachment", error);
}

/** Step 3 (server): record the uploaded object. Removes the object if the row can't be written. */
export async function registerAttachment(
  db: DbClient,
  input: { userId: string; expenseId: string; path: string; fileName: string; mimeType: string; sizeBytes: number },
) {
  const { error } = await db.from("attachments").insert({
    expense_id: input.expenseId,
    uploaded_by: input.userId,
    storage_path: input.path,
    file_name: input.fileName.slice(0, 200),
    mime_type: input.mimeType || "application/octet-stream",
    size_bytes: input.sizeBytes,
  });
  if (error) {
    await db.storage.from("attachments").remove([input.path]);
    throw dbError("Could not save attachment", error);
  }
}

export async function deleteAttachment(db: DbClient, attachmentId: string) {
  const { data, error } = await db
    .from("attachments")
    .delete()
    .eq("id", attachmentId)
    .select("storage_path, expense_id")
    .maybeSingle();
  if (error) throw dbError("Could not delete attachment", error);
  if (!data) throw new DbError("Attachment not found", undefined, "You can only delete attachments you uploaded.");
  await db.storage.from("attachments").remove([data.storage_path]);
  return data.expense_id;
}
