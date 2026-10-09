"use client";

import { ExternalLink, FileText, ReceiptText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ReceiptImage } from "@/lib/db/receipts";

const scannedFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** The photo that was scanned for this expense: thumbnail, tap for full screen (pinch to zoom on phones). */
export function ReceiptImageCard({ receipt }: { receipt: ReceiptImage }) {
  const [open, setOpen] = useState(false);
  const isImage = receipt.mimeType.startsWith("image/");
  const caption = [receipt.merchantName, `scanned ${scannedFormat.format(new Date(receipt.scannedAt))}`].filter(Boolean).join(" · ");

  return (
    <div className="flex items-center gap-3 rounded-lg border p-2">
      {isImage ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 overflow-hidden rounded-md border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label="View the scanned receipt"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
          <img src={receipt.url} alt="" className="h-24 w-18 object-cover object-top" />
        </button>
      ) : (
        <FileText className="size-10 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <ReceiptText className="size-4" aria-hidden /> Scanned receipt
        </p>
        <p className="truncate text-xs text-muted-foreground">{caption}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {isImage && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              View
            </Button>
          )}
          <Button asChild size="sm" variant="ghost">
            <a href={receipt.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open original
            </a>
          </Button>
        </div>
      </div>

      {isImage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="flex max-h-[100dvh] w-full max-w-none flex-col gap-2 p-2 sm:max-h-[95dvh] sm:max-w-2xl sm:p-4">
            <DialogTitle className="px-2 pt-1 text-base">Scanned receipt</DialogTitle>
            <DialogDescription className="px-2">{caption}</DialogDescription>
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-md bg-muted [touch-action:pan-x_pan-y_pinch-zoom]">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
              <img src={receipt.url} alt={`Receipt${receipt.merchantName ? ` from ${receipt.merchantName}` : ""}`} className="mx-auto h-auto w-full max-w-full" />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
