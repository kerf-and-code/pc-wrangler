// lib/campaign-context.ts
//
// One campaign and one session across the whole GM side, kept in the URL.
//
// Every GM page used to load the campaign list and pick its own default (usually the first by
// creation date, on some pages nothing at all), so a GM with two campaigns picked one in Workspace and
// then found Sessions asking again and Encounters open on the other campaign. These helpers give every
// page the same rule:
//
//   campaign: ?campaign=<id> in the URL, then the active campaign (this tab, else the last one used),
//             then the first in the page's list.
//   session:  ?session=<id> in the URL, then the last session this tab used for that campaign, then
//             pickCurrentSession (live, open, last played; never the empty future session).
//
// Whenever a page's choice changes, it is remembered (lib/active-campaign, which the nav also reads)
// and written into the URL with history.replaceState, so a reload, a bookmark or a link to a teammate
// lands on the same campaign and session. replaceState rather than router.replace: it needs no
// Suspense boundary (useSearchParams would, on every page) and does not trigger a re-render.
//
// Ids from the URL or storage are only used when they are in the page's own list, so a stale id, a
// campaign the GM only plays in, or another campaign's session is ignored rather than trusted.

import { useEffect } from "react";
import { getActiveCampaign, setActiveCampaign } from "@/lib/active-campaign";
import { pickCurrentSession, type SessionLike } from "@/lib/current-session";

type CampaignLike = { id: string; name?: string | null; system?: string | null };

export function urlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  try { return new URLSearchParams(window.location.search).get(name); } catch { return null; }
}

export function setUrlParam(name: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(name, value); else url.searchParams.delete(name);
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", next);
    }
  } catch { /* no history API; the choice is still remembered in storage */ }
}

/** The campaign a page should open on. Returns "" for an empty list. */
export function initialCampaignId(list: CampaignLike[]): string {
  if (!list.length) return "";
  const has = (id: string | null | undefined) => !!id && list.some((c) => c.id === id);
  const fromUrl = urlParam("campaign");
  if (has(fromUrl)) return fromUrl as string;
  const active = getActiveCampaign()?.id;
  if (has(active)) return active as string;
  return list[0].id;
}

/** Remember the page's campaign (storage + nav + URL) whenever it changes. */
export function useRememberCampaign(campaignId: string | null | undefined, list: CampaignLike[]): void {
  useEffect(() => {
    if (!campaignId) return;
    const c = list.find((x) => x.id === campaignId);
    if (!c) return;
    const prev = getActiveCampaign();
    // Keep a known system when this page's query did not load one, so the nav's tool gating holds.
    const system = c.system !== undefined ? (c.system ?? null) : (prev?.id === c.id ? prev.system : null);
    if (prev?.id !== c.id || prev.system !== system || (c.name && prev.name !== c.name)) {
      setActiveCampaign({ id: c.id, name: c.name ?? prev?.name, system });
    }
    if (urlParam("campaign") !== c.id) {
      setUrlParam("campaign", c.id);
      // A session id belongs to one campaign; drop it when the campaign changes under it.
      if (prev?.id && prev.id !== c.id) setUrlParam("session", null);
    }
  }, [campaignId, list]);
}

const SESS_KEY = "sax_active_session";
function storedSessions(): Record<string, string> {
  try { return JSON.parse(sessionStorage.getItem(SESS_KEY) ?? localStorage.getItem(SESS_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}

/** The session a page should open on, for this campaign's rows. Returns "" when there are none. */
export function initialSessionId<T extends SessionLike & { id: string }>(campaignId: string, rows: T[]): string {
  if (!rows.length) return "";
  const has = (id: string | null | undefined) => !!id && rows.some((r) => r.id === id);
  const fromUrl = urlParam("session");
  if (has(fromUrl)) return fromUrl as string;
  const stored = storedSessions()[campaignId];
  if (has(stored)) return stored;
  return pickCurrentSession(rows)?.id ?? rows[0].id;
}

/** The session the GM last pointed at for this campaign (URL, then storage), without a fallback.
 *  For pages that list something other than sessions (Review lists capture jobs). */
export function preferredSessionId(campaignId: string): string | null {
  return urlParam("session") || storedSessions()[campaignId] || null;
}

/** Remember the page's session for its campaign (storage + URL) whenever it changes. */
export function useRememberSession(campaignId: string | null | undefined, sessionId: string | null | undefined): void {
  useEffect(() => {
    if (!campaignId || !sessionId) return;
    try {
      const map = { ...storedSessions(), [campaignId]: sessionId };
      const raw = JSON.stringify(map);
      sessionStorage.setItem(SESS_KEY, raw);
      localStorage.setItem(SESS_KEY, raw);
    } catch { /* storage disabled */ }
    if (urlParam("session") !== sessionId) setUrlParam("session", sessionId);
  }, [campaignId, sessionId]);
}

/** A same-app link that carries the current campaign (and optionally more params). */
export function gmHref(path: string, params: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
