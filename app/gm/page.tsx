"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX, AXES, type AxisKey } from "@/lib/theme";

// Palette mapped onto the shared cellar theme.
const C = {
  ink: SAX.inkDeep, panel: SAX.slateBg, line: SAX.line, vellum: SAX.text,
  muted: SAX.muted, brass: SAX.brass, brassDim: SAX.brassDim,
  have: SAX.good, missing: SAX.warn,
};

// Buckets the analyzer treats as the party's "core" coverage targets.
const CORE = ["healing", "aoe", "single_target", "face", "control", "detect_magic", "utility", "tank", "ranged"];
const LABEL: Record<string, string> = {
  healing: "Healing", aoe: "Area damage", single_target: "Single-target",
  face: "Social / face", control: "Control", detect_magic: "Detect magic",
  utility: "Utility", tank: "Tank / frontline", ranged: "Ranged", melee: "Melee",
  stealth: "Stealth", support: "Support / buff",
};

// Fallback coverage profile for "Other" / unrecognized classes.
const GENERAL_PROFILE = ["melee","single_target","utility"];

// CORE_SPECIES and PARTNERED_SPECIES used to live here as hardcoded arrays. They
// are gone. Species, species variants, and classes now come from the database
// (species, species_variants, classes), which is what makes Vulpin, High Elf, and
// every other variant selectable, and what stops free text reaching the model.
//
// PARTNERED_SPECIES held ["Lotusden Halfling", "Pallid Elf"]. Neither is a species.
// Both are SUBRACES, misfiled because there was nowhere else to put them. They are
// now variants of Halfling and Elf.

const box = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18 };
const inputStyle = { background: C.ink, color: C.vellum, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 11px", fontSize: 14, width: "100%" };
const btn = { background: C.brass, color: C.ink, border: "none", borderRadius: 9, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { background: "none", color: C.brass, border: `1px solid ${C.brassDim}`, borderRadius: 9, padding: "9px 16px", fontSize: 13, cursor: "pointer" };

// Bot invite: scopes for slash commands + permissions the bot needs (view/send/
// embed/read-history + connect/speak/voice-activity for /record).
const DISCORD_INVITE = "https://discord.com/oauth2/authorize?client_id=1521013496349855907&scope=bot+applications.commands&permissions=3164160";

type SpeciesRow = { id: string; name: string; source: string; partnered: boolean; partner: string | null; edition: string; sort: number };
type VariantRow = { id: string; species_id: string; name: string; variant_kind: string; source: string; partnered: boolean; partner: string | null; edition: string; sort: number };
type ClassRow   = { id: string; name: string; source: string; partnered: boolean; partner: string | null; edition: string; sort: number };

export default function GMWorkspace() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [caps, setCaps] = useState<any[]>([]); // class_capabilities rows (subclass catalog)
  const [speciesList, setSpeciesList] = useState<SpeciesRow[]>([]);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [classList, setClassList] = useState<ClassRow[]>([]);
  // 2024 is the default (decision 6). Flipping to 2014 swaps subraces in for
  // lineages; "both" shows everything, which is what a mixed table actually needs.
  const [edition, setEdition] = useState<"2024" | "2014" | "both">("2024");
  const [selected, setSelected] = useState<string | null>(null); // campaign id
  const [characters, setCharacters] = useState<any[]>([]);
  const [dispositions, setDispositions] = useState<any[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [enabledPartners, setEnabledPartners] = useState<Set<string>>(new Set());

  // forms
  const [newCampaign, setNewCampaign] = useState({ name: "", system: "5e" });
  const [newChar, setNewChar] = useState({ name: "", class: "", subclass: "", level: "", species: "", species_variant: "" });
  const [busy, setBusy] = useState(false);

  // ---- initial load ----
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) { setErr("Please sign in to use the GM workspace."); setLoading(false); } return; }
      if (!active) return;
      setUserId(user.id);
      const [
        { data: camps, error: e1 },
        { data: capRows },
        { data: spRows },
        { data: varRows },
        { data: clsRows },
        { data: dispRows },
      ] = await Promise.all([
        supabase.from("campaigns").select("id,name,system,gm_id,share_code").order("created_at", { ascending: false }),
        supabase.from("class_capabilities").select("class,subclass,capabilities,partnered,partner"),
        supabase.from("species").select("id,name,source,partnered,partner,edition,sort").order("sort").order("name"),
        supabase.from("species_variants").select("id,species_id,name,variant_kind,source,partnered,partner,edition,sort").order("sort").order("name"),
        supabase.from("classes").select("id,name,source,partnered,partner,edition,sort").order("sort").order("name"),
        supabase.from("tpdi_responses").select("id,player_name,scores,assigned_character_id,respondent_id,campaign_id,created_at").not("player_name", "is", null).order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      if (e1) setErr(e1.message);
      setCampaigns(camps || []);
      setCaps(capRows || []);
      setSpeciesList((spRows as SpeciesRow[]) || []);
      setVariants((varRows as VariantRow[]) || []);
      setClassList((clsRows as ClassRow[]) || []);
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
      subclass: newChar.subclass || null,
      level: newChar.level ? Number(newChar.level) : null,
      species: newChar.species || null,
      // The subrace / lineage. Values come from a constrained select, so no .trim()
      // is needed: they cannot be typed, only chosen.
      species_variant: newChar.species_variant || null,
    });
    if (error) setErr(error.message);
    else { setNewChar({ name: "", class: "", subclass: "", level: "", species: "", species_variant: "" }); if (selected) await loadCharacters(selected); }
    setBusy(false);
  }

  async function removeCharacter(id: string) {
    setErr(null);
    const { error } = await supabase.from("characters").update({ active: false }).eq("id", id);
    if (error) setErr(error.message); else if (selected) await loadCharacters(selected);
  }

  function copySetup(code: string) {
    try {
      navigator.clipboard.writeText(`/setup code:${code}`);
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    } catch (e) { /* clipboard unavailable */ }
  }

  // Pull an existing (unassigned) inventory into this campaign so it can be assigned.
  async function importInventory(responseId: string) {
    if (!selected || !responseId) return;
    setErr(null);
    const { error } = await supabase.from("tpdi_responses")
      .update({ campaign_id: selected }).eq("id", responseId);
    if (error) setErr(error.message);
    else setDispositions((ds) => ds.map((d) => (d.id === responseId ? { ...d, campaign_id: selected } : d)));
  }

  async function deleteCampaign(id: string) {
    if (!window.confirm("Delete this campaign and all its sessions, characters, events, recordings, and dispositions? Player inventories are unlinked but kept. This can't be undone.")) return;
    setErr(null);
    const { error } = await supabase.rpc("delete_campaign", { p_campaign: id });
    if (error) { setErr(error.message); return; }
    setCampaigns((cs) => cs.filter((c) => c.id !== id));
    if (selected === id) { setSelected(null); setCharacters([]); }
  }

  const partnerList = useMemo(
    () => [...new Set(caps.filter((r: any) => r.partner).map((r: any) => r.partner as string))].sort(),
    [caps]
  );
  const partnerOn = (p: string | null | undefined) => !p || enabledPartners.has(p);

  // Edition filter. A row tagged 'both' always shows; otherwise it must match the
  // selected edition. "both" as a selection shows everything, which is what a table
  // running a mix of 2014 and 2024 characters actually needs.
  const editionOn = (e: string) => edition === "both" || e === "both" || e === edition;

  // The option lists. Partner toggles gate species and variants exactly the way they
  // already gate subclasses, which they never did before: species had no partner
  // dimension at all, which is why Vulpin was unreachable.
  const speciesOptions = useMemo(
    () => speciesList.filter((sp) => partnerOn(sp.partner) && editionOn(sp.edition)),
    [speciesList, enabledPartners, edition], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const classOptions = useMemo(
    () => classList.filter((c) => partnerOn(c.partner) && editionOn(c.edition)),
    [classList, enabledPartners, edition], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Variants cascade from the chosen species. THIS is the dimension that did not
  // exist: High Elf is an Elven variant, not a subclass and not a species.
  const variantOptions = useMemo(() => {
    const sp = speciesList.find((x) => x.name === newChar.species);
    if (!sp) return [];
    return variants.filter(
      (v) => v.species_id === sp.id && partnerOn(v.partner) && editionOn(v.edition),
    );
  }, [variants, speciesList, newChar.species, enabledPartners, edition]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subclasses cascade from the chosen class, as before, but now from a constrained
  // select rather than a free-text datalist. This is the one that feeds
  // class_capabilities -> coverage -> the Tactics axis, so a typo here silently
  // erased a character from the model. It can no longer be typed.
  const subclassOptions = useMemo(() => {
    const seen = new Set<string>();
    return caps
      .filter((r: any) => r.subclass && partnerOn(r.partner) && (!newChar.class || r.class === newChar.class))
      .filter((r: any) => (seen.has(r.subclass) ? false : (seen.add(r.subclass), true)))
      .map((r: any) => r.subclass as string)
      .sort();
  }, [caps, newChar.class, enabledPartners]); // eslint-disable-line react-hooks/exhaustive-deps
  function togglePartner(p: string) {
    setEnabledPartners((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
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
      const base = capIndex[ch.class] || GENERAL_PROFILE;
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
        if ((r.capabilities || []).includes(bucket) && partnerOn(r.partner)) {
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
  }, [characters, capIndex, caps, enabledPartners]);

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
            <option value="2014">2014</option><option value="5e">5e</option><option value="5.5e">5.5e</option>
          </select>
          <button style={btn} onClick={createCampaign} disabled={busy}>Create</button>
        </div>
        {(() => {
          const sc = campaigns.find((c) => c.id === selected);
          return sc ? (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {sc.share_code && <>
                <span style={{ fontSize: 12.5, color: C.muted }}>Campaign code:</span>
                <code style={{ fontSize: 12.5, color: C.vellum, background: C.ink, border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 9px" }}>{sc.share_code}</code>
                <a href={DISCORD_INVITE} target="_blank" rel="noreferrer" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>Invite bot</a>
                <button style={btnGhost} onClick={() => copySetup(sc.share_code)}>{copied === sc.share_code ? "Copied" : "Copy /setup command"}</button>
              </>}
              <button onClick={() => deleteCampaign(sc.id)}
                style={{ marginLeft: "auto", background: "none", border: `1px solid ${C.line}`, color: C.muted, borderRadius: 9, padding: "9px 14px", fontSize: 12.5, cursor: "pointer" }}>
                Delete campaign
              </button>
            </div>
          ) : null;
        })()}
      </div>

      {selected && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 18 }}>
          {/* roster */}
          <div style={box}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Party roster</div>
            {partnerList.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 7 }}>
                  Partnered content {enabledPartners.size > 0 ? `(${enabledPartners.size} on)` : "— off by default; toggle a partner to add its options"}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {partnerList.map((p) => {
                    const on = enabledPartners.has(p);
                    return (
                      <button key={p} onClick={() => togglePartner(p)}
                        style={{ background: on ? C.brass : "none", color: on ? C.ink : C.muted,
                          border: `1px solid ${on ? C.brass : C.line}`, borderRadius: 999, padding: "4px 11px",
                          fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
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

            {/* add character.

                Every picker below is a constrained <select>, not an <input list=>.
                The old datalists were free-text fields with suggestions: you could
                type anything, and the app would accept it. That is how 12 of 52 PCs
                ended up with a subclass the catalog has never heard of, which means
                no capability rows, which means they contribute NOTHING to coverage
                and are invisible to the Tactics axis. A select cannot be typed into.

                Species now cascades into a variant (subrace or lineage). That
                dimension simply did not exist before, which is why High Elf could
                not be selected and Vulpin could not be found. */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
              <input style={{ ...inputStyle, maxWidth: 150 }} placeholder="Name"
                value={newChar.name} onChange={(e) => setNewChar({ ...newChar, name: e.target.value })} />

              <select
                style={{ ...inputStyle, maxWidth: 150 }}
                value={newChar.class}
                onChange={(e) => setNewChar({ ...newChar, class: e.target.value, subclass: "" })}
              >
                <option value="">Class</option>
                {classOptions.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>

              <select
                style={{ ...inputStyle, maxWidth: 200 }}
                value={newChar.subclass}
                onChange={(e) => setNewChar({ ...newChar, subclass: e.target.value })}
                disabled={!newChar.class}
                title={newChar.class ? "" : "Pick a class first"}
              >
                <option value="">{newChar.class ? "Subclass (optional)" : "Subclass"}</option>
                {subclassOptions.map((sc) => (
                  <option key={sc} value={sc}>{sc}</option>
                ))}
              </select>

              <input style={{ ...inputStyle, maxWidth: 70 }} placeholder="Lvl" type="number"
                value={newChar.level} onChange={(e) => setNewChar({ ...newChar, level: e.target.value })} />

              <select
                style={{ ...inputStyle, maxWidth: 160 }}
                value={newChar.species}
                onChange={(e) => setNewChar({ ...newChar, species: e.target.value, species_variant: "" })}
              >
                <option value="">Species (optional)</option>
                {speciesOptions.map((sp) => (
                  <option key={sp.id} value={sp.name}>
                    {sp.name}{sp.partnered ? ` (${sp.partner})` : ""}
                  </option>
                ))}
              </select>

              {/* The missing dimension. Only shows when the chosen species HAS
                  variants, so it stays out of the way for Orc or Warforged. */}
              {variantOptions.length > 0 && (
                <select
                  style={{ ...inputStyle, maxWidth: 190 }}
                  value={newChar.species_variant}
                  onChange={(e) => setNewChar({ ...newChar, species_variant: e.target.value })}
                >
                  <option value="">
                    {variantOptions.some((v) => v.variant_kind === "lineage") ? "Lineage" : "Subrace"} (optional)
                  </option>
                  {variantOptions.map((v) => (
                    <option key={v.id} value={v.name}>
                      {v.name}{v.partnered ? ` (${v.partner})` : ""}
                    </option>
                  ))}
                </select>
              )}

              <button style={btn} onClick={addCharacter} disabled={busy}>Add</button>
            </div>

            {/* Edition. 2024 is the default; 2014 is offered rather than dropped,
                because tables run both and a character sheet does not care what we
                standardised on. */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 11.5, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Rules
              </span>
              {(["2024", "2014", "both"] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEdition(e)}
                  style={{
                    background: edition === e ? C.sun : "transparent",
                    color: edition === e ? "#1B1426" : C.muted,
                    border: `1px solid ${edition === e ? C.sun : C.line}`,
                    borderRadius: 999, padding: "3px 11px", fontSize: 11.5,
                    fontFamily: "ui-monospace, monospace", cursor: "pointer", fontWeight: 700,
                  }}
                >
                  {e === "both" ? "Both" : e}
                </button>
              ))}
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
              Player dispositions <span style={{ color: C.line }}>· in this campaign</span>
              <span style={{ display: "block", marginTop: 4, fontSize: 12 }}>Bind players to characters on the Roster.</span>
            </div>
            {dispositions.filter((d) => d.campaign_id === selected).length === 0 ? (
              <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.5 }}>
                None in this campaign yet. Send players their invite links (per character on the Roster page,
                or the campaign link above). You can also pull in an existing inventory below.
              </p>
            ) : (
              dispositions.filter((d) => d.campaign_id === selected).map((d) => {
                const leanings = (d.scores?.weights || []).slice(0, 2)
                  .map((w: any) => `${AXES[w.key as AxisKey]?.tavernName || w.key} ${Math.round((w.w || 0) * 100)}%`).join(", ");
                return (
                  <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}`, gap: 10 }}>
                    <div style={{ fontSize: 13, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{d.player_name || "Unnamed"}</span>
                      {leanings && <span style={{ color: C.muted }}>{"  "}· {leanings}</span>}
                    </div>
                    <span style={{ fontSize: 12.5, color: C.muted, whiteSpace: "nowrap" }}>
                      {d.assigned_character_id
                        ? <>bound to <span style={{ color: C.vellum, fontWeight: 600 }}>{characters.find((c) => c.id === d.assigned_character_id)?.name || "a character"}</span></>
                        : "not bound"}
                    </span>
                  </div>
                );
              })
            )}

            {/* import an existing inventory not yet in this campaign */}
            {(() => {
              const pool = dispositions.filter((d) => d.campaign_id !== selected && !d.assigned_character_id);
              if (pool.length === 0) return null;
              return (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, color: C.muted }}>Import an existing inventory:</span>
                  <select style={{ ...inputStyle, maxWidth: 240 }} value="" onChange={(e) => importInventory(e.target.value)}>
                    <option value="">— choose an inventory —</option>
                    {pool.map((d) => <option key={d.id} value={d.id}>{d.player_name || "Unnamed"}</option>)}
                  </select>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PageShell width={820}>
      <style>{`.tpdi-mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;}`}</style>
      {children}
    </PageShell>
  );
}
