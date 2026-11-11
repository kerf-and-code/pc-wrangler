"use client";

// app/me/quick-build/page.tsx (2026-11-11, push 30, audit P12: a quick guided build)
//
// A level 1 D&D character in three steps, for a new player or anyone in a hurry: a class (or the class
// quiz, which ends in "Build this character"), a species and a background, and a name. The defaults
// (standard array in the class's order, the best-fitting common background and its +2/+1, option A
// of the starting equipment) come from lib/quick-build.ts. It saves to the player's library like any
// new Forge build and opens the Forge on the Class tab with a note on what is left to pick. 2024 rules.

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/components/page-shell";
import ClassQuiz from "@/components/class-quiz";
import { createClient } from "@/lib/supabase/client";
import { C, STONE, FORGE_FONTS, stonePanel, stoneButton } from "@/lib/forge-theme";
import { loadSrd } from "@/lib/srd/srd";
import { saveToLibrary } from "@/lib/pc-library";
import { urlParam } from "@/lib/campaign-context";
import { CLASSES } from "@/lib/tools/class-quiz-data";
import {
  QUICK_CLASSES, QUICK_BACKGROUNDS, quickClass, standardScores, bestBackground, backgroundAsi,
  classEquipmentText, starterKit, quickBuild, type QAbility,
} from "@/lib/quick-build";

type Bg = { name: string; ability_scores?: string; feat?: string; skill_proficiencies?: string; equipment?: string; tool_proficiency?: string };
const ABIL: [QAbility, string][] = [["str", "STR"], ["dex", "DEX"], ["con", "CON"], ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"]];

// The class quiz is drawn in the marketing site's night palette; these are its colours, so it reads
// the same inside the app.
const QUIZ_VARS = {
  "--sn-bg": "#0f141c", "--sn-bg2": "#151b25", "--sn-card": "#1b2230", "--sn-ink": "#e8e4da", "--sn-dim": "#aeb4be",
  "--sn-faint": "#959daa", "--sn-line": "rgba(224,168,74,0.25)", "--sn-line2": "rgba(174,180,190,0.16)",
  "--sn-amber": "#e0a84a", "--sn-amber-hi": "#ecbf6e", "--sn-amber-ink": "#1a1206", "--sn-display": "Georgia, serif",
} as React.CSSProperties;

export default function QuickBuildPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const data = useMemo(() => {
    const classes = loadSrd("classes", "2024") as unknown as { name: string }[];
    const structured = loadSrd("classes-structured", "2024") as unknown as { name: string; core_traits?: string }[];
    const backgrounds = loadSrd("backgrounds", "2024") as unknown as Bg[];
    const species = (loadSrd("species", "2024") as unknown as { species: { name: string }[] }).species.map((s) => s.name);
    const equipment = (loadSrd("equipment", "2024") as unknown as { name: string }[]).map((e) => e.name);
    const have = new Set(classes.map((c) => c.name));
    return {
      classes: QUICK_CLASSES.filter((c) => have.has(c.name)),
      coreByName: Object.fromEntries(structured.map((c) => [c.name, c.core_traits || ""])) as Record<string, string>,
      backgrounds: QUICK_BACKGROUNDS.map((n) => backgrounds.find((b) => b.name === n)).filter((b): b is Bg => !!b),
      species, equipment,
    };
  }, []);

  const [cls, setCls] = useState("");
  const [aim, setAim] = useState<string | null>(null);
  const [quiz, setQuiz] = useState(false);
  const [species, setSpecies] = useState("");
  const [bg, setBg] = useState("");
  const [bgPicked, setBgPicked] = useState(false);   // the player chose a background, so a class change keeps it
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);

  const pickClass = (n: string, subclass: string | null = null) => {
    if (!data.classes.some((c) => c.name === n)) { setUnsupported(n); return; }
    setUnsupported(null); setCls(n); setAim(subclass); setQuiz(false);
    if (!bgPicked) setBg(bestBackground(quickClass(n)!.order, data.backgrounds, n) ?? "");
  };

  // ?class=Fighter&subclass=... from the public class quiz
  useEffect(() => {
    const c = urlParam("class");
    if (c) pickClass(c, urlParam("subclass"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const order = cls ? quickClass(cls)?.order ?? null : null;
  const bgRec = data.backgrounds.find((b) => b.name === bg);
  const scores = useMemo(() => {
    if (!order) return null;
    const base = standardScores(order);
    const asi = backgroundAsi(order, bgRec?.ability_scores);
    return ABIL.map(([k, label]) => ({ k, label, base: base[k], plus: asi[k] ?? 0 }));
  }, [order, bgRec]);
  const kit = useMemo(() => (cls ? starterKit(classEquipmentText(data.coreByName[cls]), bgRec, data.equipment) : null), [cls, bgRec, data]);
  const gold = kit ? Object.entries(kit.coins).map(([k, v]) => `${v} ${k.toUpperCase()}`).join(", ") : "";
  const ready = !!cls && !!species && !!bg && !!kit;

  const create = async () => {
    if (!ready || !kit) return;
    setBusy(true); setErr(null);
    try {
      const build = quickBuild({ className: cls, species, background: bg, bgAbilityScores: bgRec?.ability_scores, kit, aim });
      const id = await saveToLibrary(supabase, name.trim() || `New ${cls}`, build, { species, class: cls, subclass: null, level: 1 }, "dnd5e");
      router.push(`/me/forge?lib=${id}&tab=class&quick=1`);
    } catch (e) {
      setErr(e instanceof Error && /sign in/i.test(e.message)
        ? "Sign in first: your character is saved to your library."
        : "Could not create the character. Try again.");
      setBusy(false);
    }
  };

  const box: React.CSSProperties = { ...stonePanel(), marginBottom: 16, padding: "16px 18px" };
  const step: React.CSSProperties = { fontFamily: FORGE_FONTS.mono, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: STONE.inkFaint, margin: "0 0 4px" };
  const h2: React.CSSProperties = { fontFamily: FORGE_FONTS.display, fontSize: 20, color: STONE.ink, margin: "0 0 10px", fontWeight: 600 };
  const chip = (on: boolean): React.CSSProperties => ({
    ...stoneButton(on ? "primary" : "stone"), fontSize: 13.5, padding: "7px 13px", minHeight: "var(--sax-tap, 0px)",
  });

  return (
    <PageShell width={920}>
      <h1 style={{ fontFamily: FORGE_FONTS.display, fontSize: 30, margin: "4px 0 4px", color: STONE.ink }}>Quick build</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 18px", lineHeight: 1.55 }}>
        A level 1 D&amp;D character in three steps (2024 rules). Six Axes fills in the ability scores, the background&apos;s bonus and the starting gear,
        then opens the full Forge so you can make the last few picks and change anything you like.
        Building for 2014 rules or higher level? Use the <a href="/me/forge" style={{ color: C.sun }}>full Forge</a>.
      </p>

      <section style={box} aria-labelledby="qb-1">
        <p style={step}>Step 1 of 3</p>
        <h2 id="qb-1" style={h2}>Pick a class</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {data.classes.map((c) => {
            const info = CLASSES[c.name.toLowerCase()];
            const on = cls === c.name;
            return (
              <button key={c.name} type="button" aria-pressed={on} onClick={() => pickClass(c.name)}
                style={{ textAlign: "left", cursor: "pointer", background: on ? "rgba(217,164,58,0.14)" : C.surface2, color: C.text,
                  border: `1px solid ${on ? C.sun : C.line}`, borderRadius: 8, padding: "10px 12px", font: "inherit" }}>
                <div style={{ fontFamily: FORGE_FONTS.display, fontSize: 16, fontWeight: 600 }}>{c.name}</div>
                {info && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{info.abilities}{info.complexity ? ` · ${info.complexity} complexity` : ""}</div>}
                {info && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>{info.blurb}</div>}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={chip(quiz)} onClick={() => setQuiz(!quiz)}>{quiz ? "Hide the quiz" : "Not sure? Take the class quiz"}</button>
          {aim && cls && <span style={{ fontSize: 13, color: C.muted }}>The quiz picked {aim}, a {cls} subclass you choose at level 3.</span>}
        </div>
        {unsupported && (
          <p role="alert" style={{ color: C.warn, fontSize: 13, margin: "10px 0 0" }}>
            The quick build does not have the {unsupported} yet. Pick a class above, or build it in the <a href="/me/forge" style={{ color: C.sun }}>full Forge</a>.
          </p>
        )}
        {quiz && (
          <div style={{ ...QUIZ_VARS, marginTop: 14, background: "#0f141c", borderRadius: 10, padding: 12 }}>
            <ClassQuiz onBuild={(n, sub) => pickClass(n, sub)} />
          </div>
        )}
      </section>

      <section style={{ ...box, opacity: cls ? 1 : 0.6 }} aria-labelledby="qb-2">
        <p style={step}>Step 2 of 3</p>
        <h2 id="qb-2" style={h2}>Species and background</h2>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>Species</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {data.species.map((s) => (
            <button key={s} type="button" aria-pressed={species === s} disabled={!cls} onClick={() => setSpecies(s)} style={chip(species === s)}>{s}</button>
          ))}
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>
          Background{cls && bg && !bgPicked ? ` (suggested for a ${cls}; change it if another fits your story)` : ""}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {data.backgrounds.map((b) => (
            <button key={b.name} type="button" aria-pressed={bg === b.name} disabled={!cls} title={b.ability_scores}
              onClick={() => { setBg(b.name); setBgPicked(true); }} style={chip(bg === b.name)}>{b.name}</button>
          ))}
        </div>
        {bgRec && (
          <p style={{ fontSize: 12.5, color: C.muted, margin: "10px 0 0", lineHeight: 1.5 }}>
            {bgRec.name}: {bgRec.ability_scores}{bgRec.feat ? `; feat ${bgRec.feat}` : ""}{bgRec.skill_proficiencies ? `; skills ${bgRec.skill_proficiencies}` : ""}.
          </p>
        )}
        <p style={{ fontSize: 12, color: C.muted, margin: "10px 0 0" }}>Some species ask one more question (a lineage or an ancestry); the Forge asks it next.</p>
      </section>

      <section style={{ ...box, opacity: ready ? 1 : 0.6 }} aria-labelledby="qb-3">
        <p style={step}>Step 3 of 3</p>
        <h2 id="qb-3" style={h2}>Name and check</h2>
        <label htmlFor="qb-name" style={{ display: "block", fontSize: 13, color: C.muted, marginBottom: 6 }}>Character name (you can change it later)</label>
        <input id="qb-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={cls ? `New ${cls}` : "Name your character"}
          style={{ width: "100%", maxWidth: 420, boxSizing: "border-box", background: C.surface2, color: C.text, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: "10px 12px", fontSize: 16, fontFamily: FORGE_FONTS.display }} />

        {scores && (
          <>
            <div style={{ fontSize: 13, color: C.muted, margin: "14px 0 6px" }}>Ability scores: the standard array in a {cls}&apos;s usual order{bgRec ? `, plus ${bgRec.name}'s bonus` : ""}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(52px, 1fr))", gap: 6, maxWidth: 480 }}>
              {scores.map((s) => (
                <div key={s.k} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 4px", textAlign: "center" }}>
                  <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: C.muted }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{s.base + s.plus}</div>
                  <div style={{ fontSize: 10.5, color: s.plus ? C.sun : "transparent" }}>{s.plus ? `${s.base} +${s.plus}` : "."}</div>
                </div>
              ))}
            </div>
          </>
        )}
        {kit && (
          <p style={{ fontSize: 13, color: C.muted, margin: "12px 0 0", lineHeight: 1.55 }}>
            Starting gear: {kit.items.length} item{kit.items.length === 1 ? "" : "s"} from your class and background{gold ? `, and ${gold} in your purse` : ""}.
            {kit.choose.length > 0 && <> Still yours to pick: {kit.choose.join(", ")}.</>}
          </p>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
          <button type="button" onClick={() => void create()} disabled={!ready || busy}
            style={{ ...stoneButton("primary"), fontSize: 14, padding: "9px 18px", opacity: ready ? 1 : 0.5, cursor: ready && !busy ? "pointer" : "default" }}>
            {busy ? "Creating..." : "Create and open in the Forge"}
          </button>
          {!ready && <span style={{ fontSize: 12.5, color: C.muted }}>{!cls ? "Pick a class first." : !species ? "Pick a species." : "Pick a background."}</span>}
        </div>
        {err && <p role="alert" style={{ color: C.warn, fontSize: 13, margin: "10px 0 0" }}>{err} {/sign in/i.test(err) && <a href="/auth/login" style={{ color: C.sun }}>Sign in</a>}</p>}
        <p style={{ fontSize: 12, color: C.muted, margin: "12px 0 0" }}>
          In the Forge you then pick your skills, your species&apos; and feat&apos;s options, and spells if you cast them. Everything here can still be changed there.
        </p>
      </section>
    </PageShell>
  );
}
