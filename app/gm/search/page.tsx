"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX, surfaces, ui } from "@/lib/theme";

const C = {
  bg: SAX.ink,
  surface: SAX.slateBg,
  surface2: "rgba(11,7,18,0.6)",
  line: SAX.line,
  text: SAX.text,
  muted: SAX.muted,
  sun: SAX.sun,
  plum: SAX.plum,
};

type Campaign = { id: string; name: string };
type Entry = { id: string; type: string; title: string; body: string | null; visibility: string; tags: string[] };
type Char = { id: string; name: string; kind: string; description: string | null; tags: string[]; profile_id: string | null };
type Sess = { id: string; session_number: number | null; status: string; notes: string | null };
type Link = { id: string; source_type: string; source_id: string; target_type: string; target_id: string; relation: string | null };
type Arc = { id: string; title: string; status: string; character_id: string | null; opened_session_id: string | null };
type Loot = { id: string; session_id: string | null; character_id: string | null; item_name: string; rarity: string | null; est_value: number | null };
type Seg = { id: string; text: string; start_ms: number | null; job_id: string | null; character_id: string | null };
type Vibe = { id: string; session_id: string | null; profile_id: string | null; satisfaction: number | null; spotlight_feeling: string | null; note: string | null; player_name: string | null };

const TYPE_LABEL: Record<string, string> = { note: "Note", location: "Location", lore: "Lore" };

const fmtTime = (ms: number | null): string => {
  if (ms === null || ms === undefined) return "";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function SearchPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [chars, setChars] = useState<Char[]>([]);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [loot, setLoot] = useState<Loot[]>([]);
  const [vibe, setVibe] = useState<Vibe[]>([]);
  const [jobMeta, setJobMeta] = useState<Record<string, number | null>>({}); // job_id -> session_number
  const [segHits, setSegHits] = useState<Seg[]>([]);
  const [q, setQ] = useState<string>("");
  const [pc, setPc] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("created_at");
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  // Per-campaign load. Each source is independent so one failing (missing table
  // or RLS) leaves the rest searchable rather than blanking the page.
  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    (async () => {
      const [e, c, s, l, a, lt, j, v] = await Promise.all([
        supabase.from("entries").select("id, type, title, body, visibility, tags").eq("campaign_id", campaignId),
        supabase.from("characters").select("id, name, kind, description, tags, profile_id").eq("campaign_id", campaignId),
        supabase.from("sessions").select("id, session_number, status, notes").eq("campaign_id", campaignId),
        supabase.from("entity_links").select("id, source_type, source_id, target_type, target_id, relation").eq("campaign_id", campaignId),
        supabase.from("arcs").select("id, title, status, character_id, opened_session_id").eq("campaign_id", campaignId),
        supabase.from("loot_grants").select("id, session_id, character_id, item_name, rarity, est_value").eq("campaign_id", campaignId),
        supabase.from("capture_jobs").select("id, session:sessions(session_number)").eq("campaign_id", campaignId),
        supabase.from("vibe_checks").select("id, session_id, profile_id, satisfaction, spotlight_feeling, note, player_name").eq("campaign_id", campaignId),
      ]);
      if (!active) return;
      setEntries((e.data as Entry[]) || []);
      setChars((c.data as Char[]) || []);
      setSessions((s.data as Sess[]) || []);
      setLinks((l.data as Link[]) || []);
      setArcs((a.data as Arc[]) || []);
      setLoot((lt.data as Loot[]) || []);
      setVibe((v.data as Vibe[]) || []);
      const jm: Record<string, number | null> = {};
      ((j.data as unknown as { id: string; session: { session_number: number | null } | null }[]) || []).forEach((row) => {
        jm[row.id] = row.session?.session_number ?? null;
      });
      setJobMeta(jm);
    })();
    return () => { active = false; };
  }, [campaignId, supabase]);

  // Transcript search runs server-side (the segment table can be large), scoped
  // by campaign_id, debounced, and only with a real query. transcript_segments
  // carries character_id, so the PC filter applies here too.
  useEffect(() => {
    const ql2 = q.trim().toLowerCase();
    if (!campaignId || ql2.length < 2) { setSegHits([]); return; }
    let active = true;
    const t = setTimeout(async () => {
      let query = supabase
        .from("transcript_segments")
        .select("id, text, start_ms, job_id, character_id")
        .eq("campaign_id", campaignId)
        .ilike("text", `%${ql2}%`);
      if (pc) query = query.eq("character_id", pc);
      const { data } = await query.limit(40);
      if (active) setSegHits((data as Seg[]) || []);
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [q, pc, campaignId, supabase]);

  const labelOf = (type: string, id: string): string => {
    if (type === "character") {
      const c = chars.find((x) => x.id === id);
      return c ? `${c.kind === "pc" ? "PC" : "NPC"} ${c.name}` : "character";
    }
    if (type === "arc") {
      const a = arcs.find((x) => x.id === id);
      return a ? `Thread ${a.title}` : "thread";
    }
    const e = entries.find((x) => x.id === id);
    return e ? `${TYPE_LABEL[e.type] || e.type} ${e.title}` : "entry";
  };

  const nameOf = (id: string | null): string => {
    if (!id) return "";
    const c = chars.find((x) => x.id === id);
    return c ? c.name : "";
  };

  // Cross-references: entity_links in both directions, plus the direct foreign
  // keys that tie threads and loot to a character so those surface too.
  const connectionsOf = (type: string, id: string): string[] => {
    const out: string[] = [];
    for (const l of links) {
      if (l.source_type === type && l.source_id === id) out.push(labelOf(l.target_type, l.target_id));
      else if (l.target_type === type && l.target_id === id) out.push(labelOf(l.source_type, l.source_id));
    }
    if (type === "character") {
      arcs.filter((a) => a.character_id === id).forEach((a) => out.push(`Thread ${a.title}`));
      loot.filter((g) => g.character_id === id).forEach((g) => out.push(`Loot ${g.item_name}`));
    }
    if (type === "arc") {
      const a = arcs.find((x) => x.id === id);
      if (a?.character_id) out.push(labelOf("character", a.character_id));
    }
    return Array.from(new Set(out));
  };

  const linkedToPc = (type: string, id: string): boolean => {
    if (!pc) return true;
    if (type === "arc") { const a = arcs.find((x) => x.id === id); if (a?.character_id === pc) return true; }
    return links.some(
      (l) =>
        (l.source_type === type && l.source_id === id && l.target_type === "character" && l.target_id === pc) ||
        (l.target_type === type && l.target_id === id && l.source_type === "character" && l.source_id === pc),
    );
  };

  const ql = q.trim().toLowerCase();
  const hit = (s: string | null): boolean => !!s && s.toLowerCase().includes(ql);

  const eHits = !ql && !pc ? [] : entries.filter((e) => (!ql || hit(e.title) || hit(e.body) || e.tags.some((t) => t.toLowerCase().includes(ql))) && linkedToPc("entry", e.id));
  const cHits = !ql && !pc ? [] : chars.filter((c) => (!ql || hit(c.name) || hit(c.description) || c.tags.some((t) => t.toLowerCase().includes(ql))) && linkedToPc("character", c.id));
  const aHits = !ql && !pc ? [] : arcs.filter((a) => (!ql || hit(a.title) || hit(a.status)) && linkedToPc("arc", a.id));
  const lHits = !ql && !pc ? [] : loot.filter((g) => (!ql || hit(g.item_name) || hit(g.rarity)) && (!pc || g.character_id === pc));
  const sHits = pc || !ql ? [] : sessions.filter((s) => hit(s.notes) || String(s.session_number ?? "") === ql);
  const pcProfile = chars.find((c) => c.id === pc)?.profile_id || null;
  const vHits = !ql && !pc ? [] : vibe.filter((v) => (!ql || hit(v.note) || hit(v.player_name)) && (!pc || (!!pcProfile && v.profile_id === pcProfile)));
  const tHits = segHits;

  const snippet = (body: string | null): string => {
    if (!body) return "";
    if (!ql) return body.slice(0, 140);
    const i = body.toLowerCase().indexOf(ql);
    if (i < 0) return body.slice(0, 140);
    const start = Math.max(0, i - 50);
    return (start > 0 ? "…" : "") + body.slice(start, start + 140);
  };

  const pcs = chars.filter((c) => c.kind === "pc");
  const box = { ...surfaces.slate, padding: 18 } as const;
  const input = { width: "100%", boxSizing: "border-box" as const, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 13px", fontSize: 15, outline: "none" };
  const cardInner = { background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 13px" } as const;
  const sectionLabel = { fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em", marginBottom: 10 } as const;

  const Chips = ({ items }: { items: string[] }) =>
    items.length === 0 ? null : (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {items.map((t, i) => (
          <span key={i} style={{ fontSize: 11, color: C.plum, background: "rgba(155,123,212,0.14)", border: `1px solid ${C.line}`, borderRadius: 999, padding: "2px 9px" }}>{t}</span>
        ))}
      </div>
    );

  const total = eHits.length + cHits.length + aHits.length + lHits.length + sHits.length + vHits.length + tHits.length;

  return (
    <PageShell width={880}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Search</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 18px" }}>
        That time in Middlebrook with the librarian and Bobble, a few keystrokes away. Spans cast, notes, places, story threads, loot, session logs, player check-ins, and transcripts.
      </p>

      <div style={{ ...box, marginBottom: 16 }}>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ ...input, marginBottom: 12 }}>
          {campaigns.length === 0 && <option value="">No campaigns yet</option>}
          {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cast, notes, lore, places, threads, loot, logs, check-ins, transcripts…" style={{ ...input, marginBottom: 12 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.muted }}>Involving:</span>
          <select value={pc} onChange={(e) => setPc(e.target.value)} style={{ ...input, width: "auto", flex: "0 1 200px", padding: "8px 10px", fontSize: 13 }}>
            <option value="">any PC</option>
            {pcs.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          {pc && <span style={{ fontSize: 11, color: C.muted }}>(threads, loot, notes, cast, check-ins, and transcripts tied to this PC)</span>}
        </div>
      </div>

      {(ql || pc) && (
        <div style={{ color: C.muted, fontSize: 13, margin: "0 0 12px" }}>{total} result{total === 1 ? "" : "s"}</div>
      )}

      {cHits.length > 0 && (
        <div style={{ ...box, marginBottom: 14 }}>
          <div style={sectionLabel}>CAST</div>
          <div style={{ display: "grid", gap: 10 }}>
            {cHits.map((c) => (
              <div key={c.id} style={cardInner}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name} <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· {c.kind === "pc" ? "PC" : "NPC"}</span></div>
                {c.description && <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{snippet(c.description)}</div>}
                <Chips items={connectionsOf("character", c.id)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {eHits.length > 0 && (
        <div style={{ ...box, marginBottom: 14 }}>
          <div style={sectionLabel}>NOTES · LORE · PLACES</div>
          <div style={{ display: "grid", gap: 10 }}>
            {eHits.map((e) => (
              <div key={e.id} style={cardInner}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{e.title} <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· {TYPE_LABEL[e.type] || e.type}</span></div>
                {e.body && <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{snippet(e.body)}</div>}
                <Chips items={connectionsOf("entry", e.id)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {aHits.length > 0 && (
        <div style={{ ...box, marginBottom: 14 }}>
          <div style={sectionLabel}>STORY THREADS</div>
          <div style={{ display: "grid", gap: 10 }}>
            {aHits.map((a) => (
              <div key={a.id} style={cardInner}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{a.title} <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· {a.status}</span></div>
                {a.character_id && <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{nameOf(a.character_id)}</div>}
                <Chips items={connectionsOf("arc", a.id)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {lHits.length > 0 && (
        <div style={{ ...box, marginBottom: 14 }}>
          <div style={sectionLabel}>LOOT</div>
          <div style={{ display: "grid", gap: 10 }}>
            {lHits.map((g) => (
              <div key={g.id} style={cardInner}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{g.item_name}{g.rarity ? <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}> · {g.rarity}</span> : null}</div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
                  {g.character_id ? `→ ${nameOf(g.character_id)}` : "unassigned"}{g.est_value ? ` · ${g.est_value} gp` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sHits.length > 0 && (
        <div style={{ ...box, marginBottom: 14 }}>
          <div style={sectionLabel}>SESSION LOGS</div>
          <div style={{ display: "grid", gap: 10 }}>
            {sHits.map((s) => (
              <div key={s.id} style={cardInner}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Session {s.session_number ?? "?"} <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· {s.status}</span></div>
                {s.notes && <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{snippet(s.notes)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {vHits.length > 0 && (
        <div style={{ ...box, marginBottom: 14 }}>
          <div style={sectionLabel}>PLAYER CHECK-INS</div>
          <div style={{ display: "grid", gap: 10 }}>
            {vHits.map((v) => (
              <div key={v.id} style={cardInner}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {v.player_name || "Anonymous"}
                  {v.satisfaction !== null ? <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}> · felt {v.satisfaction}/5</span> : null}
                  {v.spotlight_feeling ? <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}> · spotlight: {v.spotlight_feeling.replace(/_/g, " ")}</span> : null}
                </div>
                {v.note && <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{snippet(v.note)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tHits.length > 0 && (
        <div style={{ ...box, marginBottom: 14 }}>
          <div style={sectionLabel}>TRANSCRIPT</div>
          <div style={{ display: "grid", gap: 10 }}>
            {tHits.map((seg) => (
              <div key={seg.id} style={cardInner}>
                <div style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", marginBottom: 4 }}>
                  Session {(seg.job_id ? jobMeta[seg.job_id] : null) ?? "?"}{seg.start_ms !== null ? ` · ${fmtTime(seg.start_ms)}` : ""}
                </div>
                <div style={{ fontSize: 13, color: C.text }}>{"\u201c"}{snippet(seg.text)}{"\u201d"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(ql || pc) && total === 0 && (
        <div style={{ ...box, color: C.muted, fontSize: 14 }}>Nothing matched. Try fewer or different words.</div>
      )}
      {!ql && !pc && (
        <div style={{ ...box, color: C.muted, fontSize: 14 }}>Type a name, place, item, or phrase, or pick a PC to see everything tied to them.</div>
      )}
    </PageShell>
  );
}
