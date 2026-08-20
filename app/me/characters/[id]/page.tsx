"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

// app/me/characters/[id]/page.tsx
//
// A player-owned character page: the story of one PC, in titled sections the owner writes. Each section
// is private (just them) or shared (their GM can read it). The owner can hand the GM edit access with a
// single toggle. The same page serves the GM: they see the shared sections, and can edit only if granted.
//
// Everything reads and writes through RLS with the browser client (see p78-character-wiki.sql), so there
// is no API route: the policies are the authority.

type Character = { id: string; name: string; campaign_id: string; profile_id: string | null; kind: string };
type Section = { id: string; title: string; body: string; visibility: string; position: number };

const field: React.CSSProperties = {
  boxSizing: "border-box", width: "100%", background: C.surface2, color: C.text,
  border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 11px", fontSize: 14, outline: "none",
};
const primaryBtn: React.CSSProperties = { background: C.sun, color: SAX.inkDeep, border: "none", borderRadius: 7, padding: "9px 16px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: 7, padding: "7px 12px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" };
const label: React.CSSProperties = { fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: C.muted };

export default function CharacterPage() {
  const supabase = useMemo(() => createClient(), []);
  const [charId, setCharId] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [ch, setCh] = useState<Character | null>(null);
  const [isGm, setIsGm] = useState(false);
  const [granted, setGranted] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "denied" | "error">("loading");

  useEffect(() => {
    const parts = window.location.pathname.split("/").filter(Boolean); // me / characters / <id>
    setCharId(parts[parts.length - 1] || null);
  }, []);

  const load = useCallback(async () => {
    if (!charId) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setStatus("denied"); return; }
    setMe(user.id);

    const { data: cData } = await supabase.from("characters")
      .select("id, name, campaign_id, profile_id, kind").eq("id", charId).maybeSingle();
    const character = cData as Character | null;
    if (!character) { setStatus("denied"); return; }
    setCh(character);

    const { data: campData } = await supabase.from("campaigns").select("gm_id").eq("id", character.campaign_id).maybeSingle();
    const gm = (campData as { gm_id: string } | null)?.gm_id === user.id;
    setIsGm(gm);

    const [{ data: sData }, { data: gData }] = await Promise.all([
      supabase.from("character_wiki_sections").select("id, title, body, visibility, position").eq("character_id", charId).order("position").order("created_at"),
      supabase.from("character_wiki_gm_edit").select("character_id").eq("character_id", charId).maybeSingle(),
    ]);
    setSections((sData as Section[]) || []);
    setGranted(Boolean(gData));
    setStatus("ready");
  }, [supabase, charId]);

  useEffect(() => { void load(); }, [load]);

  const isOwner = Boolean(ch && me && ch.profile_id === me);
  const canEdit = isOwner || (isGm && granted);

  const addSection = async () => {
    const pos = sections.length ? Math.max(...sections.map((s) => s.position)) + 1 : 0;
    // Owner's new sections start private (theirs to share); a GM editing (only ever on shared sections)
    // adds shared ones, so RLS does not hide the GM's own new section back from them.
    const { data, error } = await supabase.from("character_wiki_sections")
      .insert({ character_id: charId, title: "", body: "", visibility: isOwner ? "private" : "shared", position: pos })
      .select("id, title, body, visibility, position").single();
    if (!error && data) setSections((s) => [...s, data as Section]);
  };
  const patch = async (id: string, p: Partial<Section>) => {
    setSections((s) => s.map((x) => x.id === id ? { ...x, ...p } : x));
    await supabase.from("character_wiki_sections").update(p).eq("id", id);
  };
  const del = async (id: string) => {
    setSections((s) => s.filter((x) => x.id !== id));
    await supabase.from("character_wiki_sections").delete().eq("id", id);
  };
  const move = async (id: string, dir: -1 | 1) => {
    const i = sections.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sections.length) return;
    const a = sections[i], b = sections[j];
    setSections((s) => { const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    await Promise.all([
      supabase.from("character_wiki_sections").update({ position: b.position }).eq("id", a.id),
      supabase.from("character_wiki_sections").update({ position: a.position }).eq("id", b.id),
    ]);
  };
  const toggleGrant = async () => {
    if (granted) { setGranted(false); await supabase.from("character_wiki_gm_edit").delete().eq("character_id", charId); }
    else { setGranted(true); await supabase.from("character_wiki_gm_edit").insert({ character_id: charId }); }
  };

  if (status === "loading") return <PageShell width={760}><p style={{ color: C.muted }}>Loading…</p></PageShell>;
  if (status === "denied") return <PageShell width={760}><p style={{ color: C.muted }}>That character page is not available to you.</p></PageShell>;

  const visibleSections = canEdit ? sections : sections.filter((s) => s.visibility === "shared");

  return (
    <PageShell width={760}>
      <div style={{ ...label, marginBottom: 6 }}>{isOwner ? "Your character" : "Character page"}</div>
      <h1 style={{ fontFamily: SAX.serif, fontSize: 30, fontWeight: 700, margin: "0 0 6px" }}>{ch?.name}</h1>
      <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 20px", maxWidth: 620 }}>
        {isOwner
          ? "Your character's story, in your words. Mark a section shared to let your GM read it, or keep it private. You can hand your GM edit access whenever you want a second hand."
          : isGm
            ? (granted ? "This player has given you edit access to their page." : "The sections this player has shared with you. They keep the pen unless they hand it over.")
            : "This player's shared character notes."}
      </p>

      {isOwner && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "12px 14px", marginBottom: 20 }}>
          <input type="checkbox" checked={granted} onChange={toggleGrant} style={{ width: 17, height: 17, accentColor: SAX.brass }} />
          <div>
            <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>Let my GM edit this page</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>They can already read anything you mark shared. This lets them add and change sections too.</div>
          </div>
        </div>
      )}

      {visibleSections.length === 0 && (
        <p style={{ color: C.muted, fontSize: 14, marginBottom: 18 }}>
          {canEdit ? "No sections yet. Add one to start: a backstory, your goals, the bonds that matter, a secret only your GM should know." : "Nothing shared here yet."}
        </p>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {visibleSections.map((s, i) => (
          <div key={s.id} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "14px 16px" }}>
            {canEdit ? (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input value={s.title} placeholder="Section title (Backstory, Goals, Bonds, A secret…)" onChange={(e) => patch(s.id, { title: e.target.value })}
                    style={{ ...field, fontWeight: 600 }} />
                  <button type="button" title="Move up" onClick={() => move(s.id, -1)} disabled={i === 0} style={{ ...ghostBtn, padding: "6px 9px", opacity: i === 0 ? 0.4 : 1 }}>↑</button>
                  <button type="button" title="Move down" onClick={() => move(s.id, 1)} disabled={i === visibleSections.length - 1} style={{ ...ghostBtn, padding: "6px 9px", opacity: i === visibleSections.length - 1 ? 0.4 : 1 }}>↓</button>
                </div>
                <textarea value={s.body} placeholder="Write it here…" rows={5} onChange={(e) => patch(s.id, { body: e.target.value })}
                  style={{ ...field, resize: "vertical", lineHeight: 1.55 }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.muted }}>
                    Visibility
                    <select value={s.visibility} onChange={(e) => patch(s.id, { visibility: e.target.value })} style={{ ...field, width: "auto", padding: "6px 10px" }}>
                      <option value="private">Private (just me)</option>
                      <option value="shared">Shared with my GM</option>
                    </select>
                  </label>
                  <button type="button" onClick={() => del(s.id)} style={ghostBtn}>Delete</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: SAX.serif, fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>{s.title || "Untitled"}</div>
                <div style={{ fontSize: 14.5, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{s.body}</div>
              </>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <button type="button" onClick={addSection} style={{ ...primaryBtn, marginTop: 16 }}>+ Add a section</button>
      )}
    </PageShell>
  );
}
