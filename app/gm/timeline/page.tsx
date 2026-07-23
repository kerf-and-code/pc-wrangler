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
  good: SAX.good,
  warn: SAX.warn,
};

type Campaign = { id: string; name: string };
type Sess = { id: string; session_number: number | null; status: string; started_at: string | null; scheduled_at: string | null };
type Arc = { id: string; title: string; status: string; character_id: string | null; opened_session_id: string | null };
type Touch = { id: string; arc_id: string; session_id: string | null };
type Loot = { id: string; session_id: string | null; character_id: string | null; item_name: string; rarity: string | null; est_value: number | null };
type Char = { id: string; name: string; kind: string };
// Only the columns the timeline needs. summary and kind are pulled so a future change can
// show the beat itself under a place; today they are unused on purpose, because a session
// with 40 beats would drown the arcs and loot this page exists to show.
type GmEv = { id: string; session_id: string | null; npc_id: string | null; location_id: string | null; faction_id: string | null };
type Entry = { id: string; title: string; type: string; tags: string[] | null };

export default function TimelinePage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [touches, setTouches] = useState<Touch[]>([]);
  const [loot, setLoot] = useState<Loot[]>([]);
  const [gmEvents, setGmEvents] = useState<GmEv[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  // Trace one place, person, or faction through the campaign. Keyed "loc:<id>",
  // "npc:<id>", "fac:<id>" so one dropdown can hold all three without colliding on ids.
  const [entity, setEntity] = useState<string>("");
  const [chars, setChars] = useState<Char[]>([]);
  const [pc, setPc] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("created_at");
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    (async () => {
      // gm_events is PAGED. It is the one table here that grows without bound: a campaign
      // accumulates every narration beat of every session, and an unbounded select would
      // silently stop at PostgREST's 1000-row cap. That exact cap truncated extraction and
      // the recap earlier this month, and the failure looks like a short campaign rather
      // than a bug, so it is worth paying for up front.
      const loadGmEvents = async (): Promise<GmEv[]> => {
        const PAGE = 1000;
        const out: GmEv[] = [];
        for (let page = 0; page < 50; page++) {
          const from = page * PAGE;
          const { data, error } = await supabase
            .from("gm_events")
            .select("id, session_id, npc_id, location_id, faction_id")
            .eq("campaign_id", campaignId)
            .order("id", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) break;
          const rows = (data as GmEv[]) || [];
          out.push(...rows);
          if (rows.length < PAGE) break;
        }
        return out;
      };

      const [{ data: s }, { data: a }, { data: t }, { data: l }, { data: c }, { data: en }, gm] = await Promise.all([
        supabase.from("sessions").select("id, session_number, status, started_at, scheduled_at").eq("campaign_id", campaignId).order("session_number", { ascending: true }),
        supabase.from("arcs").select("id, title, status, character_id, opened_session_id").eq("campaign_id", campaignId),
        supabase.from("arc_touches").select("id, arc_id, session_id").eq("campaign_id", campaignId),
        supabase.from("loot_grants").select("id, session_id, character_id, item_name, rarity, est_value").eq("campaign_id", campaignId),
        supabase.from("characters").select("id, name, kind").eq("campaign_id", campaignId),
        // Places are entries of type 'location'; factions are 'lore' tagged 'faction',
        // which is the shape /api/gm-review creates rather than a type of their own.
        supabase.from("entries").select("id, title, type, tags").eq("campaign_id", campaignId),
        loadGmEvents(),
      ]);
      if (!active) return;
      setSessions((s as Sess[]) || []);
      setArcs((a as Arc[]) || []);
      setTouches((t as Touch[]) || []);
      setLoot((l as Loot[]) || []);
      setChars((c as Char[]) || []);
      setEntries((en as Entry[]) || []);
      setGmEvents(gm);
      setEntity("");
    })();
    return () => { active = false; };
  }, [campaignId, supabase]);

  const nameOf = (id: string | null): string => {
    if (!id) return "";
    const c = chars.find((x) => x.id === id);
    return c ? c.name : "";
  };
  const arcById = (id: string): Arc | undefined => arcs.find((a) => a.id === id);
  const entryById = (id: string): Entry | undefined => entries.find((e) => e.id === id);
  const titleOf = (id: string | null): string => (id ? entryById(id)?.title || "" : "");

  // Distinct ids in first-seen order, so a session's chips read in the order the beats
  // happened rather than alphabetically.
  const distinct = (ids: (string | null)[]): string[] => {
    const seen: string[] = [];
    for (const id of ids) if (id && !seen.includes(id)) seen.push(id);
    return seen;
  };

  const pcs = chars.filter((c) => c.kind === "pc");
  const dateOf = (s: Sess): string => {
    const d = s.started_at || s.scheduled_at;
    if (!d) return "";
    try { return new Date(d).toLocaleDateString(); } catch (e) { return ""; }
  };

  // build per-session bundles, honoring the PC filter
  const nodes = sessions.map((s) => {
    let opened = arcs.filter((a) => a.opened_session_id === s.id);
    let touched = touches.filter((t) => t.session_id === s.id).map((t) => arcById(t.arc_id)).filter((a): a is Arc => !!a);
    let grants = loot.filter((g) => g.session_id === s.id);
    if (pc) {
      opened = opened.filter((a) => a.character_id === pc);
      touched = touched.filter((a) => a.character_id === pc);
      grants = grants.filter((g) => g.character_id === pc);
    }
    // Deliberately NOT filtered by the PC trace. Where the party went and who they met is
    // context for the session, not something one character owns, and hiding it would make
    // a traced session read as if it happened nowhere.
    const ev = gmEvents.filter((g) => g.session_id === s.id);
    const places = distinct(ev.map((g) => g.location_id));
    const met = distinct(ev.map((g) => g.npc_id));
    const factions = distinct(ev.map((g) => g.faction_id));
    return { s, opened, touched, grants, places, met, factions };
  })
    .filter((n) => !pc || n.opened.length > 0 || n.touched.length > 0 || n.grants.length > 0)
    .filter((n) => {
      if (!entity) return true;
      const [kind, id] = entity.split(":");
      if (kind === "loc") return n.places.includes(id);
      if (kind === "npc") return n.met.includes(id);
      if (kind === "fac") return n.factions.includes(id);
      return true;
    });

  // Dropdown contents. Only entities that actually appear in a beat are offered, so the
  // list is what the campaign has visited rather than everything in the Codex.
  const seenIds = (pick: (g: GmEv) => string | null): string[] => distinct(gmEvents.map(pick));
  const placeOpts = seenIds((g) => g.location_id)
    .map((id) => ({ key: `loc:${id}`, name: titleOf(id) })).filter((o) => o.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  const npcOpts = seenIds((g) => g.npc_id)
    .map((id) => ({ key: `npc:${id}`, name: nameOf(id) })).filter((o) => o.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  const facOpts = seenIds((g) => g.faction_id)
    .map((id) => ({ key: `fac:${id}`, name: titleOf(id) })).filter((o) => o.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  const box = { ...surfaces.slate, padding: 18 } as const;
  const input = { width: "100%", boxSizing: "border-box" as const, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 13px", fontSize: 15, outline: "none" };

  // Entities render as chips rather than bulleted Rows on purpose: a busy session can name
  // a dozen of them, and a dozen more bullets would bury the arcs and loot underneath.
  const Chip = ({ color, children }: { color: string; children: React.ReactNode }) => (
    <span style={{
      display: "inline-block", fontSize: 12, lineHeight: 1.4, padding: "2px 8px",
      borderRadius: 999, border: `1px solid ${color}55`, background: `${color}14`, color,
    }}>{children}</span>
  );
  const ChipRow = ({ label, color, children }: { label: string; color: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", marginTop: 8 }}>
      <span style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 52 }}>{label}</span>
      {children}
    </div>
  );

  const Row = ({ color, children }: { color: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13, marginTop: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: 7, background: color, flexShrink: 0, transform: "translateY(2px)" }} />
      <span>{children}</span>
    </div>
  );

  return (
    <PageShell width={820}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Timeline</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 6px" }}>
        The campaign session by session: where the party went, who they met, arcs opened and advanced, loot handed out. Trace one PC to follow their arc, or one place, person, or faction to see every session it turns up in.
      </p>
      <p style={{ color: C.muted, fontSize: 12.5, margin: "0 0 18px" }}>
        Loose ends captured from your narration (framing, hooks, quests) live on the <a href="/gm/prep" style={{ color: C.plum, textDecoration: "none", borderBottom: `1px solid ${C.plum}` }}>Prep sheet</a>.
      </p>

        <div style={{ ...box, marginBottom: 18 }}>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ ...input, marginBottom: 12 }}>
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: C.muted }}>Trace:</span>
            <select value={pc} onChange={(e) => setPc(e.target.value)} style={{ ...input, width: "auto", flex: "0 1 200px", padding: "8px 10px", fontSize: 13 }}>
              <option value="">the whole party</option>
              {pcs.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
            {(placeOpts.length > 0 || npcOpts.length > 0 || facOpts.length > 0) && (
              <select value={entity} onChange={(e) => setEntity(e.target.value)} style={{ ...input, width: "auto", flex: "0 1 220px", padding: "8px 10px", fontSize: 13 }}>
                <option value="">every place and person</option>
                {placeOpts.length > 0 && (
                  <optgroup label="Places">
                    {placeOpts.map((o) => (<option key={o.key} value={o.key}>{o.name}</option>))}
                  </optgroup>
                )}
                {npcOpts.length > 0 && (
                  <optgroup label="People">
                    {npcOpts.map((o) => (<option key={o.key} value={o.key}>{o.name}</option>))}
                  </optgroup>
                )}
                {facOpts.length > 0 && (
                  <optgroup label="Factions">
                    {facOpts.map((o) => (<option key={o.key} value={o.key}>{o.name}</option>))}
                  </optgroup>
                )}
              </select>
            )}
          </div>
        </div>

        {nodes.length === 0 ? (
          <div style={{ ...box, color: C.muted, fontSize: 14 }}>
            {sessions.length === 0
              ? "No sessions logged yet."
              : entity
                ? "That does not turn up in any session yet."
                : "Nothing for that PC yet."}
          </div>
        ) : (
          <div style={{ position: "relative", paddingLeft: 20 }}>
            <div style={{ position: "absolute", left: 6, top: 6, bottom: 6, width: 2, background: C.line }} />
            <div style={{ display: "grid", gap: 14 }}>
              {nodes.map(({ s, opened, touched, grants, places, met, factions }) => (
                <div key={s.id} style={{ position: "relative" }}>
                  <div style={{ position: "absolute", left: -17, top: 18, width: 11, height: 11, borderRadius: 11, background: C.sun, border: `2px solid ${C.bg}` }} />
                  <div style={box}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 16, fontWeight: 700 }}>Session {s.session_number ?? "?"}</span>
                      <span style={{ fontSize: 12, color: C.muted }}>{dateOf(s)}{dateOf(s) ? " · " : ""}{s.status}</span>
                    </div>
                    {opened.length === 0 && touched.length === 0 && grants.length === 0
                      && places.length === 0 && met.length === 0 && factions.length === 0 && (
                      <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>Nothing recorded for this session.</div>
                    )}
                    {places.length > 0 && (
                      <ChipRow label="Where" color={C.sun}>
                        {places.map((id) => (<Chip key={id} color={C.sun}>{titleOf(id)}</Chip>))}
                      </ChipRow>
                    )}
                    {met.length > 0 && (
                      <ChipRow label="Met" color={C.plum}>
                        {met.map((id) => (<Chip key={id} color={C.plum}>{nameOf(id)}</Chip>))}
                      </ChipRow>
                    )}
                    {factions.length > 0 && (
                      <ChipRow label="Factions" color={C.warn}>
                        {factions.map((id) => (<Chip key={id} color={C.warn}>{titleOf(id)}</Chip>))}
                      </ChipRow>
                    )}
                    {opened.map((a) => (
                      <Row key={a.id} color={C.plum}>
                        Opened arc <strong>{a.title}</strong>{a.character_id ? <span style={{ color: C.muted }}> · {nameOf(a.character_id)}</span> : null}
                      </Row>
                    ))}
                    {touched.map((a) => (
                      <Row key={a.id} color={C.good}>
                        Advanced <strong>{a.title}</strong>{a.character_id ? <span style={{ color: C.muted }}> · {nameOf(a.character_id)}</span> : null}
                      </Row>
                    ))}
                    {grants.map((g) => (
                      <Row key={g.id} color={C.sun}>
                        Loot: <strong>{g.item_name}</strong>{g.character_id ? <span style={{ color: C.muted }}> → {nameOf(g.character_id)}</span> : null}{g.est_value ? <span style={{ color: C.muted }}> ({g.est_value} gp)</span> : null}
                      </Row>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
    </PageShell>
  );
}
