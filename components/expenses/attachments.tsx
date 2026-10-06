"use client";

import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { deleteAttachmentAction } from "@/app/(app)/expenses/actions";
import { uploadAttachment } from "@/components/expenses/upload-attachment";
import { Button } from "@/components/ui/button";
import type { Attachment } from "@/lib/db/expenses";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES } from "@/lib/validation/expense";

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Attachments({
  expenseId,
  attachments,
  myUserId,
  canEdit,
}: {
  expenseId: string;
  attachments: Attachment[];
  myUserId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const upload = (files: File[]) =>
    startTransition(async () => {
      for (const file of files) {
        if (file.size > ATTACHMENT_MAX_BYTES) {
          toast.error(`${file.name}: max 10 MB`);
          continue;
        }
        const result = await uploadAttachment(expenseId, file);
        if (!result.ok) toast.error(result.error);
      }
      router.refresh();
    });

  const remove = (id: string) =>
    startTransition(async () => {
      const result = await deleteAttachmentAction(id);
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });

  return (
    <div className="space-y-3">
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attachments.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-lg border p-2">
              {a.url && a.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={a.url} alt="" className="size-12 rounded object-cover" />
              ) : (
                <FileText className="size-12 p-2 text-muted-foreground" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
                    {a.fileName}
                  </a>
                ) : (
                  <span className="block truncate text-sm">{a.fileName}</span>
                )}
                <span className="text-xs text-muted-foreground">{size(a.sizeBytes)}</span>
              </div>
              {a.uploadedBy === myUserId && (
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${a.fileName}`} onClick={() => remove(a.id)} disabled={pending}>
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <>
          <label
            htmlFor="add-attachment"
            className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent"
          >
            <Paperclip className="size-4" aria-hidden />
            {pending ? "Uploading…" : "Add attachment"}
          </label>
          <input
            id="add-attachment"
            type="file"
            accept={ATTACHMENT_MIME_TYPES.join(",")}
            multiple
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              upload([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </>
      )}
    </div>
  );
}
