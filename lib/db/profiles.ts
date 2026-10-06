import type { ProfileUpdate } from "@/lib/validation/profile";
import { DbError, type DbClient, type Tables } from "./client";

export type Profile = Tables<"profiles">;

const PROFILE_COLUMNS =
  "id, display_name, email, avatar_url, default_currency, preferred_language, venmo_username, paypal_username" as const;

export async function getProfile(db: DbClient, userId: string) {
  const { data, error } = await db.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).single();
  if (error) throw new DbError("Could not load profile", error);
  return data;
}

export type ProfileSummary = Awaited<ReturnType<typeof getProfile>>;

export async function updateProfile(db: DbClient, userId: string, update: ProfileUpdate & { avatarUrl?: string }) {
  const { error } = await db
    .from("profiles")
    .update({
      display_name: update.displayName,
      default_currency: update.defaultCurrency,
      preferred_language: update.preferredLanguage,
      venmo_username: update.venmoUsername || null,
      paypal_username: update.paypalUsername || null,
      ...(update.avatarUrl !== undefined && { avatar_url: update.avatarUrl }),
    })
    .eq("id", userId);
  if (error) throw new DbError("Could not update profile", error);
}

/** Uploads to avatars/{userId}/avatar and returns a cache-busted public URL. */
export async function uploadAvatar(db: DbClient, userId: string, file: File): Promise<string> {
  const path = `${userId}/avatar`;
  const { error } = await db.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
  if (error) throw new DbError("Could not upload avatar", error);
  const { data } = db.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
