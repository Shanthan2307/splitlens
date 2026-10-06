import type { DbClient } from "./client";
import { personFromProfile, type Person } from "./people";
import { getProfile } from "./profiles";

/** The signed-in user as a Person plus their default currency. */
export async function getMe(db: DbClient, userId: string): Promise<Person & { defaultCurrency: string }> {
  const profile = await getProfile(db, userId);
  return { ...personFromProfile(profile), defaultCurrency: profile.default_currency };
}
