"use client";

import { RECEIPT_MAX_BYTES, RECEIPT_MAX_EDGE } from "@/lib/validation/receipt";

/** Comfortably under the 5 MB API limit after base64 overhead is irrelevant (we upload binary, server re-encodes). */
const TARGET_BYTES = 3.5 * 1024 * 1024;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), "image/jpeg", quality),
  );
}

/**
 * Downscales to at most RECEIPT_MAX_EDGE on the long edge (the model's maximum useful
 * resolution), applies EXIF orientation, and re-encodes as JPEG under ~3.5 MB.
 */
export async function compressReceiptImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // e.g. HEIC on browsers that can't decode it.
    if (["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= RECEIPT_MAX_BYTES) return file;
    throw new Error("This photo format can't be read in your browser. Use a JPEG or PNG.");
  }

  const scale = Math.min(1, RECEIPT_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the photo.");
  ctx.fillStyle = "#fff"; // transparent PNGs → white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let quality = 0.88;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > TARGET_BYTES && quality > 0.5) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, quality);
  }
  if (blob.size > RECEIPT_MAX_BYTES) throw new Error("This photo is too large even after compression.");
  return blob;
}
