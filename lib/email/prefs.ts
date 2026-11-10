import type { SupabaseClient } from "@supabase/supabase-js";

// lib/email/prefs.ts (2026-11-09)
//
// Who has switched which emails off (email_prefs, p138). Takes the service-role client. If the table
// cannot be read the send stops rather than mailing people who said no: callers get ok false.

export type PrefKind = "reminders" | "recaps";

export async function allowedRecipients(
  admin: SupabaseClient, emails: string[], kind: PrefKind,
): Promise<{ ok: true; allowed: string[]; optedOut: string[] } | { ok: false; error: string }> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return { ok: true, allowed: [], optedOut: [] };
  const { data, error } = await admin.from("email_prefs").select(`email, ${kind}`).in("email", list);
  if (error) return { ok: false, error: error.message };
  const off = new Set(((data as Record<string, unknown>[] | null) ?? []).filter((r) => r[kind] === false).map((r) => String(r.email)));
  return { ok: true, allowed: list.filter((e) => !off.has(e)), optedOut: list.filter((e) => off.has(e)) };
}
