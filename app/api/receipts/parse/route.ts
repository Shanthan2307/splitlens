import { NextResponse, type NextRequest } from "next/server";
import { getAnthropic } from "@/lib/ai/anthropic";
import { parseReceipt, type ReceiptImage } from "@/lib/ai/receipt-parser";
import { serverEnv } from "@/lib/env.server";
import { completeReceipt, countReceiptsSince, downloadReceiptImage, insertReceipt } from "@/lib/db/receipts";
import { exceededLimit, RECEIPT_RATE_LIMITS } from "@/lib/rate-limit";
import { receiptToDraftLines } from "@/lib/splits";
import { createClient } from "@/lib/supabase/server";
import { AUTO_LANGUAGE, RECEIPT_IMAGE_TYPES, RECEIPT_MAX_BYTES, scanRequestSchema } from "@/lib/validation/receipt";

// Vision + structured output can take a while on long receipts.
export const maxDuration = 60;

function fail(status: number, error: string, headers?: Record<string, string>) {
  return NextResponse.json({ ok: false, error }, { status, headers });
}

/**
 * POST /api/receipts/parse
 * Body: { receiptId, path, sourceLanguage, targetLanguage, fallbackCurrency }
 * The image must already be uploaded to receipts/{userId}/… (see createReceiptUploadAction).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return fail(401, "Sign in to scan receipts.");

  const body = scanRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail(400, "Invalid scan request.");
  const { receiptId, path, sourceLanguage, targetLanguage, fallbackCurrency } = body.data;
  if (!path.startsWith(`${user.id}/${receiptId}.`) || path.includes("..")) return fail(400, "Invalid receipt path.");

  // Rate limit per user, counted from the receipts table (works across serverless instances).
  const now = Date.now();
  const counts = await Promise.all(
    RECEIPT_RATE_LIMITS.map((l) => countReceiptsSince(supabase, user.id, new Date(now - l.windowMs))),
  );
  const exceeded = exceededLimit(counts);
  if (exceeded) {
    return fail(429, `You've reached the limit of ${exceeded.label}. Try again later.`, {
      "Retry-After": String(Math.ceil(exceeded.windowMs / 1000)),
    });
  }

  let image: Blob;
  try {
    image = await downloadReceiptImage(supabase, path);
  } catch {
    return fail(404, "Couldn't find the uploaded photo. Try again.");
  }
  if (!(RECEIPT_IMAGE_TYPES as readonly string[]).includes(image.type)) return fail(415, "Use a JPEG, PNG or WebP photo.");
  if (image.size > RECEIPT_MAX_BYTES) return fail(413, "That photo is too large. Try again; it's compressed automatically.");

  try {
    await insertReceipt(supabase, {
      id: receiptId,
      userId: user.id,
      path,
      mimeType: image.type,
      sourceLanguage: sourceLanguage === AUTO_LANGUAGE ? null : sourceLanguage,
      targetLanguage,
    });
  } catch {
    return fail(409, "This photo was already scanned. Take or choose a new one.");
  }

  const env = serverEnv();
  const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
  let result;
  try {
    result = await parseReceipt(
      { image: { base64, mediaType: image.type as ReceiptImage["mediaType"] }, sourceLanguage, targetLanguage, fallbackCurrency },
      { client: getAnthropic(), model: env.ANTHROPIC_MODEL, effort: env.RECEIPT_PARSER_EFFORT },
    );
  } catch (error) {
    console.error("receipt parse failed", error);
    await completeReceipt(supabase, receiptId, { ok: false, model: env.ANTHROPIC_MODEL, raw: null, error: "service unavailable" }).catch(() => {});
    return fail(503, "Receipt scanning is unavailable right now.");
  }

  if (!result.ok) {
    await completeReceipt(supabase, receiptId, { ok: false, model: env.ANTHROPIC_MODEL, raw: result.raw, error: result.code });
    return fail(result.code === "api_error" ? 502 : 422, result.message);
  }

  await completeReceipt(supabase, receiptId, { ok: true, model: result.model, raw: result.raw, receipt: result.receipt });
  return NextResponse.json({
    ok: true,
    receiptId,
    merchant: result.receipt.merchant,
    date: result.receipt.date,
    currency: result.receipt.currency,
    detectedLanguage: result.receipt.detectedLanguage,
    receiptTotal: result.receipt.receiptTotal,
    computedTotal: result.receipt.computedTotal,
    lines: receiptToDraftLines(result.receipt),
    warnings: result.receipt.warnings,
  });
}
