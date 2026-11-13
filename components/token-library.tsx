"use client";

// components/token-library.tsx (2026-11-12, push 51: token control and libraries)
//
// A person's saved tokens (vtt_token_library, p172): a name, a picture, a size and a frame, kept across
// campaigns. Shown on the tabletop's Tokens tab.
//   GM:      their own library (place a token on the table, save the selected token into it), and giving
//            the selected token into a player's library, with the tokens they have given at this table
//            and a way to take one back.
//   Player:  their library, including what the GM gave them (a familiar, a summon, a mount); placing one
//            on the scene they are looking at, controlled by the character they choose; and the tokens
//            they placed, with a way to take them off the table.
// Writes go straight to the table (own rows, row level security) or through the p172 functions.

import React, { useCallback, useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { C } from "@/lib/forge-theme";
import { friendlyError, notReady } from "@/lib/friendly-error";

type Supa = ReturnType<typeof createClient>;
export type LibToken = { name: string; image_url: string | null; size: number; kind: string; style: Record<string, unknown> };
type Item = LibToken & { id: string; owner: string; assigned_by: string | null; campaign_id: string | null };
type Who = { id: string; name: string };

const small: React.CSSProperties = { padding: "6px 10px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" };
const field: React.CSSProperties = { padding: "6px 8px", background: "#1d1915", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5 };
const head: React.CSSProperties = { fontWeight: 600, fontSize: 13, margin: "14px 0 6px" };

/** What goes into a library from a token on the table: its look, never its place or its stats. */
export function libTokenFrom(t: { name: string; image_url: string | null; size: number; kind: string; style?: Record<string, unknown> | null }): LibToken {
  const frame = t.style && typeof t.style === "object" ? (t.style as Record<string, unknown>).frame : undefined;
  return { name: t.name.replace(/\s+\d+$/, "").slice(0, 80), image_url: t.image_url, size: t.size, kind: t.kind === "pc" ? "npc" : t.kind, style: frame ? { frame } : {} };
}

function Thumb({ url, name }: { url: string | null; name: string }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" width={30} height={30} style={{ borderRadius: "50%", objectFit: "cover", flex: "0 0 auto" }} />
    : <span aria-hidden style={{ width: 30, height: 30, borderRadius: "50%", background: C.surface2, display: "grid", placeItems: "center", fontSize: 12, color: C.muted, flex: "0 0 auto" }}>{name.slice(0, 2)}</span>;
}

export default function TokenLibrary({ supabase, campaignId, me, isGm, selected, characters, onPlaceGm, centre, say, placed }: {
  supabase: Supa; campaignId: string; me: string; isGm: boolean;
  /** the one selected token on the table, if any, to save or give */
  selected: LibToken | null;
  /** GM: the table's characters that have a player; player: their own characters here */
  characters: Who[];
  onPlaceGm?: (t: LibToken) => void;
  centre: () => { x: number; y: number };
  say: (text: string, ok?: boolean) => void;
  /** player: the tokens they placed on this scene */
  placed?: Who[];
}) {
  const [mine, setMine] = useState<Item[] | null>(null);
  const [given, setGiven] = useState<Item[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [giveTo, setGiveTo] = useState("");
  const [ctrl, setCtrl] = useState(characters.length === 1 ? characters[0].id : "");
  const asId = ctrl || (characters.length === 1 ? characters[0].id : "");

  const problem = useCallback((e: { message?: string } | null, action: string) => {
    if (!e) return null;
    return /vtt_token_library|token_library_give|tabletop_place_library_token|schema cache|does not exist/.test(e.message ?? "") ? notReady("Token libraries", "p172") : friendlyError(e, action);
  }, []);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("vtt_token_library").select("id, owner, name, image_url, size, kind, style, assigned_by, campaign_id")
      .eq("owner", me).order("created_at", { ascending: false }).limit(200);
    if (error) { setErr(problem(error, "read your tokens")); setMine([]); return; }
    setErr(null); setMine((data ?? []) as Item[]);
    if (isGm) {
      const { data: g } = await supabase.from("vtt_token_library").select("id, owner, name, image_url, size, kind, style, assigned_by, campaign_id")
        .eq("assigned_by", me).eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(200);
      setGiven(((g ?? []) as Item[]).filter((x) => x.owner !== me));
    }
  }, [supabase, me, isGm, campaignId, problem]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => PromiseLike<{ error: { message?: string } | null }>, action: string, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) { say(problem(error, action) ?? "Something went wrong."); return false; }
    say(ok, true); void load(); return true;
  };

  const save = () => selected && run(() => supabase.from("vtt_token_library").insert({ owner: me, ...selected }), "save the token", `${selected.name} saved to your tokens.`);
  const give = () => {
    if (!selected || !giveTo) return;
    const who = characters.find((c) => c.id === giveTo)?.name ?? "them";
    void run(() => supabase.rpc("token_library_give", { p_campaign: campaignId, p_character: giveTo, p_name: selected.name, p_image_url: selected.image_url, p_size: selected.size, p_style: selected.style, p_kind: selected.kind }),
      "give the token", `${selected.name} is in ${who}'s tokens now.`);
  };
  const place = (it: Item) => {
    if (isGm) { onPlaceGm?.(it); return; }
    if (!asId) { say("Choose which of your characters controls it first."); return; }
    const c = centre();
    void run(() => supabase.rpc("tabletop_place_library_token", { p_item: it.id, p_character: asId, p_x: c.x, p_y: c.y }), "place the token", `${it.name} is on the table.`);
  };
  const remove = (it: Item) => run(() => supabase.from("vtt_token_library").delete().eq("id", it.id), "remove the token", it.owner === me ? `${it.name} removed from your tokens.` : `${it.name} taken back.`);
  const takeOff = (t: Who) => run(() => supabase.rpc("tabletop_remove_placed_token", { p_token: t.id }), "take it off the table", `${t.name} taken off the table.`);

  const row = (it: Item, actions: React.ReactNode) => (
    <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${C.line}` }}>
      <Thumb url={it.image_url} name={it.name} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
        <div style={{ fontSize: 11, color: C.muted }}>{it.size === 1 ? "1 square" : `${it.size} squares`}{it.assigned_by && it.assigned_by !== me ? ", from your GM" : ""}</div>
      </div>
      {actions}
    </div>
  );

  return (
    <div>
      <div style={head}>{isGm ? "Your token library" : "Your tokens"}</div>
      <p style={{ color: C.muted, fontSize: 11.5, margin: "0 0 6px", lineHeight: 1.45 }}>
        {isGm
          ? "Tokens you keep for any of your tables. Save the selected token here, place one in the middle of your view, or give the selected token to a player."
          : "Tokens kept for you, including any your GM gave you (a familiar, a summon, a mount). Place one on the table and the character you choose controls it."}
      </p>
      {err && <p role="status" style={{ color: C.warn, fontSize: 12, margin: "0 0 6px" }}>{err}</p>}
      {selected && <button type="button" disabled={busy} onClick={() => void save()} style={{ ...small, width: "100%", marginBottom: 6 }}>Save {selected.name} to {isGm ? "your library" : "your tokens"}</button>}
      {!isGm && characters.length > 1 && (
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, margin: "4px 0 6px" }}>Controlled by
          <select value={ctrl} onChange={(e) => setCtrl(e.target.value)} style={field}>
            <option value="">Choose...</option>
            {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      {mine === null ? <p style={{ color: C.muted, fontSize: 12 }}>Loading your tokens...</p>
        : mine.length === 0 ? <p style={{ color: C.muted, fontSize: 12 }}>{isGm ? "Nothing saved yet." : "Nothing here yet. Your GM can give you tokens, or select your own token and save it."}</p>
        : mine.map((it) => row(it, <>
            <button type="button" disabled={busy || (!isGm && !asId)} title={!isGm && !asId ? "Choose which character controls it first" : undefined} onClick={() => place(it)} style={small}>Place</button>
            <button type="button" disabled={busy} onClick={() => void remove(it)} aria-label={`Remove ${it.name} from your tokens`} style={{ ...small, color: C.muted }}>Remove</button>
          </>))}

      {!isGm && placed && placed.length > 0 && (
        <>
          <div style={head}>On the table</div>
          {placed.map((t) => (
            <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}>
              <span style={{ flex: 1, fontSize: 13 }}>{t.name}</span>
              <button type="button" disabled={busy} onClick={() => void takeOff(t)} style={small}>Take off</button>
            </div>
          ))}
        </>
      )}

      {isGm && (
        <>
          <div style={head}>Give to a player</div>
          {characters.length === 0
            ? <p style={{ color: C.muted, fontSize: 12 }}>Nobody to give to yet: a character shows here once a player has claimed it.</p>
            : (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <select aria-label="Give the selected token to" value={giveTo} onChange={(e) => setGiveTo(e.target.value)} style={{ ...field, flex: 1, minWidth: 120 }}>
                  <option value="">Choose a character...</option>
                  {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" disabled={busy || !selected || !giveTo} onClick={give} style={small}>Give {selected ? selected.name : "the selected token"}</button>
              </div>
            )}
          {!selected && characters.length > 0 && <p style={{ color: C.muted, fontSize: 11.5, margin: "4px 0 0" }}>Select one token on the map to give it.</p>}
          {given.length > 0 && (
            <>
              <div style={{ ...head, fontSize: 12 }}>Given at this table</div>
              {given.map((it) => row(it, <button type="button" disabled={busy} onClick={() => void remove(it)} style={{ ...small, color: C.muted }}>Take back</button>))}
            </>
          )}
        </>
      )}
    </div>
  );
}
