import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";

export type { Json };

/** Typed Supabase client accepted by every data-layer function. */
export type DbClient = SupabaseClient<Database>;

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

export class DbError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    /** Safe to show to the user (raised by our RPCs with SQLSTATE P0001). */
    readonly userMessage?: string,
  ) {
    super(message);
    this.name = "DbError";
  }
}

/** Wraps a PostgREST error; RPC business errors (P0001) keep their message for the UI. */
export function dbError(context: string, error: PostgrestError | Error): DbError {
  const code = "code" in error ? error.code : undefined;
  return new DbError(context, error, code === "P0001" ? error.message : undefined);
}

/** Message to show for any thrown error from the data layer. */
export function userMessage(error: unknown, fallback: string): string {
  return error instanceof DbError && error.userMessage ? error.userMessage : fallback;
}
