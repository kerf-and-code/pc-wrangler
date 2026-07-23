"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { useMomentPlayer, MomentButton } from "@/components/moment-player";
import { SAX, surfaces, ui } from "@/lib/theme";

const C = {
  bg: SAX.ink,
  surface: SAX.slateBg,
  surface2: "rgba(11,7,18,0.6)",
  line: SAX.line,
  text: SAX.text,
  muted: SAX.muted,
  sun: SAX.sun,
  sunSoft: "#FFD75E",
  plum: "#9B7BD4",
  warn: "#E07A5F",
  good: "#5DBE9A",
};

type Campaign = { id: string; name: string };
type Entry = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  visibility: string;
  tags: string[];
};
type Char = {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  visibility: string;
  tags: string[];
  class: string | null;
  subclass: string | null;
};
type Link = {
  id: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relation: string | null;
};
type Sess = { id: string; session_number: number | null };
type GmBeat = {
  id: string; kind: string; summary: string; quote: string | null;
  session_id: string | null; t_start_seconds: number | null; audio_track_id: string | null; created_at: string;
};

const NPC_BEAT_KINDS = ["npc_introduced", "npc_voice", "npc_action", "npc_departed"];
const BEAT_LABEL: Record<string, string> = {
  npc_introduced: "Introduced", npc_voice: "Spoke", npc_action: "Acted", npc_departed: "Departed",
};

type Mode =
  // tag is the reserved tag of the tab this was opened from, or null. It rides along so a
  // faction created on the Factions tab is guaranteed to come back as a faction, even if
  // the GM edits the tags field on the way through.
  | { what: "entry"; type: string; tag?: string | null; id: string | null }
  | { what: "character"; id: string | null };

// A tab is no longer the same thing as an entry type.
//
// Factions and items are both stored as type 'lore' with a reserved tag, because that is
// what /api/gm-review creates when the GM accepts a beat that names one. Giving them a
// type of their own would split the data in half: the Codex would write type='faction'
// rows that the review route, the backfill, and every existing entry would never match.
//
// So each tab declares the type it reads and, optionally, the tag that narrows it. The
// Lore tab declares no tag and therefore shows only entries carrying NEITHER reserved
// tag, which keeps every entry in exactly one tab instead of factions appearing twice.
//
// NPCs and PCs have no type at all: those tabs read characters, not entries.
const TABS: { key: string; label: string; type?: string; tag?: string }[] = [
  { key: "note", label: "Notes", type: "note" },
  { key: "location", label: "Locations", type: "location" },
  { key: "faction", label: "Factions", type: "lore", tag: "faction" },
  { key: "item", label: "Items", type: "lore", tag: "item" },
  { key: "lore", label: "Lore", type: "lore" },
  { key: "npc", label: "NPCs" },
  { key: "pc", label: "PCs" },
];

// Tags that promote a lore entry into its own tab. Anything here is excluded from Lore.
// Add a tag to a tab above and to this set together, or the entry will show in both.
const RESERVED_TAGS = new Set(TABS.map((t) => t.tag).filter((t): t is string => !!t));

function tabDef(key: string) {
  return TABS.find((t) => t.key === key);
}

function matchesTab(e: { type: string; tags: string[] | null }, key: string): boolean {
  const d = tabDef(key);
  if (!d?.type || e.type !== d.type) return false;
  const tags = e.tags || [];
  if (d.tag) return tags.includes(d.tag);
  return !tags.some((t) => RESERVED_TAGS.has(t));
}

const VIS: { v: string; l: string }[] = [
  { v: "common", l: "Common knowledge" },
  { v: "player", l: "Party knows" },
  { v: "gm", l: "GM secret" },
  { v: "private", l: "Private (only me)" },
];

const blankForm = {
  title: "",
  body: "",
  name: "",
  description: "",
  visibility: "gm",
  tags: "",
};

type EntryReveal = { id: string; target_type: string; target_id: string; revealed_to_character_id: string };

export default function CodexPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [chars, setChars] = useState<Char[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [tab, setTab] = useState<string>("note");
  const [mode, setMode] = useState<Mode | null>(null);
  const [form, setForm] = useState<{ title: string; body: string; name: string; description: string; visibility: string; tags: string }>(blankForm);
  const [saving, setSaving] = useState<boolean>(false);
  const [linkPick, setLinkPick] = useState<string>("");
  const [linkRel, setLinkRel] = useState<string>("");
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [beats, setBeats] = useState<GmBeat[]>([]);
  const [reveals, setReveals] = useState<EntryReveal[]>([]);
  const [revealPick, setRevealPick] = useState<string>("");
  const player = useMomentPlayer();

  // ---- lookups ----
  const labelOf = (type: string, id: string): string => {
    if (type === "character") {
      const c = chars.find((x) => x.id === id);
      return c ? `${c.kind === "pc" ? "PC" : "NPC"}: ${c.name}` : "character";
    }
    const e = entries.find((x) => x.id === id);
    if (!e) return type;
    const t = e.type.charAt(0).toUpperCase() + e.type.slice(1);
    return `${t}: ${e.title}`;
  };

  // ---- load ----
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("created_at", { ascending: true });
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  async function reload(cid: string) {
    const [{ data: e }, { data: c }, { data: l }, { data: ss }, { data: rv }] = await Promise.all([
      supabase.from("entries").select("id, type, title, body, visibility, tags").eq("campaign_id", cid).order("title"),
      supabase.from("characters").select("id, name, kind, description, visibility, tags, class, subclass").eq("campaign_id", cid).order("name"),
      supabase.from("entity_links").select("id, source_type, source_id, target_type, target_id, relation").eq("campaign_id", cid),
      supabase.from("sessions").select("id, session_number").eq("campaign_id", cid),
      supabase.from("entry_reveals").select("id, target_type, target_id, revealed_to_character_id").eq("campaign_id", cid),
    ]);
    setEntries((e as Entry[]) || []);
    setChars((c as Char[]) || []);
    setLinks((l as Link[]) || []);
    setSessions((ss as Sess[]) || []);
    setReveals((rv as EntryReveal[]) || []);
  }

  useEffect(() => {
    if (!campaignId) return;
    setMode(null);
    reload(campaignId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // ---- open / new ----
  function openEntry(e: Entry) {
    setMode({ what: "entry", type: e.type, tag: tabDef(tab)?.tag ?? null, id: e.id });
    setForm({ title: e.title, body: e.body || "", name: "", description: "", visibility: e.visibility, tags: (e.tags || []).join(", ") });
  }
  function openChar(c: Char) {
    setMode({ what: "character", id: c.id });
    setForm({ title: "", body: "", name: c.name, description: c.description || "", visibility: c.visibility, tags: (c.tags || []).join(", ") });
  }
  function newItem() {
    if (tab === "pc") return;
    if (tab === "npc") {
      setMode({ what: "character", id: null });
      setForm({ ...blankForm, visibility: "player" });
    } else {
      const d = tabDef(tab);
      setMode({ what: "entry", type: d?.type || tab, tag: d?.tag ?? null, id: null });
      // Seed the tags field with the tab's reserved tag so the GM can see why the entry
      // will land where it does, and can add their own alongside it.
      setForm({ ...blankForm, visibility: tab === "note" ? "gm" : "player", tags: d?.tag || "" });
    }
  }

  function parseTags(s: string): string[] {
    return s.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  }

  // ---- save ----
  async function save() {
    if (!mode || !campaignId) return;
    setSaving(true);
    const tags = parseTags(form.tags);
    if (mode.what === "entry") {
      if (!form.title.trim()) { setSaving(false); return; }
      // Re-apply the tab's reserved tag if it was edited away. Without this, clearing the
      // tags field on a faction silently demotes it to plain lore and it vanishes from the
      // tab it was created in, which reads as data loss rather than a tag change.
      const entryTags = mode.tag && !tags.includes(mode.tag) ? [...tags, mode.tag] : tags;
      if (mode.id) {
        await supabase.from("entries").update({ title: form.title.trim(), body: form.body, visibility: form.visibility, tags: entryTags }).eq("id", mode.id);
      } else {
        const { data } = await supabase.from("entries")
          .insert({ campaign_id: campaignId, type: mode.type, title: form.title.trim(), body: form.body, visibility: form.visibility, tags: entryTags })
          .select("id, type, title, body, visibility, tags").single();
        if (data) setMode({ what: "entry", type: (data as Entry).type, tag: mode.tag ?? null, id: (data as Entry).id });
      }
    } else {
      if (mode.id) {
        await supabase.from("characters").update({ name: form.name.trim(), description: form.description, visibility: form.visibility, tags }).eq("id", mode.id);
      } else {
        if (!form.name.trim()) { setSaving(false); return; }
        const { data } = await supabase.from("characters")
          .insert({ campaign_id: campaignId, kind: "npc", name: form.name.trim(), description: form.description, visibility: form.visibility, tags })
          .select("id, name, kind, description, visibility, tags, class, subclass").single();
        if (data) setMode({ what: "character", id: (data as Char).id });
      }
    }
    await reload(campaignId);
    setSaving(false);
  }

  async function remove() {
    if (!mode || !mode.id) return;
    const table = mode.what === "entry" ? "entries" : "characters";
    await supabase.from(table).delete().eq("id", mode.id);
    setMode(null);
    await reload(campaignId);
  }

  // ---- connections ----
  const curType = mode && mode.what === "entry" ? "entry" : "character";
  const curId = mode ? mode.id : null;
  const myLinks = links.filter((l) => (l.source_type === curType && l.source_id === curId) || (l.target_type === curType && l.target_id === curId));

  // ---- NPC "from play" enrichment ----
  const curChar = mode && mode.what === "character" && mode.id ? chars.find((c) => c.id === mode.id) || null : null;
  const isNpc = !!curChar && curChar.kind === "npc";
  const sessNo = (sid: string | null): string => {
    if (!sid) return "";
    const s = sessions.find((x) => x.id === sid);
    return s && s.session_number !== null ? `S${s.session_number}` : "";
  };

  async function loadNpcBeats(charId: string) {
    const { data } = await supabase
      .from("gm_events")
      .select("id, kind, summary, quote, session_id, t_start_seconds, audio_track_id, created_at")
      .eq("campaign_id", campaignId)
      .eq("npc_id", charId)
      .in("kind", NPC_BEAT_KINDS)
      .order("created_at", { ascending: false });
    setBeats((data as GmBeat[]) || []);
  }

  useEffect(() => {
    if (isNpc && mode?.id && campaignId) loadNpcBeats(mode.id);
    else setBeats([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode?.id, isNpc, campaignId]);

  async function addLink() {
    if (!mode || !mode.id || !linkPick || !campaignId) return;
    const sep = linkPick.indexOf(":");
    const tType = linkPick.slice(0, sep);
    const tId = linkPick.slice(sep + 1);
    await supabase.from("entity_links").insert({
      campaign_id: campaignId,
      source_type: curType,
      source_id: mode.id,
      target_type: tType,
      target_id: tId,
      relation: linkRel.trim() || null,
    });
    setLinkPick("");
    setLinkRel("");
    await reload(campaignId);
  }
  async function removeLink(id: string) {
    await supabase.from("entity_links").delete().eq("id", id);
    await reload(campaignId);
  }

  async function revealTo(pcId: string) {
    if (!pcId || !mode?.id) return;
    const target_type = mode.what === "entry" ? "entry" : "character";
    const { data, error } = await supabase.from("entry_reveals")
      .insert({ campaign_id: campaignId, target_type, target_id: mode.id, revealed_to_character_id: pcId })
      .select("id, target_type, target_id, revealed_to_character_id").single();
    if (!error && data) { setReveals((arr) => [...arr, data as EntryReveal]); setRevealPick(""); }
  }

  async function revokeReveal(id: string) {
    await supabase.from("entry_reveals").delete().eq("id", id);
    setReveals((arr) => arr.filter((r) => r.id !== id));
  }

  // ---- list for active tab ----
  const listItems = tab === "pc" || tab === "npc"
    ? chars.filter((c) => c.kind === tab)
    : entries.filter((e) => matchesTab(e, tab));

  const box = { ...surfaces.slate, padding: 18 } as const;
  const input = {
    width: "100%", boxSizing: "border-box" as const, background: C.surface2, color: C.text,
    border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 14, outline: "none",
  };

  return (
    <PageShell width={1040}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Codex</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 18px" }}>
        Notes, lore, places, and the cast. Tag anything to the PCs it involves; set who can see it.
      </p>

        {/* campaign + tabs */}
        <div style={{ ...box, marginBottom: 16 }}>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ ...input }}>
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            {TABS.map((t) => {
              const on = tab === t.key;
              return (
                <button key={t.key} type="button" onClick={() => { setTab(t.key); setMode(null); }}
                  style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${on ? C.sun : C.line}`,
                    background: on ? C.sun : C.surface2, color: on ? SAX.inkDeep : C.text, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
          {/* list */}
          <div style={{ ...box, flex: "1 1 240px", minWidth: 240, maxWidth: 320 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>
                {TABS.find((t) => t.key === tab)?.label.toUpperCase()}
              </span>
              {tab !== "pc" && (
                <button type="button" onClick={newItem} style={{ background: C.sun, color: SAX.inkDeep, border: "none", borderRadius: 7, padding: "5px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  + New
                </button>
              )}
            </div>
            {listItems.length === 0 && (
              <p style={{ color: C.muted, fontSize: 13 }}>
                {tab === "pc" ? "PCs come from the roster in Workspace." : "Nothing here yet."}
              </p>
            )}
            <div style={{ display: "grid", gap: 6 }}>
              {listItems.map((it) => {
                const isChar = tab === "pc" || tab === "npc";
                const label = isChar ? (it as Char).name : (it as Entry).title;
                const vis = (it as Entry | Char).visibility;
                const active = mode && mode.id === it.id;
                return (
                  <button key={it.id} type="button"
                    onClick={() => isChar ? openChar(it as Char) : openEntry(it as Entry)}
                    style={{ textAlign: "left", padding: "9px 11px", borderRadius: 8,
                      border: `1px solid ${active ? C.plum : C.line}`,
                      background: active ? "rgba(155,123,212,0.14)" : C.surface2, color: C.text, cursor: "pointer" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{VIS.find((v) => v.v === vis)?.l || vis}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* editor */}
          <div style={{ ...box, flex: "2 1 360px", minWidth: 300 }}>
            {!mode ? (
              <p style={{ color: C.muted, fontSize: 14 }}>Pick something on the left, or hit New to start one.</p>
            ) : (
              <>
                {mode.what === "entry" ? (
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" style={{ ...input, fontSize: 16, fontWeight: 600, marginBottom: 12 }} />
                ) : (
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" style={{ ...input, fontSize: 16, fontWeight: 600, marginBottom: 12 }} />
                )}

                <textarea
                  value={mode.what === "entry" ? form.body : form.description}
                  onChange={(e) => setForm(mode.what === "entry" ? { ...form, body: e.target.value } : { ...form, description: e.target.value })}
                  placeholder={mode.what === "entry" ? "Body (markdown)" : "Description (markdown)"}
                  rows={8}
                  style={{ ...input, fontFamily: "inherit", resize: "vertical", marginBottom: 12 }}
                />

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: "1 1 160px" }}>
                    <label style={{ fontSize: 11, color: C.muted }}>Who can see this</label>
                    <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })} style={{ ...input, marginTop: 4 }}>
                      {VIS.map((v) => (<option key={v.v} value={v.v}>{v.l}</option>))}
                    </select>
                  </div>
                  <div style={{ flex: "1 1 160px" }}>
                    <label style={{ fontSize: 11, color: C.muted }}>Tags (comma-separated)</label>
                    <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="forest, ruin, hook" style={{ ...input, marginTop: 4 }} />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                  <button type="button" onClick={save} disabled={saving}
                    style={{ background: `linear-gradient(90deg, ${C.sun}, ${C.sunSoft})`, color: SAX.inkDeep, border: "none", borderRadius: 9, padding: "10px 20px", fontWeight: 700, fontSize: 14, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  {mode.id && (
                    <button type="button" onClick={remove}
                      style={{ background: "transparent", color: C.warn, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>
                      Delete
                    </button>
                  )}
                </div>

                {/* connections */}
                {mode.id ? (
                  <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Connections</div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
                      Link this to the PCs it involves, or to any NPC, place, or lore.
                    </div>
                    {myLinks.length > 0 && (
                      <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                        {myLinks.map((l) => {
                          const otherIsSource = !(l.source_type === curType && l.source_id === curId);
                          const oType = otherIsSource ? l.source_type : l.target_type;
                          const oId = otherIsSource ? l.source_id : l.target_id;
                          return (
                            <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px" }}>
                              <span style={{ fontSize: 13 }}>
                                {labelOf(oType, oId)}
                                {l.relation && <span style={{ color: C.muted }}> · {l.relation}</span>}
                              </span>
                              <button type="button" onClick={() => removeLink(l.id)} style={{ background: "transparent", color: C.muted, border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <select value={linkPick} onChange={(e) => setLinkPick(e.target.value)} style={{ ...input, flex: "2 1 200px" }}>
                        <option value="">Link to…</option>
                        <optgroup label="PCs">
                          {chars.filter((c) => c.kind === "pc" && c.id !== curId).map((c) => (<option key={c.id} value={`character:${c.id}`}>{c.name}</option>))}
                        </optgroup>
                        <optgroup label="NPCs">
                          {chars.filter((c) => c.kind === "npc" && c.id !== curId).map((c) => (<option key={c.id} value={`character:${c.id}`}>{c.name}</option>))}
                        </optgroup>
                        <optgroup label="Places & lore & notes">
                          {entries.filter((e) => e.id !== curId).map((e) => (<option key={e.id} value={`entry:${e.id}`}>{labelOf("entry", e.id)}</option>))}
                        </optgroup>
                      </select>
                      <input value={linkRel} onChange={(e) => setLinkRel(e.target.value)} placeholder="relation (optional)" style={{ ...input, flex: "1 1 140px" }} />
                      <button type="button" onClick={addLink} disabled={!linkPick}
                        style={{ background: C.plum, color: SAX.inkDeep, border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 700, fontSize: 13, cursor: linkPick ? "pointer" : "default", opacity: linkPick ? 1 : 0.6 }}>
                        Link
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14, fontSize: 12, color: C.muted }}>
                    Save first, then you can add connections.
                  </div>
                )}

                {/* reveal to specific players */}
                {mode.id && (mode.what === "entry" || isNpc) && (() => {
                  const curTargetType = mode.what === "entry" ? "entry" : "character";
                  const curReveals = reveals.filter((r) => r.target_type === curTargetType && r.target_id === mode.id);
                  return (
                    <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 16, marginTop: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Revealed to</div>
                      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
                        Show this to specific players when the story earns it, even while it stays a secret to everyone else. Party-visible items already reach the whole table.
                      </div>
                      {curReveals.length > 0 && (
                        <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                          {curReveals.map((r) => {
                            const pc = chars.find((c) => c.id === r.revealed_to_character_id);
                            return (
                              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px" }}>
                                <span style={{ fontSize: 13 }}>{pc ? pc.name : "a player"}</span>
                                <button type="button" onClick={() => revokeReveal(r.id)} style={{ background: "transparent", color: C.muted, border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <select value={revealPick} onChange={(e) => setRevealPick(e.target.value)} style={{ ...input, flex: "2 1 200px" }}>
                          <option value="">Reveal to…</option>
                          {chars.filter((c) => c.kind === "pc" && !curReveals.some((r) => r.revealed_to_character_id === c.id)).map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => revealTo(revealPick)} disabled={!revealPick}
                          style={{ background: C.sun, color: SAX.inkDeep, border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 700, fontSize: 13, cursor: revealPick ? "pointer" : "default", opacity: revealPick ? 1 : 0.6 }}>
                          Reveal
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* From play: read-only accretion from GM narration. This is also
                    the seam for a future "draft description from these beats" button. */}
                {isNpc && mode.id && (
                  <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 16, marginTop: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>From play</div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
                      What your GM narration said about {form.name || "this NPC"}, newest first. Approved on Review; nothing here overwrites your description.
                    </div>
                    {player.error && <p style={{ color: C.warn, fontSize: 12.5, marginBottom: 10 }}>{player.error}</p>}
                    {beats.length === 0 ? (
                      <p style={{ color: C.muted, fontSize: 13 }}>
                        No narrated beats yet. Approve npc events for this character on Review (use Accept + create NPC) and they gather here.
                      </p>
                    ) : (
                      <div style={{ display: "grid", gap: 8 }}>
                        {beats.map((b) => (
                          <div key={b.id} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 11, color: C.plum, fontFamily: "ui-monospace, monospace", letterSpacing: "0.04em" }}>
                                {BEAT_LABEL[b.kind] || b.kind}{sessNo(b.session_id) ? ` · ${sessNo(b.session_id)}` : ""}
                              </span>
                              {b.audio_track_id && (
                                <MomentButton active={player.activeId === b.id} loading={player.loadingId === b.id} tStart={b.t_start_seconds}
                                  onClick={() => player.play(b.id, b.audio_track_id, b.t_start_seconds)} />
                              )}
                            </div>
                            <div style={{ fontSize: 13.5, color: C.text, marginTop: 6, lineHeight: 1.5 }}>{b.summary}</div>
                            {b.quote && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6, fontStyle: "italic" }}>{"\u201c"}{b.quote}{"\u201d"}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
      </div>
    </PageShell>
  );
}
