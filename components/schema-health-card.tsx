"use client";

// components/schema-health-card.tsx
//
// Shows which features are switched off because their migration has not been run.
//
// Migrations here are applied BY HAND in the Supabase editor, so the repo holds intent and the
// database holds truth. p14-portrait-uploads.sql sat unapplied for a week while the app rendered a
// portrait upload button that could only ever fail on RLS. Nothing surfaced that, because from the
// app's side a missing storage policy is indistinguishable from a permission denial.
//
// It stays SILENT when everything is applied. A health panel that is always on screen becomes
// furniture and stops being read, and this one only has something to say when something is wrong.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS, STONE } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";

type Check = {
  check_key: string;
  label: string;
  ok: boolean;
  detail: string;
  migration: string;
};

export default function SchemaHealthCard() {
  const [pending, setPending] = useState<Check[] | null>(null);
  // The probe itself ships as a migration, so it can be missing too. That is not an error worth
  // shouting about: it means this database predates the check, which is exactly the situation the
  // check was written for. Say so quietly rather than rendering nothing or throwing.
  const [probeMissing, setProbeMissing] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("schema_health");
      if (!active) return;
      if (error) {
        setProbeMissing(true);
        return;
      }
      setPending(((data as Check[]) || []).filter((c) => !c.ok));
    })();
    return () => { active = false; };
  }, []);

  if (probeMissing) {
    return (
      <div style={{ ...shell, borderLeft: `3px solid ${C.muted}` }}>
        <div style={eyebrow}>Setup check unavailable</div>
        <p style={body}>
          This database does not have the <code style={code}>schema_health()</code> function yet.
          Run <code style={code}>p16-schema-health.sql</code> in the Supabase editor to see which
          migrations are still outstanding.
        </p>
      </div>
    );
  }

  // Loading and the all-clear both render nothing. There is no useful intermediate state here.
  if (!pending || pending.length === 0) return null;

  const migrations = [...new Set(pending.map((c) => c.migration))];

  return (
    <div style={{ ...shell, borderLeft: `3px solid ${C.warn}` }}>
      <div style={{ ...eyebrow, color: C.warn }}>
        {pending.length === 1 ? "One feature is switched off" : `${pending.length} features are switched off`}
      </div>
      <p style={body}>
        These are built and deployed, but the database has not been given the schema they need. Until
        the migration below is run they will fail rather than degrade, usually as a permission error
        with no obvious cause.
      </p>

      <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none" }}>
        {pending.map((c) => (
          <li key={c.check_key} style={row}>
            <div style={{ color: C.text, fontSize: 13.5, fontWeight: 600 }}>{c.label}</div>
            <div style={{ color: STONE.inkFaint, fontSize: 11.5, fontFamily: SAX.mono, marginTop: 2 }}>
              needs {c.detail}
            </div>
          </li>
        ))}
      </ul>

      <p style={{ ...body, marginTop: 12, marginBottom: 0 }}>
        Run {migrations.length === 1 ? "this file" : "these files"} by hand in the Supabase SQL
        editor:{" "}
        {migrations.map((m, i) => (
          <span key={m}>
            {i > 0 ? ", " : ""}
            <code style={code}>supabase/migrations/{m}</code>
          </span>
        ))}
        . They are idempotent, so running one twice is safe.
      </p>
    </div>
  );
}

const shell: React.CSSProperties = {
  background: "linear-gradient(160deg, rgba(52,47,39,0.80) 0%, rgba(38,34,28,0.85) 45%, rgba(22,19,15,0.90) 100%)",
  borderRadius: FORGE_RADIUS,
  padding: "14px 16px",
  marginBottom: 20,
  boxShadow: [
    "inset 1px 1px 0 rgba(255,235,200,0.13)",
    "inset -1px -1px 0 rgba(0,0,0,0.6)",
    "0 5px 14px rgba(0,0,0,0.6)",
  ].join(","),
};

const eyebrow: React.CSSProperties = {
  fontFamily: SAX.mono,
  fontSize: 11,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: C.sun,
  marginBottom: 6,
};

const body: React.CSSProperties = {
  color: C.muted,
  fontSize: 13.5,
  lineHeight: 1.6,
  margin: "0 0 4px",
};

const row: React.CSSProperties = {
  padding: "7px 0",
  borderTop: `1px solid ${C.line}`,
};

const code: React.CSSProperties = {
  fontFamily: SAX.mono,
  fontSize: 12,
  color: C.plum,
  background: "rgba(0,0,0,0.28)",
  padding: "1px 5px",
  borderRadius: 3,
};
