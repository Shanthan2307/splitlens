import { toast } from "sonner";

/** Android/iOS share sheet when available (WhatsApp, SMS…), otherwise copy to the clipboard. */
export async function shareLink(url: string, title: string, text: string) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  } catch {
    toast.message("Copy this invite link", { description: url, duration: 15000 });
  }
}
