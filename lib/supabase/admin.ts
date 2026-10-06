import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";

/**
 * Service-role client: BYPASSES RLS. Only for trusted server jobs
 * (e.g. Splitwise sync, recurring-expense cron). Never use it for
 * requests acting on behalf of a user.
 */
export function createAdminClient() {
  return createClient<Database>(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
