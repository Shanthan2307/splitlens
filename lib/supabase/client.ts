import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/database.types";
import { publicEnv } from "@/lib/env";

/** Supabase client for Client Components (auth state, Realtime). Uses the anon key; RLS applies. */
export function createClient() {
  const env = publicEnv();
  return createBrowserClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
