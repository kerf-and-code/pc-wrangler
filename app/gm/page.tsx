"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import WranglerNav from "@/components/wrangler-nav";

// Palette consistent with the TPDI front door.
const C = {
  ink: "#1B1426", panel: "#251B33", line: "#3D2F52", vellum: "#F4EEFA",
  muted: "#A597BD", brass: "#F4C430", brassDim: "#B89230",
  have: "#5DBE9A", missing: "#E07A5F",
};

// Buckets the analyzer treats as the party's "core" coverage targets.
const CORE = ["healing", "aoe", "single_target", "face", "control", "detect_magic", "utility", "tank", "ranged"];
const LABEL: Record<string, string> = {
  healing: "Healing", aoe: "Area damage", single_target: "Single-target",
  face: "Social / face", control: "Control", detect_magic: "Detect magic",
  utility: "Utility", tank: "Tank / frontline", ranged: "Ranged", melee: "Melee",
  stealth: "Stealth", support: "Support / buff",
};

const PHB_CLASSES = ["Artificer","Barbarian","Bard","Cleric","Druid","Fighter","Monk","Paladin","Ranger","Rogue","Sorcerer","Warlock","Wizard"];

const AXIS_LABEL: Record<string, string> = { N: "Character", T: "Encounter", O: "System", S: "Table", E: "World", I: "Presence" };

const SPECIES = [
  "Aarakocra","Aasimar","Aeormaton","Air Genasi","Astral Elf","Autognome","Bugbear","Centaur",
  "Changeling","Deep Gnome","Dhampir","Dragonborn","Duergar","Dwarf","Earth Genasi","Eladrin","Elf",
  "Fairy","Firbolg","Fire Genasi","Genasi","Giff","Githyanki","Githzerai","Gnome","Goblin","Goliath",
  "Grung","Hadozee","Half-Elf","Half-Orc","Halfling","Harengon","Hexblood","Hobgoblin","Human",
  "Kalashtar","Kender","Kenku","Khoravar","Kobold","Leonin","Lizardfolk","Lotusden Halfling","Loxodon",
  "Minotaur","Orc","Owlin","Pallid Elf","Plasmoid","Reborn","Satyr","Sea Elf","Shadar-kai","Shifter",
  "Simic Hybrid","Tabaxi","Thri-kreen","Tiefling","Tortle","Triton","Vedalken","Verdan","Warforged",
  "Water Genasi","Yuan-ti",
];

const box = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18 };
const inputStyle = { background: C.ink, color: C.vellum, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 11px", fontSize: 14, width: "100%" };
const btn = { background: C.brass, color: C.ink, border: "none", borderRadius: 9, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { background: "none", color: C.brass, border: `1px solid ${C.brassDim}`, borderRadius: 9, padding: "9px 16px", fontSize: 13, cursor: "pointer" };

export default function GMWorkspace() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [caps, setCaps] = useState<any[]>([]); // class_capabilities rows
  const [selected, setSelected] = useState<string | null>(null); // campaign id
  const [characters, setCharacters] = useState<any[]>([]);
  const [dispositions, setDispositions] = useState<any[]>([]);

  // forms
  const [newCampaign, setNewCampaign] = useState({ name: "", system: "5e" });
  const [newChar, setNewChar] = useState({ name: "", class: "", subclass: "", level: "", species: "" });
  const [busy, setBusy] = useState(false);

  // ---- initial load ----
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) { setErr("Please sign in to use the GM workspace."); setLoading(false); } return; }
      if (!active) return;
      setUserId(user.id);
      const [{ data: camps, error: e1 }, { data: capRows, error: e2 }, { data: dispRows }] = await Promise.all([
        supabase.from("campaigns").select("id,name,system,gm_id").order("created_at", { ascending: false }),
        supabase.from("class_capabilities").select("class,subclass,capabilities"),
        supabase.from("tpdi_responses").select("id,player_name,scores,assigned_character_id,respondent_id,created_at").not("player_name", "is", null).order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      if (e1) setErr(e1.message);
      setCampaigns(camps || []);
      setCaps(capRows || []);
      setDispositions(dispRows || []);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [supabase]);

  const loadCharacters = useCallback(async (campaignId: string) => {
    const { data, error } = await supabase
      .from("characters")
      .select("id,name,class,subclass,level,species,active")
      .eq("campaign_id", campaignId).eq("kind", "pc").eq("active", true)
      .order("created_at", { ascending: true });
    if (error) setErr(error.message);
    setCharacters(data || []);
  }, [supabase]);

  useEffect(() => { if (selected) loadCharacters(selected); }, [selected, loadCharacters]);

  // ---- mutations ----
  async function createCampaign() {
    if (!newCampaign.name.trim() || busy) return;
    setBusy(true); setErr(null);
    const { data: camp, error } = await supabase
      .from("campaigns")
      .insert({ name: newCampaign.name.trim(), system: newCampaign.system, gm_id: userId })
      .select().single();
    if (error) { setErr(error.message); setBusy(false); return; }
    // The GM must also be a member (role gm) so member-scoped reads work.
    const { error: mErr } = await supabase
      .from("memberships")
      .insert({ campaign_id: camp.id, profile_id: userId, role: "gm" });
    if (mErr) setErr(mErr.message);
    setCampaigns((cs) => [camp, ...cs]);
    setNewCampaign({ name: "", system: "5e" });
    setSelected(camp.id);
    setBusy(false);
  }

  async function addCharacter() {
    if (!selected || !newChar.name.trim() || !newChar.class || busy) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("characters").insert({
      campaign_id: selected, kind: "pc", profile_id: null,
      name: newChar.name.trim(), class: newChar.class,
      subclass: newChar.subclass.trim() || null,
      level: newChar.level ? Number(newChar.level) : null,
      species: newChar.species.trim() || null,
    });
    if (error) setErr(error.message);
    else { setNewChar({ name: "", class: "", subclass: "", level: "", species: "" }); if (selected) await loadCharacters(selected); }
    setBusy(false);
  }

  async function removeCharacter(id: string) {
    setErr(null);
    const { error } = await supabase.from("characters").update({ active: false }).eq("id", id);
    if (error) setErr(error.message); else if (selected) await loadCharacters(selected);
  }

  async function assignDisposition(responseId: string, characterId: string) {
    if (!selected) return;
    setErr(null);
    const { error } = await supabase.from("tpdi_responses")
      .update({ assigned_character_id: characterId || null, campaign_id: selected })
      .eq("id", responseId);
    if (error) setErr(error.message);
    else setDispositions((ds) => ds.map((d) => (d.id === responseId ? { ...d, assigned_character_id: characterId || null } : d)));
  }

  // ---- coverage analysis (deterministic) ----
  const capIndex = useMemo(() => {
    // class -> baseline caps; "class|subclass" -> subclass caps
    const m: Record<string, string[]> = {};
    for (const r of caps) {
      const key = r.subclass ? `${r.class}|${r.subclass}` : r.class;
      m[key] = r.capabilities || [];
    }
    return m;
  }, [caps]);

  const coverage = useMemo(() => {
    const present = new Set<string>();
    const contributors: Record<string, string[]> = {}; // bucket -> [char names]
    for (const ch of characters) {
      const base = capIndex[ch.class] || [];
      const sub = ch.subclass ? (capIndex[`${ch.class}|${ch.subclass}`] || []) : [];
      for (const b of [...base, ...sub]) {
        present.add(b);
        (contributors[b] ||= []).push(ch.name);
      }
    }
    const missing = CORE.filter((b) => !present.has(b));
    // suggestions: which classes would fill each missing bucket
    const suggestFor = (bucket: string) => {
      const classes: string[] = [];
      for (const r of caps) {
        if ((r.capabilities || []).includes(bucket)) {
          const label = r.subclass ? `${r.class} (${r.subclass})` : r.class;
          if (!classes.includes(label)) classes.push(label);
        }
      }
      return classes.slice(0, 4);
    };
    const suggestions: Record<string, string[]> = {};
    for (const b of missing) suggestions[b] = suggestFor(b);
    return {
      present: CORE.filter((b) => present.has(b)),
      missing,
      contributors,
      suggestions,
    };
  }, [characters, capIndex, caps]);

  // ---- render ----
  if (loading) return <Shell><p style={{ color: C.muted }}>Loading workspace...</p></Shell>;

  return (
    <Shell>
      <div className="tpdi-mono" style={{ fontSize: 11, letterSpacing: "0.22em", color: C.brass, textTransform: "uppercase", marginBottom: 18 }}>
        GM Workspace
      </div>

      {err && (
        <div style={{ ...box, borderColor: C.missing, color: "#E7B7B0", marginBottom: 16, fontSize: 13 }}>
          {err}
        </div>
      )}

      {/* campaign picker + create */}
      <div style={{ ...box, marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>Campaigns</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {campaigns.length === 0 && <span style={{ color: C.muted, fontSize: 13 }}>None yet. Create one below.</span>}
          {campaigns.map((c) => (
            <button key={c.id} onClick={() => setSelected(c.id)}
              style={{ ...(selected === c.id ? btn : btnGhost), fontWeight: 600 }}>
              {c.name} <span style={{ opacity: 0.6, fontSize: 11 }}>{c.system}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...inputStyle, maxWidth: 240 }} placeholder="New campaign name"
            value={newCampaign.name} onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })} />
          <select style={{ ...inputStyle, maxWidth: 120 }} value={newCampaign.system}
            onChange={(e) => setNewCampaign({ ...newCampaign, system: e.target.value })}>
            <option value="5e">5e</option><option value="5.5e">5.5e</option>
          </select>
          <button style={btn} onClick={createCampaign} disabled={busy}>Create</button>
        </div>
      </div>

      {selected && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 18 }}>
          {/* roster */}
          <div style={box}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Party roster</div>
            {characters.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>No characters yet.</p>}
            {characters.map((ch) => (
              <div key={ch.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{ch.name}</span>
                  <span style={{ color: C.muted, fontSize: 13 }}>
                    {"  "}{ch.species ? ch.species + " " : ""}{ch.class}{ch.subclass ? ` (${ch.subclass})` : ""}{ch.level ? ` · lvl ${ch.level}` : ""}
                  </span>
                </div>
                <button onClick={() => removeCharacter(ch.id)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>remove</button>
              </div>
            ))}

            {/* add character */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <input style={{ ...inputStyle, maxWidth: 150 }} placeholder="Name"
                value={newChar.name} onChange={(e) => setNewChar({ ...newChar, name: e.target.value })} />
              <select style={{ ...inputStyle, maxWidth: 140 }} value={newChar.class}
                onChange={(e) => setNewChar({ ...newChar, class: e.target.value, subclass: "" })}>
                <option value="">Class...</option>
                {PHB_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select style={{ ...inputStyle, maxWidth: 180 }} value={newChar.subclass}
                disabled={!newChar.class}
                onChange={(e) => setNewChar({ ...newChar, subclass: e.target.value })}>
                <option value="">{newChar.class ? "Subclass (optional)" : "Pick class first"}</option>
                {caps
                  .filter((r) => r.class === newChar.class && r.subclass)
                  .map((r) => r.subclass)
                  .sort()
                  .map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input style={{ ...inputStyle, maxWidth: 70 }} placeholder="Lvl" type="number"
                value={newChar.level} onChange={(e) => setNewChar({ ...newChar, level: e.target.value })} />
              <select style={{ ...inputStyle, maxWidth: 150 }} value={newChar.species}
                onChange={(e) => setNewChar({ ...newChar, species: e.target.value })}>
                <option value="">Species (optional)</option>
                {SPECIES.map((sp) => <option key={sp} value={sp}>{sp}</option>)}
              </select>
              <button style={btn} onClick={addCharacter} disabled={busy}>Add</button>
            </div>
          </div>

          {/* coverage */}
          <div style={box}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Coverage analysis</div>
            {characters.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 13 }}>Add characters to see where the party is covered and where it has gaps.</p>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: C.have, marginBottom: 8, letterSpacing: "0.05em" }}>COVERED</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {coverage.present.map((b) => (
                      <span key={b} title={(coverage.contributors[b] || []).join(", ")}
                        style={{ background: "rgba(94,140,126,0.18)", color: C.have, border: `1px solid ${C.have}`, borderRadius: 999, padding: "4px 11px", fontSize: 12.5 }}>
                        {LABEL[b] || b}
                      </span>
                    ))}
                    {coverage.present.length === 0 && <span style={{ color: C.muted, fontSize: 13 }}>Nothing yet.</span>}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: C.missing, marginBottom: 8, letterSpacing: "0.05em" }}>GAPS</div>
                  {coverage.missing.length === 0 ? (
                    <p style={{ color: C.have, fontSize: 13 }}>Party covers all core roles. Solid composition.</p>
                  ) : (
                    coverage.missing.map((b) => (
                      <div key={b} style={{ marginBottom: 9 }}>
                        <span style={{ background: "rgba(168,73,62,0.16)", color: C.missing, border: `1px solid ${C.missing}`, borderRadius: 999, padding: "4px 11px", fontSize: 12.5 }}>
                          {LABEL[b] || b}
                        </span>
                        <span style={{ color: C.muted, fontSize: 12.5 }}>
                          {"  "}fill with: {(coverage.suggestions[b] || []).join(", ")}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* player dispositions */}
          <div style={box}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
              Player dispositions <span style={{ color: C.line }}>· taken on this account</span>
            </div>
            {dispositions.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.5 }}>
                None yet. Have each player open /play while you are signed in, enter their name, and save.
                Their profile shows up here to assign to a character.
              </p>
            ) : (
              dispositions.map((d) => {
                const leanings = (d.scores?.weights || []).slice(0, 2)
                  .map((w: any) => `${AXIS_LABEL[w.key] || w.key} ${Math.round((w.w || 0) * 100)}%`).join(", ");
                return (
                  <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}`, gap: 10 }}>
                    <div style={{ fontSize: 13, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{d.player_name || "Unnamed"}</span>
                      {leanings && <span style={{ color: C.muted }}>{"  "}· {leanings}</span>}
                    </div>
                    <select style={{ ...inputStyle, maxWidth: 170 }} value={d.assigned_character_id || ""}
                      onChange={(e) => assignDisposition(d.id, e.target.value)}>
                      <option value="">— assign to —</option>
                      {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: C.ink, color: C.vellum, minHeight: "100vh", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <style>{`.tpdi-mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;}`}</style>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px" }}><WranglerNav />{children}</div>
    </div>
  );
}
