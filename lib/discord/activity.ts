// lib/discord/activity.ts (2026-11-11, push 34, audit P7: the Discord Activity)
//
// Server side of the Six Axes Activity (app/activity, app/api/activity). The Activity runs inside
// Discord, where the website's login does not exist, so:
//   1. the Activity asks the Discord client for an OAuth code (scope identify) and sends it here;
//   2. exchangeCode turns it into an access token with the app's client secret, and discordUser reads
//      who it belongs to straight from Discord, so the id is Discord's word, not the browser's;
//   3. signSession hands back a short-lived session (Discord user, Discord server, display name),
//      signed with the client secret; every later call carries it and verifySession checks it;
//   4. each call works out the caller's place in the campaign again (activity_identity, p158) and
//      reads or writes as that Six Axes profile (activity_call), so the table's own rules apply.
//
// Environment: NEXT_PUBLIC_DISCORD_CLIENT_ID (the Discord application's id, also used by the page)
// and DISCORD_CLIENT_SECRET (OAuth2 > Client Secret in the Developer Portal). Server only.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const DISCORD_API = "https://discord.com/api/v10";
const SESSION_HOURS = 12;

export type ActivitySession = { d: string; g: string; n: string; exp: number };
export type ActivityRole = "gm" | "player" | "watch";
export type ActivityPlace = { campaignId: string; name: string; role: ActivityRole; profileId: string | null };

export const activityConfigured = (): boolean => !!process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID && !!process.env.DISCORD_CLIENT_SECRET;

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");
const mac = (body: string, secret: string) => createHmac("sha256", `six-axes-activity:${secret}`).update(body).digest();

export function signSession(s: Omit<ActivitySession, "exp">, now = Date.now(), secret = process.env.DISCORD_CLIENT_SECRET || ""): string {
  if (!secret) throw new Error("DISCORD_CLIENT_SECRET is not set");
  const body = b64(JSON.stringify({ ...s, exp: Math.floor(now / 1000) + SESSION_HOURS * 3600 }));
  return `${body}.${b64(mac(body, secret))}`;
}

export function verifySession(token: string | null | undefined, now = Date.now(), secret = process.env.DISCORD_CLIENT_SECRET || ""): ActivitySession | null {
  if (!token || !secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = mac(body, secret), got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ActivitySession;
    if (typeof s.d !== "string" || typeof s.g !== "string" || typeof s.exp !== "number") return null;
    if (s.exp * 1000 < now) return null;
    return { d: s.d, g: s.g, n: typeof s.n === "string" ? s.n : "", exp: s.exp };
  } catch { return null; }
}

/** The bearer session from a request's Authorization header. */
export function sessionFrom(req: Request): ActivitySession | null {
  const h = req.headers.get("authorization") || "";
  return verifySession(h.startsWith("Bearer ") ? h.slice(7) : null);
}

export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || "",
      client_secret: process.env.DISCORD_CLIENT_SECRET || "",
      grant_type: "authorization_code",
      code,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`discord token exchange failed: ${res.status} ${j.error ?? ""}`);
  return j.access_token;
}

export async function discordUser(accessToken: string): Promise<{ id: string; name: string }> {
  const res = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const j = (await res.json().catch(() => ({}))) as { id?: string; username?: string; global_name?: string | null };
  if (!res.ok || !j.id) throw new Error(`discord user lookup failed: ${res.status}`);
  return { id: j.id, name: (j.global_name || j.username || "Discord user").slice(0, 60) };
}

/** Every campaign linked to the session's Discord server, with the caller's role in each. */
export async function placesFor(admin: SupabaseClient, s: ActivitySession): Promise<ActivityPlace[]> {
  const { data, error } = await admin.rpc("activity_identity", { p_discord: s.d, p_guild: s.g });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { campaign_id: string; name: string; role: string; profile_id: string | null }[]).map((r) => ({
    campaignId: r.campaign_id, name: r.name, role: (r.role === "gm" || r.role === "player" ? r.role : "watch") as ActivityRole, profileId: r.profile_id,
  }));
}

/** One table function as a profile (p158 activity_call). */
export async function callAs<T = unknown>(admin: SupabaseClient, profileId: string, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc("activity_call", { p_profile: profileId, p_fn: fn, p_args: args });
  if (error) throw new Error(error.message);
  return data as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

// ---- what a watcher may see -------------------------------------------------------------------------
// A watcher reads through a player's eyes (activity_watch_profile), so anything that belongs to that
// player is taken out: which tokens are theirs, whispers to or from them, and their own GM-only rolls.

// Push 51 (audit round 2, B15): nor whose eyes they are. The payload used to carry the borrowed player's
// profile id (state.me) and every player's profile id (the party list, each message's author), which
// told a watcher whose account they were seeing through. A watcher needs none of them: names stay.
type Tok = Record<string, unknown> & { mine?: boolean; controlled_by?: unknown };
type Member = Record<string, unknown> & { profile_id?: unknown };
export function forWatcher<S extends { tokens?: Tok[]; party?: Member[]; me?: unknown } | null>(state: S): S {
  if (!state) return state;
  const tokens = (state.tokens ?? []).map((t) => ({ ...t, mine: false, controlled_by: [] }));
  const party = Array.isArray(state.party) ? state.party.map((m) => ({ ...m, profile_id: null })) : state.party;
  return { ...state, tokens, party, me: null, role: "watch" } as S;
}
type Msg = Record<string, unknown> & { whisper_to?: unknown; gm_only?: boolean; author_profile?: unknown };
export function feedForWatcher<F extends { messages?: Msg[] } | null>(feed: F): F {
  if (!feed) return feed;
  return { ...feed, messages: (feed.messages ?? [])
    .filter((m) => (m.whisper_to == null || (Array.isArray(m.whisper_to) && m.whisper_to.length === 0)) && !m.gm_only)
    .map((m) => ({ ...m, author_profile: null, whisper_to: null })) } as F;
}
type Entry = Record<string, unknown> & { mine?: boolean };
export function combatForWatcher<C extends { order?: Entry[] } | null>(c: C): C {
  if (!c) return c;
  const personal = ["ac", "pendingSaves", "lastSave", "econ", "speed", "speedNow", "attacksPerAction", "cantAct"];
  return { ...c, order: (c.order ?? []).map((e) => {
    const out: Entry = { ...e, mine: false };
    for (const k of personal) delete out[k];
    return out;
  }) } as C;
}
