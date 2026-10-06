"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { updateProfile, uploadAvatar } from "@/lib/db/profiles";
import { avatarFileSchema, profileUpdateSchema } from "@/lib/validation/profile";

export type AccountFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<
    Record<"displayName" | "defaultCurrency" | "preferredLanguage" | "venmoUsername" | "paypalUsername" | "avatar", string>
  >;
};

export async function saveAccount(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const { user, supabase } = await requireUser();

  const fields = profileUpdateSchema.safeParse({
    displayName: formData.get("displayName"),
    defaultCurrency: formData.get("defaultCurrency"),
    preferredLanguage: formData.get("preferredLanguage"),
    venmoUsername: formData.get("venmoUsername") ?? "",
    paypalUsername: formData.get("paypalUsername") ?? "",
  });
  const avatar = avatarFileSchema.safeParse(formData.get("avatar") ?? undefined);

  if (!fields.success || !avatar.success) {
    const fieldErrors: AccountFormState["fieldErrors"] = {};
    for (const issue of fields.error?.issues ?? []) {
      const key = issue.path[0] as keyof NonNullable<AccountFormState["fieldErrors"]>;
      fieldErrors[key] ??= issue.message;
    }
    if (!avatar.success) fieldErrors.avatar = avatar.error.issues[0]?.message;
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors };
  }

  try {
    const avatarUrl = avatar.data ? await uploadAvatar(supabase, user.id, avatar.data) : undefined;
    await updateProfile(supabase, user.id, { ...fields.data, avatarUrl });
  } catch {
    return { status: "error", message: "Could not save your changes. Try again." };
  }

  revalidatePath("/", "layout");
  return { status: "success", message: "Account updated." };
}
