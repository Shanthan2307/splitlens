"use client";

import { AlertTriangle, Camera, ImageUp, Loader2, ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createReceiptUploadAction } from "@/app/(app)/receipts/actions";
import { compressReceiptImage } from "@/components/receipts/compress";
import { AUTO, LanguagePicker } from "@/components/receipts/language-picker";
import { useUserPrefs } from "@/components/user-prefs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { uploadReceiptToSignedPath } from "@/lib/db/receipts";
import type { LanguageTag } from "@/lib/languages";
import { formatMinor, parseMajor, type DraftLine } from "@/lib/splits";
import { createClient } from "@/lib/supabase/client";

/**
 * What a scanned receipt hands to the expense form. The form switches to an itemized
 * split prefilled with these lines (see ExpenseForm.applyScannedReceipt).
 */
export type ScannedReceipt = {
  receiptId: string;
  merchantName: string | null;
  date: string | null;
  currency: string | null;
  lines: DraftLine[];
};

type ScanResponse =
  | {
      ok: true;
      receiptId: string;
      merchant: string | null;
      date: string | null;
      currency: string;
      detectedLanguage: string;
      receiptTotal: number | null;
      computedTotal: number;
      lines: DraftLine[];
      warnings: string[];
    }
  | { ok: false; error: string };

type Stage =
  | { name: "pick" }
  | { name: "working"; step: string }
  | { name: "review"; result: Extract<ScanResponse, { ok: true }> }
  | { name: "error"; message: string };

const KIND_LABEL: Partial<Record<DraftLine["kind"], string>> = {
  tax: "Tax",
  tip: "Tip",
  service: "Service",
  fee: "Fee",
  discount: "Discount",
};

export function ScanReceiptButton({ onScanned }: { onScanned: (receipt: ScannedReceipt) => void }) {
  const prefs = useUserPrefs();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [source, setSource] = useState<LanguageTag | typeof AUTO>(AUTO);
  const [target, setTarget] = useState<LanguageTag>(prefs.preferredLanguage ?? "en");
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const choose = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStage({ name: "pick" });
  };

  const reset = () => {
    abortRef.current?.abort();
    setFile(null);
    setPreview(null);
    setStage({ name: "pick" });
  };

  async function scan() {
    if (!file) return;
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      setStage({ name: "working", step: "Preparing photo…" });
      const image = await compressReceiptImage(file);

      setStage({ name: "working", step: "Uploading…" });
      const upload = await createReceiptUploadAction({ mimeType: image.type });
      if (!upload.ok) throw new Error(upload.error);
      await uploadReceiptToSignedPath(createClient(), upload.path, upload.token, image);

      setStage({ name: "working", step: "Reading the receipt…" });
      const response = await fetch("/api/receipts/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          receiptId: upload.receiptId,
          path: upload.path,
          sourceLanguage: source,
          targetLanguage: target,
          fallbackCurrency: prefs.defaultCurrency,
        }),
      });
      const result = (await response.json().catch(() => ({ ok: false, error: "Unexpected response." }))) as ScanResponse;
      if (!result.ok) throw new Error(result.error);
      setStage({ name: "review", result });
    } catch (error) {
      if (abort.signal.aborted) return;
      setStage({ name: "error", message: error instanceof Error ? error.message : "Something went wrong." });
    }
  }

  const use = (result: Extract<ScanResponse, { ok: true }>) => {
    onScanned({
      receiptId: result.receiptId,
      merchantName: result.merchant,
      date: result.date,
      currency: result.currency,
      lines: result.lines,
    });
    setOpen(false);
    reset();
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ScanLine aria-hidden />
        Scan receipt
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Scan a receipt</DialogTitle>
            <DialogDescription>Any language. Items, tax and tip are read for you to assign.</DialogDescription>
          </DialogHeader>

          {(stage.name === "pick" || stage.name === "error") && (
            <div className="space-y-4">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                <img src={preview} alt="Selected receipt" className="mx-auto max-h-64 rounded-md border object-contain" />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-sm hover:bg-accent">
                    <Camera className="size-6" aria-hidden />
                    Take photo
                    <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
                  </label>
                  <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-sm hover:bg-accent">
                    <ImageUp className="size-6" aria-hidden />
                    Choose photo
                    <input type="file" accept="image/*" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
                  </label>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="receipt-language">Receipt language</Label>
                  <LanguagePicker id="receipt-language" value={source} onChange={setSource} allowAuto />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="translate-to">Translate to</Label>
                  <LanguagePicker id="translate-to" value={target} onChange={setTarget} />
                </div>
              </div>

              {stage.name === "error" && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  {stage.message}
                </p>
              )}

              <div className="flex justify-end gap-2">
                {file && (
                  <Button type="button" variant="ghost" onClick={reset}>
                    Choose another
                  </Button>
                )}
                <Button type="button" onClick={scan} disabled={!file}>
                  <ScanLine aria-hidden />
                  {stage.name === "error" ? "Try again" : "Scan"}
                </Button>
              </div>
            </div>
          )}

          {stage.name === "working" && (
            <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-8 animate-spin" aria-hidden />
              {stage.step}
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                Cancel
              </Button>
            </div>
          )}

          {stage.name === "review" && <Review result={stage.result} onUse={() => use(stage.result)} onRetry={reset} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Review({
  result,
  onUse,
  onRetry,
}: {
  result: Extract<ScanResponse, { ok: true }>;
  onUse: () => void;
  onRetry: () => void;
}) {
  const money = (minor: number) => formatMinor(minor, result.currency);
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{result.merchant ?? "Receipt"}</p>
          <p className="text-xs text-muted-foreground">
            {[result.date, result.currency, result.detectedLanguage].filter(Boolean).join(" · ")}
          </p>
        </div>
        <p className="text-lg font-semibold tabular-nums">{money(result.receiptTotal ?? result.computedTotal)}</p>
      </div>

      {result.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert">
          {result.warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}

      <ul className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm">
        {result.lines.map((line, i) => (
          <li key={i} className="flex items-start gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate">
                {KIND_LABEL[line.kind] && <span className="mr-1 text-xs text-muted-foreground uppercase">{KIND_LABEL[line.kind]}</span>}
                {line.name}
              </p>
              {line.originalName && <p className="truncate text-xs text-muted-foreground">{line.originalName}</p>}
            </div>
            <span className="tabular-nums">{money(parseMajor(line.amount, result.currency))}</span>
          </li>
        ))}
      </ul>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onRetry}>
          Scan another
        </Button>
        <Button type="button" onClick={onUse} disabled={result.lines.length === 0}>
          Use these items
        </Button>
      </div>
    </div>
  );
}
