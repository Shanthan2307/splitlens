import { dbError, type DbClient } from "./client";
import { PROFILE_LITE, personFromProfile, type Person, type ProfileLite } from "./people";

export type FriendRequest = { id: string; person: Person; createdAt: string };

export type Friendships = {
  friends: Person[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
};

export async function listFriendships(db: DbClient, userId: string): Promise<Friendships> {
  const { data, error } = await db
    .from("friendships")
    .select(
      `id, status, requester_id, created_at,
       requester:profiles!friendships_requester_id_fkey(${PROFILE_LITE}),
       addressee:profiles!friendships_addressee_id_fkey(${PROFILE_LITE})`,
    )
    .order("created_at", { ascending: false });
  if (error) throw dbError("Could not load friends", error);

  const result: Friendships = { friends: [], incoming: [], outgoing: [] };
  for (const row of data) {
    const mine = row.requester_id === userId;
    const other = (mine ? row.addressee : row.requester) as ProfileLite;
    const person = personFromProfile(other);
    if (row.status === "accepted") result.friends.push(person);
    else (mine ? result.outgoing : result.incoming).push({ id: row.id, person, createdAt: row.created_at });
  }
  result.friends.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

export type FriendRequestResult = "requested" | "accepted" | "already_friends" | "already_requested" | "not_found" | "self";

export async function sendFriendRequest(db: DbClient, email: string): Promise<FriendRequestResult> {
  const { data, error } = await db.rpc("send_friend_request", { p_email: email });
  if (error) throw dbError("Could not send friend request", error);
  return data as FriendRequestResult;
}

export async function respondFriendRequest(db: DbClient, friendshipId: string, accept: boolean) {
  const { error } = await db.rpc("respond_friend_request", { p_friendship_id: friendshipId, p_accept: accept });
  if (error) throw dbError("Could not respond to friend request", error);
}

export async function cancelFriendRequest(db: DbClient, friendshipId: string) {
  const { error } = await db.from("friendships").delete().eq("id", friendshipId).eq("status", "pending");
  if (error) throw dbError("Could not cancel friend request", error);
}

export async function getProfilePerson(db: DbClient, userId: string): Promise<Person | null> {
  const { data, error } = await db.from("profiles").select(PROFILE_LITE).eq("id", userId).maybeSingle();
  if (error) throw dbError("Could not load profile", error);
  return data ? personFromProfile(data) : null;
}

/** Profiles visible to the user (RLS: self, friends, co-members), keyed by id. */
export async function getPeopleByIds(db: DbClient, ids: string[]): Promise<Record<string, Person>> {
  if (ids.length === 0) return {};
  const { data, error } = await db.from("profiles").select(PROFILE_LITE).in("id", [...new Set(ids)]);
  if (error) throw dbError("Could not load people", error);
  return Object.fromEntries(data.map((p) => [p.id, personFromProfile(p)]));
}
