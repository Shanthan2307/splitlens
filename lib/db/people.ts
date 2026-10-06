/** A person as shown in the UI: a group member (possibly a placeholder) or a user. */
export type Person = {
  /** Participant id: group_members.id in a group, user id otherwise. */
  id: string;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  email: string | null;
  isPlaceholder: boolean;
  venmoUsername?: string | null;
  paypalUsername?: string | null;
};

export type ProfileLite = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  email: string | null;
  venmo_username?: string | null;
  paypal_username?: string | null;
};

export function personFromProfile(p: ProfileLite): Person {
  return {
    id: p.id,
    userId: p.id,
    name: p.display_name || p.email?.split("@")[0] || "Someone",
    avatarUrl: p.avatar_url,
    email: p.email,
    isPlaceholder: false,
    venmoUsername: p.venmo_username ?? null,
    paypalUsername: p.paypal_username ?? null,
  };
}

export const PROFILE_LITE = "id, display_name, avatar_url, email, venmo_username, paypal_username" as const;
