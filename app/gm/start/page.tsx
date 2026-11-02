"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import SchemaHealthCard from "@/components/schema-health-card";
import TableTapCard from "@/components/table-tap-card";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { initialCampaignId, useRememberCampaign } from "@/lib/campaign-context";

type Step = { key: string; label: string; desc: string; href: string; cta: string; done: boolean; optional?: boolean; alt?: { href: string; cta: string } };

export default function GettingStartedPage() {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<"loading" | "ready" | "signin">("loading");
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; system: string | null }[]>([]);
  const [campaignId, setCampaignId] = useState("");
  useRememberCampaign(campaignId, campaigns);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [campName, setCampName] = useState<string | null>(null);
  const [campCount, setCampCount] = useState(0);
  const [flags, setFlags] = useState({ campaign: false, players: false, discord: false, inPerson: false, record: false, review: false, schedule: false, tap: false });

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setStatus("signin"); return; }

      // Progress is for ONE campaign, the shared active one (lib/campaign-context), not "anything in the
      // account": it used to check the first campaign for Discord but every campaign for the rest, so a
      // GM with two tables saw a mix of both.
      const { data: campRows } = await supabase.from("campaigns").select("id, name, system, share_code, discord_channel_id").eq("gm_id", user.id).order("created_at", { ascending: true });
      if (!active) return;
      const camps = (campRows as { id: string; name: string; system: string | null; share_code: string | null; discord_channel_id: string | null }[]) || [];
      setCampaigns(camps);
      const cid = initialCampaignId(camps);
      setCampaignId(cid);
      const camp0 = camps.find((c) => c.id === cid);
      setCampName(camp0?.name ?? null);
      setCampCount(camps.length);
      setShareCode(camp0?.share_code ?? null);

      const none = Promise.resolve({ data: [] as unknown[] });
      const [{ data: pcs }, { data: sess }, { data: jobs }, { data: evs }, { data: taps }] = await Promise.all([
        cid ? supabase.from("characters").select("id").eq("campaign_id", cid).eq("kind", "pc").limit(1) : none,
        cid ? supabase.from("sessions").select("id, notes, recap, scheduled_at, capture_modality").eq("campaign_id", cid) : none,
        cid ? supabase.from("capture_jobs").select("id, source").eq("campaign_id", cid) : none,
        cid ? supabase.from("events").select("id").eq("campaign_id", cid).limit(1) : none,
        supabase.from("vtt_events").select("id").limit(1),
      ]);
      if (!active) return;

      const sessions = (sess || []) as { notes: string | null; recap: string | null; scheduled_at: string | null; capture_modality: string | null }[];
      const jobList = (jobs || []) as { source: string | null }[];
      // An in-person table never connects Discord, so "how you record" is done by EITHER path.
      const inPerson = jobList.some((j) => j.source === "in_person") || sessions.some((s) => s.capture_modality === "in_person");
      setFlags({
        campaign: camps.length > 0,
        players: (pcs || []).length > 0,
        discord: Boolean(camp0?.discord_channel_id),
        inPerson,
        record: jobList.length > 0 || sessions.some((s) => s.notes && s.notes.trim()),
        review: (evs || []).length > 0 || sessions.some((s) => s.recap && s.recap.trim()),
        schedule: sessions.some((s) => s.scheduled_at),
        tap: (taps || []).length > 0,
      });
      setStatus("ready");
    })();
    return () => { active = false; };
  }, [supabase]);

  const steps: Step[] = [
    { key: "campaign", label: "Create your campaign", desc: "Name your table and pick the system. This is the home for everything else.", href: "/gm", cta: "Open the workspace", done: flags.campaign },
    { key: "players", label: "Get your players in", desc: "Send each player their invite link from the Roster. They take the quick inventory and claim their character, and can add it themselves if it isn't listed yet.", href: "/gm/roster", cta: "Open the roster", done: flags.players },
    { key: "discord", label: "Choose how you record",
      desc: flags.inPerson && !flags.discord
        ? "You record in person: one microphone in the room, from a laptop or tablet on the Record page. No bot needed. Playing online too? Connect Discord for per-voice tracks."
        : "Online: invite the Six Axes bot, run /setup in your channel, and have players /claim once, so each voice gets its own track. In person: record the room from a laptop or tablet on the Record page, no bot needed.",
      href: "/gm/help", cta: "Discord setup steps", alt: { href: "/gm/record", cta: "Record in person" }, done: flags.discord || flags.inPerson },
    { key: "record", label: "Record a session",
      desc: "Tonight walks you through game night step by step. Online: run /record when play starts and /stop when you wrap. In person: press Start on the Record page, then map who is who on Speakers once it is transcribed. No recording at all? Log the session by hand on the Session Log.",
      href: "/gm/tonight", cta: "Open Tonight", alt: { href: "/gm/record", cta: "Record the room" }, done: flags.record },
    { key: "review", label: "Review the events", desc: "Approve or reject what the extractor proposes from the transcript. When you mark it done, a player recap is drafted for you and the disposition read refreshes.", href: "/gm/review", cta: "Open Review", done: flags.review },
    { key: "schedule", label: "Schedule your next session", desc: "Set a time so players can RSVP and get a reminder the day before.", href: "/gm/sessions", cta: "Set a time", done: flags.schedule },
    { key: "tap", label: "Capture table rolls (optional)", desc: "Players who use Beyond20 with D&D Beyond and Roll20 can keep the Table Tap open during sessions. Their attacks, saves, damage, and HP changes flow into recaps and analytics automatically.", href: "", cta: "", done: flags.tap, optional: true },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = steps.every((s) => s.done || s.optional);
  const firstOpen = steps.find((s) => !s.done)?.key;

  const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "18px 20px", marginBottom: 12 } as const;

  return (
    <PageShell width={760}>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>
        Getting started
      </div>
      <h1 style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>
        Run your first session
      </h1>
      <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.6, margin: "0 0 22px", maxWidth: 600 }}>
        From an empty account to a captured, reviewed session with a recap your players actually read. It runs on your Discord voice chat, on one microphone in the room for in-person play, or entirely from your notes if you would rather not record. The last step is optional.
      </p>

      {/* Renders nothing when every migration is applied. Sits ABOVE the checklist on purpose: a
          step that says "upload a portrait" is worse than useless if the storage policy for it was
          never run, so the reason has to be visible before the instruction. */}
      <SchemaHealthCard />

      {status === "loading" && <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>}
      {status === "signin" && <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>Sign in to see your progress.</p>}

      {status === "ready" && (
        <>
          {campName && (
            <p style={{ color: C.muted, fontSize: 13, margin: "0 0 12px" }}>
              Progress for <strong style={{ color: C.text }}>{campName}</strong>
              {campCount > 1 && <> · <a href="/gm" style={{ color: C.sun }}>switch campaign</a> in the Workspace</>}
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <div style={{ flex: 1, height: 7, background: C.surface2, borderRadius: FORGE_RADIUS, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(doneCount / steps.length) * 100}%`, background: `linear-gradient(90deg, ${C.brass}, ${C.sun})`, transition: "width .3s" }} />
            </div>
            <div style={{ fontSize: 13, color: C.muted, fontFamily: "ui-monospace, monospace" }}>{doneCount}/{steps.length}</div>
          </div>

          {allDone && (
            <div style={{ ...card, borderColor: C.good, background: "rgba(93,190,154,0.08)" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.good }}>You're all set.</div>
              <div style={{ fontSize: 13.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
                Your table is up and running. From here, the dashboard shows table health, and the analytics get richer the more you play.
              </div>
            </div>
          )}

          {steps.map((s, i) => {
            const isOpen = s.key === firstOpen;
            return (
              <div key={s.key} style={{ ...card, borderColor: isOpen ? C.brass : C.line, display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: FORGE_RADIUS, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center",
                  background: s.done ? C.good : "transparent", border: s.done ? "none" : `1.5px solid ${isOpen ? C.brass : C.line}`,
                  color: s.done ? C.ink : C.muted, fontSize: 13, fontWeight: 700 }}>
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
                    <a href={s.href} style={{ display: "inline-block", marginTop: 12, background: isOpen ? C.brass : "transparent", color: isOpen ? C.ink : C.text,
                      border: isOpen ? "none" : `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "8px 16px", fontSize: 13.5, fontWeight: 600, textDecoration: "none" }}>
                      {s.cta}
                    </a>
                  )}
                  {!s.done && s.alt && (
                    <a href={s.alt.href} style={{ display: "inline-block", marginTop: 12, marginLeft: 8, background: "transparent", color: C.text,
                      border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "8px 16px", fontSize: 13.5, fontWeight: 600, textDecoration: "none" }}>
                      {s.alt.cta}
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
