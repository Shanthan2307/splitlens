import type { ReceiptModelOutput } from "@/lib/validation/receipt";
import type { NormalizedReceipt } from "@/lib/splits";
import { DbError, dbError, type DbClient, type Json } from "./client";

/** Reserve receipts/{userId}/{receiptId}.{ext} and return a signed upload token (Storage checks the owner-folder policy). */
export async function createReceiptUpload(db: DbClient, userId: string, extension: string) {
  const receiptId = crypto.randomUUID();
  const path = `${userId}/${receiptId}.${extension}`;
  const { data, error } = await db.storage.from("receipts").createSignedUploadUrl(path);
  if (error) throw new DbError("Could not prepare receipt upload", error);
  return { receiptId, path: data.path, token: data.token };
}

export async function uploadReceiptToSignedPath(db: DbClient, path: string, token: string, file: Blob) {
  const { error } = await db.storage.from("receipts").uploadToSignedUrl(path, token, file, { contentType: file.type });
  if (error) throw new DbError("Could not upload receipt", error);
}

export async function countReceiptsSince(db: DbClient, userId: string, since: Date): Promise<number> {
  const { count, error } = await db
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .eq("uploaded_by", userId)
    .gte("created_at", since.toISOString());
  if (error) throw dbError("Could not check usage", error);
  return count ?? 0;
}

export async function downloadReceiptImage(db: DbClient, path: string): Promise<Blob> {
  const { data, error } = await db.storage.from("receipts").download(path);
  if (error || !data) throw new DbError("Could not read the uploaded receipt", error);
  return data;
}

export async function insertReceipt(
  db: DbClient,
  input: { id: string; userId: string; path: string; mimeType: string; sourceLanguage: string | null; targetLanguage: string },
) {
  const { error } = await db.from("receipts").insert({
    id: input.id,
    uploaded_by: input.userId,
    storage_path: input.path,
    mime_type: input.mimeType,
    source_language: input.sourceLanguage,
    target_language: input.targetLanguage,
    status: "processing",
  });
  if (error) throw dbError("Could not record the receipt", error);
}

export async function completeReceipt(
  db: DbClient,
  receiptId: string,
  result:
    | { ok: true; model: string; raw: ReceiptModelOutput; receipt: NormalizedReceipt }
    | { ok: false; model: string; raw: ReceiptModelOutput | null; error: string },
) {
  const update = result.ok
    ? {
        status: "parsed" as const,
        model: result.model,
        raw_model_json: result.raw as unknown as Json,
        parsed: result.receipt as unknown as Json,
        merchant_name: result.receipt.merchant,
        receipt_date: result.receipt.date,
        currency: result.receipt.currency,
        total_minor: result.receipt.receiptTotal ?? result.receipt.computedTotal,
        source_language: result.receipt.detectedLanguage.match(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/) ? result.receipt.detectedLanguage : null,
        error_message: null,
      }
    : { status: "failed" as const, model: result.model, raw_model_json: (result.raw ?? null) as unknown as Json, error_message: result.error };
  const { error } = await db.from("receipts").update(update).eq("id", receiptId);
  if (error) throw dbError("Could not save the receipt result", error);
}

export type ReceiptImage = {
  id: string;
  url: string;
  mimeType: string;
  merchantName: string | null;
  receiptDate: string | null;
  scannedAt: string;
};

/**
 * The scanned receipt linked to an expense, with a 1-hour signed URL. RLS + the storage
 * policy allow anyone who can see the expense; returns null if it's gone or not visible.
 */
export async function getReceiptImage(db: DbClient, receiptId: string): Promise<ReceiptImage | null> {
  const { data, error } = await db
    .from("receipts")
    .select("id, storage_path, mime_type, merchant_name, receipt_date, created_at")
    .eq("id", receiptId)
    .maybeSingle();
  if (error) throw dbError("Could not load the receipt", error);
  if (!data) return null;
  const signed = await db.storage.from("receipts").createSignedUrl(data.storage_path, 60 * 60);
  if (signed.error || !signed.data) return null;
  return {
    id: data.id,
    url: signed.data.signedUrl,
    mimeType: data.mime_type,
    merchantName: data.merchant_name,
    receiptDate: data.receipt_date,
    scannedAt: data.created_at,
  };
}
