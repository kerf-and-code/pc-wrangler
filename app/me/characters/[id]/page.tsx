"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import BlockEditor, { type Block } from "@/app/gm/codex/BlockEditor";
import { PortraitUploader } from "@/components/portrait-uploader";

// app/me/characters/[id]/page.tsx
//
// A player-owned character page with TWO parts:
//   1. PRIVATE / GM-shared narrative sections (character_wiki_sections, p78). Titled text sections,
//      each private to the owner or shared with the GM, who may edit only when granted.
//   2. A PUBLIC wiki page (p80): the same block system the GM uses for entries, opted in per character
//      via characters.is_public, shown in "The party" section of the campaign's public wiki. Blocks,
//      a summary, the Forge portrait as the hero image, and (later) connections.
//
// Everything reads and writes through RLS with the browser client, so there is no API route: the
// policies are the authority. The owner can edit both parts; a GM sees only the shared private sections
// (and never the public-page editor, which is the player's own).

type Character = {
  id: string; name: string; campaign_id: string; profile_id: string | null; kind: string;
  is_public: boolean; portrait_url: string | null; summary: string | null; blocks: Block[] | null;
};
type Section = { id: string; title: string; body: string; visibility: string; position: number };
type Campaign = { gm_id: string; public_slug: string | null; public_published_at: string | null };
type LinkRow = { id: string; source_type: string; source_id: string; target_type: string; target_id: string; relation: string | null };
type CandItem = { id: string; item_kind: string; item_type: string; title: string };

const candLabel = (c: CandItem) => (c.item_kind === "npc" ? "NPC" : c.item_type);

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
  const [camp, setCamp] = useState<Campaign | null>(null);
  const [isGm, setIsGm] = useState(false);
  const [granted, setGranted] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "denied" | "error">("loading");

  // Public-page editor state (owner only).
  const [isPublic, setIsPublic] = useState(false);
  const [summary, setSummary] = useState("");
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [pageBusy, setPageBusy] = useState(false);
  const [pageSaved, setPageSaved] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Connections (p80 page + p83 policy): what the owner can link to, and the links their character has.
  const [cands, setCands] = useState<CandItem[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [linkTarget, setLinkTarget] = useState("");
  const [linkRel, setLinkRel] = useState("");

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
      .select("id, name, campaign_id, profile_id, kind, is_public, portrait_url, summary, blocks")
      .eq("id", charId).maybeSingle();
    const character = cData as Character | null;
    if (!character) { setStatus("denied"); return; }
    setCh(character);
    setIsPublic(Boolean(character.is_public));
    setSummary(character.summary || "");
    setPortraitUrl(character.portrait_url);
    setBlocks(character.blocks && character.blocks.length ? character.blocks : []);

    // Owner-only: the codex items they can link to, and the links already on this character.
    if (character.profile_id === user.id) {
      const [{ data: cd }, { data: lk }] = await Promise.all([
        supabase.rpc("codex_for_campaign", { p_campaign: character.campaign_id }),
        supabase.from("entity_links")
          .select("id, source_type, source_id, target_type, target_id, relation")
          .or(`source_id.eq.${character.id},target_id.eq.${character.id}`),
      ]);
      setCands((cd as CandItem[]) || []);
      setLinks((lk as LinkRow[]) || []);
    }

    const { data: campData } = await supabase.from("campaigns")
      .select("gm_id, public_slug, public_published_at").eq("id", character.campaign_id).maybeSingle();
    const c = campData as Campaign | null;
    setCamp(c);
    setIsGm(c?.gm_id === user.id);

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

  // ---- private sections (p78) ----
  const addSection = async () => {
    const pos = sections.length ? Math.max(...sections.map((s) => s.position)) + 1 : 0;
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

  // ---- public wiki page (p80) ----
  // Publish is the owner's own switch: flips characters.is_public, which is what public_codex reads to
  // show this PC in "The party". It only actually appears once the GM has also published the campaign.
  const togglePublic = async () => {
    if (!ch) return;
    const next = !isPublic;
    setIsPublic(next);
    const { error } = await supabase.from("characters").update({ is_public: next }).eq("id", ch.id);
    if (error) { setIsPublic(!next); setPageError(`Could not change publish state: ${error.message}`); }
  };

  // Upload a block image to THIS character's own path, gated by the p80 storage policy
  // (<campaign>/pc/<charId>/blocks/...). Returns the public URL for the block, or null on failure.
  const uploadBlockImage = useCallback(async (file: File): Promise<string | null> => {
    if (!ch) return null;
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${ch.campaign_id}/pc/${ch.id}/blocks/${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const { error } = await supabase.storage.from("campaign-maps").upload(path, file, { upsert: true, contentType: file.type });
    if (error) { setPageError(`Image upload failed: ${error.message}`); return null; }
    const { data } = supabase.storage.from("campaign-maps").getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  }, [supabase, ch]);

  const savePage = async () => {
    if (!ch) return;
    setPageBusy(true); setPageError(null); setPageSaved(false);
    const { error } = await supabase.from("characters").update({ blocks, summary: summary.trim() || null }).eq("id", ch.id);
    setPageBusy(false);
    if (error) { setPageError(`Could not save the page: ${error.message}`); return; }
    setPageSaved(true);
    setTimeout(() => setPageSaved(false), 2500);
  };

  const addLink = async () => {
    if (!ch || !linkTarget) return;
    const cand = cands.find((c) => c.id === linkTarget);
    if (!cand) return;
    // An NPC endpoint is a character row; everything else in the codex is an entry.
    const target_type = cand.item_kind === "npc" ? "character" : "entry";
    const { data, error } = await supabase.from("entity_links").insert({
      campaign_id: ch.campaign_id, source_type: "character", source_id: ch.id,
      target_type, target_id: cand.id, relation: linkRel.trim() || null,
    }).select("id, source_type, source_id, target_type, target_id, relation").single();
    if (error) { setPageError(`Could not add connection: ${error.message}`); return; }
    if (data) { setLinks((l) => [...l, data as LinkRow]); setLinkTarget(""); setLinkRel(""); }
  };
  const removeLink = async (id: string) => {
    setLinks((l) => l.filter((x) => x.id !== id));
    await supabase.from("entity_links").delete().eq("id", id);
  };

  const publicUrl =
    camp?.public_slug && camp.public_published_at && ch
      ? `/c/${camp.public_slug}/party/${ch.id}`
      : null;

  if (status === "loading") return <PageShell width={760}><p style={{ color: C.muted }}>Loading…</p></PageShell>;
  if (status === "denied") return <PageShell width={760}><p style={{ color: C.muted }}>That character page is not available to you.</p></PageShell>;

  const visibleSections = canEdit ? sections : sections.filter((s) => s.visibility === "shared");

  return (
    <PageShell width={760}>
      <div style={{ ...label, marginBottom: 6 }}>{isOwner ? "Your character" : "Character page"}</div>
      <h1 style={{ fontFamily: SAX.serif, fontSize: 30, fontWeight: 700, margin: "0 0 6px" }}>{ch?.name}</h1>
      <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 20px", maxWidth: 620 }}>
        {isOwner
          ? "Your character's story, in your words. The public page below is what the world sees; the private sections further down are yours, or shared only with your GM."
          : isGm
            ? (granted ? "This player has given you edit access to their private sections." : "The sections this player has shared with you. They keep the pen unless they hand it over.")
            : "This player's shared character notes."}
      </p>

      {/* ---- PUBLIC WIKI PAGE (owner only) ---- */}
      {isOwner && ch && (
        <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "16px 18px", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontFamily: SAX.serif, fontSize: 20, fontWeight: 700, color: C.text }}>Public wiki page</div>
            {publicUrl && isPublic && (
              <a href={publicUrl} target="_blank" rel="noreferrer" style={{ fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: SAX.brass, textDecoration: "none" }}>
                View on the wiki ↗
              </a>
            )}
          </div>
          <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "6px 0 14px" }}>
            A page anyone can read in your campaign&rsquo;s public codex, under The party. Build it with the same
            blocks the GM uses: text panels (full or half width), images in the body, and images in the side panel.
          </p>

          <label style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "11px 13px", marginBottom: 16, cursor: "pointer" }}>
            <input type="checkbox" checked={isPublic} onChange={togglePublic} style={{ width: 17, height: 17, accentColor: SAX.brass }} />
            <div>
              <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>Show this character on the public wiki</div>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
                {camp?.public_published_at
                  ? "It appears under The party once you save the page below."
                  : "Your GM has not published the campaign yet, so nothing is public until they do, even with this on."}
              </div>
            </div>
          </label>

          <div style={{ marginBottom: 14 }}>
            <div style={{ ...label, marginBottom: 6 }}>Portrait</div>
            <PortraitUploader
              basePath={`${ch.campaign_id}/portraits/${ch.id}`}
              currentUrl={portraitUrl}
              onUploaded={async (url) => {
                setPortraitUrl(url);
                await supabase.from("characters").update({ portrait_url: url }).eq("id", ch.id);
              }}
              label="Character portrait"
            />
            <p style={{ fontSize: 12, color: C.muted, margin: "6px 0 0" }}>This is the same portrait as the Forge, and it is the page&rsquo;s header image.</p>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ ...label, marginBottom: 6 }}>Summary</div>
            <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={280}
              placeholder="One line under the name, e.g. a half-elf ranger hunting the coven that burned her village."
              style={field} />
          </div>

          <div style={{ ...label, marginBottom: 6 }}>The page</div>
          <BlockEditor blocks={blocks} onChange={setBlocks} onUploadImage={uploadBlockImage} />

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" onClick={savePage} disabled={pageBusy} style={{ ...primaryBtn, opacity: pageBusy ? 0.7 : 1 }}>
              {pageBusy ? "Saving…" : "Save page"}
            </button>
            {pageSaved && <span style={{ fontSize: 13, color: C.good }}>Saved.</span>}
            {pageError && <span style={{ fontSize: 12.5, color: C.warn }}>{pageError}</span>}
          </div>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.line}` }}>
            <div style={{ ...label, marginBottom: 8 }}>Connections</div>
            <p style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.55, margin: "0 0 10px" }}>
              Link your character to the people, places, and lore you know. A connection shows on the public wiki when both ends are public.
            </p>
            {links.length > 0 && (
              <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                {links.map((l) => {
                  const otherId = l.source_id === ch.id ? l.target_id : l.source_id;
                  const t = cands.find((c) => c.id === otherId);
                  return (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "7px 10px" }}>
                      <span style={{ fontSize: 13.5, color: C.text }}>{t?.title || "Something in the codex"}</span>
                      {l.relation && <span style={{ fontSize: 12, color: C.muted }}>· {l.relation}</span>}
                      <button type="button" onClick={() => removeLink(l.id)} style={{ ...ghostBtn, marginLeft: "auto", padding: "4px 9px" }}>Remove</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)} style={{ ...field, flex: "1 1 180px" }}>
                <option value="">Link to…</option>
                {cands
                  .filter((c) => c.id !== ch.id && !links.some((l) => l.source_id === c.id || l.target_id === c.id))
                  .map((c) => <option key={c.id} value={c.id}>{c.title} ({candLabel(c)})</option>)}
              </select>
              <input value={linkRel} onChange={(e) => setLinkRel(e.target.value)} placeholder="relation (optional)" maxLength={60} style={{ ...field, flex: "1 1 140px" }} />
              <button type="button" onClick={addLink} disabled={!linkTarget} style={{ ...primaryBtn, opacity: linkTarget ? 1 : 0.6 }}>Add</button>
            </div>
          </div>
        </section>
      )}

      {/* ---- PRIVATE / GM-SHARED SECTIONS (p78) ---- */}
      {isOwner && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "12px 14px", marginBottom: 16 }}>
          <input type="checkbox" checked={granted} onChange={toggleGrant} style={{ width: 17, height: 17, accentColor: SAX.brass }} />
          <div>
            <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>Let my GM edit my private sections</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>They can already read anything you mark shared. This lets them add and change those sections too.</div>
          </div>
        </div>
      )}

      <div style={{ ...label, marginBottom: 10 }}>{isOwner ? "Private sections" : "Shared sections"}</div>

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
