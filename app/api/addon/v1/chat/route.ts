import { addonAuth, fail, messageOut, ok, openSession, preflight } from "@/lib/addons/api";

// app/api/addon/v1/chat/route.ts (2026-11-09)
//
// Phase 6b (p131): GET reads the table's chat and rolls (read scope): the 50 newest after ?since,
// oldest first. Whispers never; the GM's secret rolls only with ?secret=1. POST posts a line (chat
// scope): it shows in chat as the name given (or the key's name) with a "via <key name>" mark, so an
// add-on can never pass for a player.

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const a = await addonAuth(req, "read");
  if (a instanceof Response) return a;
  const u = new URL(req.url);
  const since = u.searchParams.get("since");
  let q = a.admin.from("vtt_messages").select("id, kind, body, as_name, character_id, author_profile, gm_only, created_at, roll")
    .eq("campaign_id", a.key.campaignId).is("whisper_to", null).in("kind", ["say", "emote", "roll"])
    .order("created_at", { ascending: false }).limit(50);
  if (since) { const d = new Date(since); if (isNaN(d.getTime())) return fail(400, "since must be an ISO time."); q = q.gt("created_at", d.toISOString()); }
  if (u.searchParams.get("secret") !== "1") q = q.eq("gm_only", false);
  const { data, error } = await q;
  if (error) return fail(500, "Could not read the chat.");
  const rows = (data ?? []) as { id: string; kind: string; body: string; as_name: string | null; character_id: string | null; author_profile: string; gm_only: boolean; created_at: string; roll: Record<string, unknown> | null }[];
  // names as the table shows them: who it was posted as, else the character, else GM
  const charIds = [...new Set(rows.map((r) => r.character_id).filter((x): x is string => !!x))];
  const { data: chars } = charIds.length ? await a.admin.from("characters").select("id, name").in("id", charIds) : { data: [] };
  const nameOf = new Map(((chars ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const { data: camp } = await a.admin.from("campaigns").select("gm_id").eq("id", a.key.campaignId).maybeSingle();
  const gmId = (camp as { gm_id: string } | null)?.gm_id;
  const { data: pcs } = await a.admin.from("characters").select("profile_id, name").eq("campaign_id", a.key.campaignId).eq("kind", "pc");
  const byProfile = new Map(((pcs ?? []) as { profile_id: string | null; name: string }[]).filter((p) => p.profile_id).map((p) => [p.profile_id!, p.name]));
  const who = (r: (typeof rows)[number]) => r.as_name ?? (r.character_id ? nameOf.get(r.character_id) : undefined) ?? (r.author_profile === gmId ? "GM" : byProfile.get(r.author_profile) ?? "someone");
  return ok({ messages: rows.reverse().map((r) => messageOut(r, who(r))) });
}

export async function POST(req: Request) {
  const a = await addonAuth(req, "chat");
  if (a instanceof Response) return a;
  let b: { text?: unknown; kind?: unknown; as?: unknown } = {};
  try { b = await req.json(); } catch { return fail(400, "Send JSON: { \"text\": \"...\" }."); }
  const text = (typeof b.text === "string" ? b.text : "").trim();
  if (!text) return fail(400, "text is empty.");
  if (text.length > 2000) return fail(400, "text is over 2000 characters.");
  const kind = b.kind === "emote" ? "emote" : "say";
  const as = (typeof b.as === "string" ? b.as : "").trim().slice(0, 60) || a.key.name;
  const { data, error } = await a.admin.from("vtt_messages").insert({
    campaign_id: a.key.campaignId, session_id: await openSession(a.admin, a.key.campaignId), author_profile: a.key.owner,
    as_name: as, kind, body: text, roll: { addon: a.key.name }, gm_only: false,
  }).select("id, kind, body, as_name, gm_only, created_at, roll").single();
  if (error) return fail(500, "Could not post that.");
  return ok({ message: messageOut(data as Parameters<typeof messageOut>[0], as) });
}
