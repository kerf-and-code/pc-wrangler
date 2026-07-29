"use client";

// app/me/import/page.tsx
//
// Import a D&D Beyond character-sheet PDF into the player's library.
//
// WHY ITS OWN ROUTE rather than a panel bolted onto the Forge: the Forge already has three entry
// modes (?c=<character>, ?lib=<build>, or neither for NEW), and a saved library build is exactly
// what an import produces. So this page ends by writing a pc_library row and handing off to
// /me/forge?lib=<id>, which means the Forge itself needs no changes at all and the imported
// character arrives through the same door as any other saved build.
//
// The pipeline, all client-side (the PDF never leaves the browser):
//   file -> pdf.js getDocument -> parseSheet (form fields) -> ddbToBuild -> report -> saveToLibrary
//
// REQUIRES pdfjs-dist as a dependency:  npm i pdfjs-dist
//
// The import is deliberately honest about what it could not place: every degradation from the
// mapper's ImportReport is shown before the player commits, because the authoritative sheet still
// lives on D&D Beyond and this copy exists for encounter balancing and build ideas.

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SixAxesNav from "@/components/six-axes-nav";
import {
  STONE, FORGE_FONTS, forgeBackground, forgeVignette, stonePanel, stoneButton,
  FORGE_BUTTON_CSS, forgeHeading, forgeLabel, forgeRuleLine, stoneChip,
} from "@/lib/forge-theme";
import { saveToLibrary } from "@/lib/pc-library";
import { loadCatalog } from "@/lib/catalog";
import { loadSrd } from "@/lib/srd/srd";
import { RULES_DATA } from "@/lib/srd/rules-context";
import { parseSheet, FlattenedSheetError, type PdfDocumentLike, type DdbSheet } from "@/lib/ddb-parse";
import { ddbToBuild, type ImportContext, type ImportReport } from "@/lib/ddb-import";

type Stage = "idle" | "reading" | "ready" | "saving" | "error";

export default function ImportPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [sheet, setSheet] = useState<DdbSheet | null>(null);
  const [build, setBuild] = useState<unknown>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  /**
   * The mapper's lookup tables. Species, classes and subclasses come from the CATALOG rather than
   * the SRD JSON, and deliberately UNFILTERED by partner or edition: an import should recognise
   * what the player actually plays (a Warforged, a legacy subclass), not only what the picker
   * currently has switched on.
   */
  const buildContext = useCallback(async (): Promise<ImportContext> => {
    const cat = await loadCatalog(supabase).catch(() => null);
    const names = (rows: { name: string }[]) => rows.map((r) => r.name);
    return {
      items: [
        ...names(loadSrd("equipment", "both")),
        ...names(loadSrd("magic-items", "both")),
      ],
      spells: names(loadSrd("spells", "both")),
      backgrounds: names(loadSrd("backgrounds", "both")),
      species: cat ? cat.species.map((s) => s.name) : [],
      classes: cat ? cat.classes.map((c) => c.name) : [],
      subclasses: cat
        ? [...new Set(cat.caps.map((c) => c.subclass).filter((s): s is string => !!s))]
        : [],
      abilityEffectItems: [
        ...Object.keys(RULES_DATA.ITEM_EFFECTS || {}),
        ...Object.keys(RULES_DATA.ITEM_VARIANTS || {}),
      ],
    };
  }, [supabase]);

  const onPick = useCallback(async (file: File) => {
    setStage("reading");
    setError(null);
    setFileName(file.name);
    setSheet(null); setBuild(null); setReport(null);
    try {
      // Loaded on demand so pdf.js never runs during SSR and is not in the initial bundle.
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjs.getDocument({ data }).promise;
      const parsed = await parseSheet(doc as unknown as PdfDocumentLike);
      const ctx = await buildContext();
      const { build: b, report: r } = ddbToBuild(parsed, ctx);
      setSheet(parsed); setBuild(b); setReport(r);
      setStage("ready");
    } catch (e) {
      setStage("error");
      setError(
        e instanceof FlattenedSheetError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not read that PDF.",
      );
    }
  }, [buildContext]);

  const onSave = useCallback(async () => {
    if (!build || !report) return;
    setStage("saving");
    setError(null);
    try {
      const id = await saveToLibrary(supabase, report.characterName || "Imported character", build, {
        species: report.species.matched ?? report.species.raw ?? null,
        class: report.className.matched ?? report.className.raw ?? null,
        subclass: report.subclass.matched ?? report.subclass.raw ?? null,
        // The Forge keeps the lineage OUTSIDE Build, as its own column, so carry the variant the
        // mapper split off ("Variant Human" -> species Human, variant Variant).
        species_variant: report.species.variant ?? null,
        level: report.level,
      });
      router.push(`/me/forge?lib=${id}`);
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : "Could not save to your library.");
    }
  }, [build, report, supabase, router, setStage]);

  return (
    <div style={{ minHeight: "100vh", position: "relative", ...forgeBackground() }}>
      <style>{FORGE_BUTTON_CSS}</style>
      <div style={forgeVignette} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <SixAxesNav />
        <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px 64px", ...FORGE_FONTS }}>
          <h1 style={{ ...forgeHeading, fontSize: 28, marginBottom: 4 }}>Import from D&amp;D Beyond</h1>
          <p style={{ color: STONE.inkDim, marginTop: 0, marginBottom: 18, fontSize: 14 }}>
            Upload a character-sheet PDF exported from D&amp;D Beyond. It is read in your browser and
            never uploaded anywhere. Everything on the sheet is kept, including the parts Six Axes
            cannot model yet.
          </p>
          <div style={forgeRuleLine} />

          <section style={{ ...stonePanel(), padding: 18, marginTop: 18 }}>
            <div style={forgeLabel}>Character sheet PDF</div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPick(f);
                e.target.value = "";
              }}
            />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
              <button
                className="forge-btn is-primary"
                style={stoneButton("primary")}
                onClick={() => fileRef.current?.click()}
                disabled={stage === "reading" || stage === "saving"}
              >
                {stage === "reading" ? "Reading…" : "Choose PDF"}
              </button>
              {fileName ? (
                <span style={{ color: STONE.inkDim, fontSize: 13 }}>{fileName}</span>
              ) : null}
            </div>
          </section>

          {error ? (
            <section style={{ ...stonePanel(), padding: 18, marginTop: 16, borderColor: STONE.blood }}>
              <div style={{ ...forgeLabel, color: STONE.blood }}>Could not import</div>
              <p style={{ color: STONE.ink, marginBottom: 0, fontSize: 14 }}>{error}</p>
            </section>
          ) : null}

          {report && sheet ? (
            <>
              <section style={{ ...stonePanel(), padding: 18, marginTop: 16 }}>
                <div style={forgeLabel}>What came through</div>
                <h2 style={{ ...forgeHeading, fontSize: 22, margin: "6px 0 2px" }}>
                  {report.characterName || "Unnamed character"}
                </h2>
                <p style={{ color: STONE.inkDim, margin: "0 0 12px", fontSize: 14 }}>
                  {report.classes.map((c) => `${c.class} ${c.level}`).join(" / ")}
                  {report.species.raw ? ` · ${report.species.raw}` : ""}
                  {report.background.raw ? ` · ${report.background.raw}` : ""}
                </p>
                <dl style={STAT_GRID}>
                  <Stat label="Level" value={String(report.level)} />
                  <Stat label="Armour class" value={fmt(sheet.combat.armor_class)} />
                  <Stat label="Hit points" value={fmt(sheet.combat.max_hp)} />
                  <Stat label="Gear" value={`${report.gear.matched.length} of ${sheet.equipment.length} recognised`} />
                  <Stat label="Features" value={String(sheet.features.length)} />
                  <Stat
                    label="Spells"
                    value={
                      sheet.spells.list.length
                        ? `${report.spells.cantrips.length + report.spells.known.length} on the build, ${report.spells.parked.length} kept aside`
                        : "none"
                    }
                  />
                </dl>
              </section>

              {report.notes.length ? (
                <section style={{ ...stonePanel(), padding: 18, marginTop: 16 }}>
                  <div style={forgeLabel}>Worth knowing</div>
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: STONE.ink, fontSize: 14, lineHeight: 1.55 }}>
                    {report.notes.map((n, i) => <li key={i} style={{ marginBottom: 6 }}>{n}</li>)}
                  </ul>
                </section>
              ) : null}

              {report.gear.unmatched.length ? (
                <section style={{ ...stonePanel(), padding: 18, marginTop: 16 }}>
                  <div style={forgeLabel}>Kept under their own names</div>
                  <p style={{ color: STONE.inkDim, margin: "6px 0 10px", fontSize: 13 }}>
                    These are not in the catalogue, so their rules will not compute. Nothing is lost:
                    they stay on the character exactly as written.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {report.gear.unmatched.map((g, i) => (
                      <span key={i} style={stoneChip()}>{g.raw}</span>
                    ))}
                  </div>
                </section>
              ) : null}

              <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
                <button
                  className="forge-btn is-primary"
                  style={stoneButton("primary")}
                  onClick={() => void onSave()}
                  disabled={stage === "saving"}
                >
                  {stage === "saving" ? "Saving…" : "Save to my library"}
                </button>
                <button
                  className="forge-btn is-ghost"
                  style={stoneButton("ghost")}
                  onClick={() => { setSheet(null); setBuild(null); setReport(null); setStage("idle"); setFileName(""); }}
                  disabled={stage === "saving"}
                >
                  Discard
                </button>
              </div>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}

const STAT_GRID: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 12, margin: 0,
};

function fmt(n: number | null): string {
  return n === null || n === undefined ? "--" : String(n);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ ...forgeLabel, marginBottom: 2 }}>{label}</dt>
      <dd style={{ margin: 0, color: STONE.ink, fontSize: 15 }}>{value}</dd>
    </div>
  );
}
