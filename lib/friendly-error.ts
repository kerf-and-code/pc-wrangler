// lib/friendly-error.ts (push 12, audits U7 and U6)
//
// What a person sees when something fails. Supabase and PostgREST errors carry database text
// ("permission denied for table x", "duplicate key value violates unique constraint", "JWT expired")
// that tells a GM or player nothing they can act on. friendlyError turns the common cases into one
// sentence with a next step, and logs the raw text to the console for whoever is debugging.
//
// Messages our own database functions raise on purpose ("not signed in", "you have no character in
// that campaign") are already written for people, so a short one with no table or column names in it
// passes through unchanged.
//
// notReady replaces the old "run migration p1NN" lines (audit U6): a customer cannot run a migration.
// They see that the feature is not available yet; the migration name goes to the console for the owner.

type Errorish = { message?: unknown; code?: unknown; status?: unknown; name?: unknown } | null | undefined;

const IDENTIFIER = /\b[a-z]+_[a-z0-9_]+\b|\bpublic\.|\brelation\b|\bcolumn\b|\bconstraint\b|\bschema cache\b|\bJWT\b/i;

export function friendlyError(err: unknown, action?: string): string {
  const e = (typeof err === "object" ? err : null) as Errorish;
  const msg = String(e?.message ?? (typeof err === "string" ? err : "") ?? "").trim();
  const code = String(e?.code ?? "");
  if (msg || code) console.warn("[error]", code || "-", msg);
  const lead = action ? `Could not ${action}. ` : "";

  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg))
    return `${lead}Check your connection and try again.`;
  if (code === "PGRST301" || code === "PGRST303" || /jwt expired|invalid jwt|auth session missing|refresh token/i.test(msg))
    return `${lead}Your sign-in has expired. Sign in again, then retry.`;
  if (code === "42501" || /permission denied|row-level security|violates row-level/i.test(msg))
    return `${lead}You do not have permission to do that here.`;
  if (code === "23505" || /duplicate key/i.test(msg))
    return `${lead}That already exists. Try a different name.`;
  if (code === "23503" || /foreign key/i.test(msg))
    return `${lead}Something else still uses this, so it cannot be changed or removed yet.`;
  if (code === "23514" || code === "22P02" || /check constraint|invalid input syntax/i.test(msg))
    return `${lead}One of the values is not allowed. Check what you entered.`;
  if (code === "57014" || /timed? ?out|statement timeout/i.test(msg))
    return `${lead}That took too long. Try again in a moment.`;
  if (code === "42P01" || code === "42883" || code === "PGRST202" || /does not exist|schema cache/i.test(msg))
    return `${lead}This part of Six Axes is not available yet.`;
  // A message our own functions raised for people: short, and no table or column names in it.
  if (msg && msg.length <= 160 && !IDENTIFIER.test(msg))
    return `${lead}${msg.charAt(0).toUpperCase()}${msg.slice(1)}${/[.!?]$/.test(msg) ? "" : "."}`;
  return `${lead}Something went wrong. Try again, and if it keeps happening, let us know.`;
}

/** A feature whose tables are missing on this server. The migration name is for the owner's console only. */
export function notReady(feature: string, migration: string): string {
  console.warn(`[setup] ${feature}: migration ${migration} has not been run on this database.`);
  return `${feature} ${/s$/i.test(feature) ? "are" : "is"} not available yet.`;
}
