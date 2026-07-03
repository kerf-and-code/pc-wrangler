"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import TableTapCard from "@/components/table-tap-card";
import { SAX } from "@/lib/theme";

const C = {
  surface: SAX.slateBg,
  surface2: "rgba(11,7,18,0.6)",
  line: SAX.line,
  text: SAX.text,
  muted: SAX.muted,
  sun: SAX.sun,
  brass: SAX.brass,
  plum: SAX.plum,
  good: SAX.good,
};

type Step = { key: string; label: string; desc: string; href: string; cta: string; done: boolean; optional?: boolean };

export default function GettingStartedPage() {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<"loading" | "ready" | "signin">("loading");
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [flags, setFlags] = useState({ campaign: false, pc: false, session: false, recap: false, schedule: false, tap: false });

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setStatus("signin"); return; }

      const [{ data: camps }, { data: pcs }, { data: sess }, { data: taps }] = await Promise.all([
        supabase.from("campaigns").select("id, share_code").limit(1),
        supabase.from("characters").select("id").eq("kind", "pc").limit(1),
        supabase.from("sessions").select("id, notes, recap, scheduled_at"),
        supabase.from("vtt_events").select("id").limit(1),
      ]);
      if (!active) return;

      const sessions = sess || [];
      setShareCode((camps || [])[0]?.share_code ?? null);
      setFlags({
        campaign: (camps || []).length > 0,
        pc: (pcs || []).length > 0,
        session: sessions.some((s: any) => (s.notes && s.notes.trim()) || s.recap),
        recap: sessions.some((s: any) => s.recap && s.recap.trim()),
        schedule: sessions.some((s: any) => s.scheduled_at),
        tap: (taps || []).length > 0,
      });
      setStatus("ready");
    })();
    return () => { active = false; };
  }, [supabase]);

  const steps: Step[] = [
    { key: "campaign", label: "Create your campaign", desc: "Name your table and pick the system. This is the home for everything else.", href: "/gm", cta: "Open the workspace", done: flags.campaign },
    { key: "pc", label: "Add your players' characters", desc: "A name per player is enough to start. You can flesh them out later.", href: "/gm/roster", cta: "Open the roster", done: flags.pc },
    { key: "session", label: "Log your last session", desc: "Paste a few notes about what happened. No recording or transcription needed.", href: "/gm/sessions", cta: "Log a session", done: flags.session },
    { key: "recap", label: "Generate and share a recap", desc: "Turn those notes into a 'previously on...' your players can read or get by email.", href: "/gm/sessions", cta: "Write a recap", done: flags.recap },
    { key: "schedule", label: "Schedule your next session", desc: "Set a time so players can RSVP and get a reminder the day before.", href: "/gm/sessions", cta: "Set a time", done: flags.schedule },
    { key: "tap", label: "Capture table rolls (optional)", desc: "Players who use Beyond20 with D&D Beyond and Roll20 can keep the Table Tap open during sessions. Their attacks, saves, damage, and HP changes flow into recaps and analytics automatically.", href: "", cta: "", done: flags.tap, optional: true },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = steps.every((s) => s.done || s.optional);
  const firstOpen = steps.find((s) => !s.done)?.key;

  const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 20px", marginBottom: 12 } as const;

  return (
    <PageShell width={760}>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>
        Getting started
      </div>
      <h1 style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>
        Run your first session
      </h1>
      <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.6, margin: "0 0 22px", maxWidth: 600 }}>
        Six steps from empty to a shareable recap, a scheduled next game, and live roll capture. The last one is optional, and you can do it all from your notes, no recording required.
      </p>

      {status === "loading" && <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>}
      {status === "signin" && <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>Sign in to see your progress.</p>}

      {status === "ready" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <div style={{ flex: 1, height: 7, background: C.surface2, borderRadius: 6, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(doneCount / steps.length) * 100}%`, background: `linear-gradient(90deg, ${C.brass}, ${C.sun})`, transition: "width .3s" }} />
            </div>
            <div style={{ fontSize: 13, color: C.muted, fontFamily: "ui-monospace, monospace" }}>{doneCount}/{steps.length}</div>
          </div>

          {allDone && (
            <div style={{ ...card, borderColor: C.good, background: "rgba(93,190,154,0.08)" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.good }}>You're all set.</div>
              <div style={{ fontSize: 13.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
                Your table is up and running. From here, the dashboard shows table health, and the analytics get richer the more you log.
              </div>
            </div>
          )}

          {steps.map((s, i) => {
            const isOpen = s.key === firstOpen;
            return (
              <div key={s.key} style={{ ...card, borderColor: isOpen ? C.brass : C.line, display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 26, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center",
                  background: s.done ? C.good : "transparent", border: s.done ? "none" : `1.5px solid ${isOpen ? C.brass : C.line}`,
                  color: s.done ? SAX.inkDeep : C.muted, fontSize: 13, fontWeight: 700 }}>
                  {s.done ? "\u2713" : i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: s.done ? C.muted : C.text }}>{s.label}</div>
                  <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.5, marginTop: 3 }}>{s.desc}</div>
                  {!s.done && s.key === "tap" && shareCode && (
                    <div style={{ marginTop: 12 }}>
                      <TableTapCard shareCode={shareCode} />
                    </div>
                  )}
                  {!s.done && s.key !== "tap" && (
                    <a href={s.href} style={{ display: "inline-block", marginTop: 12, background: isOpen ? C.brass : "transparent", color: isOpen ? SAX.inkDeep : C.text,
                      border: isOpen ? "none" : `1px solid ${C.line}`, borderRadius: 9, padding: "8px 16px", fontSize: 13.5, fontWeight: 600, textDecoration: "none" }}>
                      {s.cta}
                    </a>
                  )}
                </div>
                {s.done && <div style={{ flexShrink: 0, fontSize: 12, color: C.good, fontFamily: "ui-monospace, monospace", marginTop: 4 }}>done</div>}
              </div>
            );
          })}
        </>
      )}
    </PageShell>
  );
}
