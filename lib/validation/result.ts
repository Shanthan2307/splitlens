/** Return shape of every server action: never throws to the client. */
export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

export function firstIssue(error: { issues: { message: string; path: PropertyKey[] }[] }): { error: string; field?: string } {
  const issue = error.issues[0];
  return { error: issue?.message ?? "Invalid input", field: issue?.path.map(String).join(".") || undefined };
}
