"use client";

// components/world-clock.tsx (2026-11-11, push 29, audit F15: in-game calendar)
//
// In-game time for a campaign (p154, lib/world-calendar.ts), in two sizes:
//   * full (the Timeline): set up a calendar from a preset, move the world's date, and edit the
//     calendar itself (months, week, era);
//   * compact (Tonight): today's date in the world, +1 day, +1 week, and a button to mark the
//     chosen session as starting on it (or the date it started on, once marked). Without a calendar it points to the Timeline.
// Writes go straight to campaigns and sessions under the GM's own policies. onChange tells the page
// the calendar and date after loading and after every change, so it can label its sessions.
// DateFields is the year, month and day picker the Timeline reuses for each session.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C, STONE, FORGE_FONTS, stonePanel, stoneButton } from "@/lib/forge-theme";
import { notReady } from "@/lib/friendly-error";
import { askConfirm } from "@/lib/confirm";
import {
  CALENDAR_PRESETS, presetCalendar, normalizeCalendar, toWorldDate, fromWorldDate, formatWorldDate,
  monthsToText, textToMonths, type WorldCalendar,
} from "@/lib/world-calendar";

const field: React.CSSProperties = {
  background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 6,
  padding: "5px 7px", fontSize: 13, minHeight: "var(--sax-tap, 0px)",
};
const btn: React.CSSProperties = { ...stoneButton("stone"), fontSize: 12.5, padding: "5px 10px", minHeight: "var(--sax-tap, 0px)" };
const primary: React.CSSProperties = { ...stoneButton("primary"), fontSize: 12.5, padding: "5px 12px", minHeight: "var(--sax-tap, 0px)" };
const tiny: React.CSSProperties = { fontFamily: FORGE_FONTS.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: STONE.inkFaint };

/** Year, month and day for a calendar. Calls onChange with the day number. */
export function DateFields({ cal, value, onChange, idPrefix }: {
  cal: WorldCalendar; value: number; onChange: (day: number) => void; idPrefix: string;
}) {
  const d = toWorldDate(cal, value);
  const set = (p: Partial<typeof d>) => onChange(fromWorldDate(cal, { ...d, ...p }));
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <input id={`${idPrefix}-day`} aria-label="Day" inputMode="numeric" value={d.day} style={{ ...field, width: 48 }}
        onChange={(e) => { const n = parseInt(e.target.value, 10); if (n > 0) set({ day: n }); }} />
      <select aria-label="Month" value={d.month} onChange={(e) => set({ month: Number(e.target.value) })} style={field}>
        {cal.months.map((m, i) => <option key={i} value={i}>{m.name}</option>)}
      </select>
      <input aria-label="Year" inputMode="numeric" value={d.year} style={{ ...field, width: 72 }}
        onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) set({ year: n }); }} />
      {cal.era && <span style={{ fontSize: 13, color: C.muted }}>{cal.era}</span>}
    </span>
  );
}

type Loaded = { cal: WorldCalendar | null; day: number | null };

export default function WorldClock({ campaignId, compact = false, sessionId = null, onChange }: {
  campaignId: string;
  compact?: boolean;
  sessionId?: string | null;            // compact: the session to mark with today's date
  onChange?: (cal: WorldCalendar | null, day: number | null) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionDay, setSessionDay] = useState<number | null>(null);   // compact: the session's in-game day
  const [jump, setJump] = useState("");
  const [setting, setSetting] = useState<number | null>(null);     // the date being picked by "Set date"
  // setup (no calendar yet)
  const [preset, setPreset] = useState(CALENDAR_PRESETS[0].key);
  const [startDay, setStartDay] = useState(0);
  // editing the calendar itself
  const [editing, setEditing] = useState<{ months: string; weekdays: string; era: string } | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const { data, error } = await supabase.from("campaigns").select("world_calendar, world_day").eq("id", campaignId).maybeSingle();
    if (error) {
      if (/world_calendar|world_day/.test(error.message)) { setMissing(true); setState({ cal: null, day: null }); return; }
      setErr("Could not load the calendar."); return;
    }
    const row = data as { world_calendar: unknown; world_day: number | null } | null;
    const cal = normalizeCalendar(row?.world_calendar);
    const next = { cal, day: cal ? row?.world_day ?? 0 : null };
    setMissing(false); setState(next); onChange?.(next.cal, next.day);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, campaignId]);
  useEffect(() => { setState(null); setEditing(null); setSetting(null); void load(); }, [load]);
  useEffect(() => {
    setSessionDay(null);
    if (!compact || !sessionId) return;
    let live = true;
    void supabase.from("sessions").select("world_day").eq("id", sessionId).maybeSingle().then(({ data, error }) => {
      if (live && !error) setSessionDay((data as { world_day: number | null } | null)?.world_day ?? null);
    });
    return () => { live = false; };
  }, [supabase, compact, sessionId]);

  const save = async (patch: { world_calendar?: WorldCalendar | null; world_day?: number | null }, next: Loaded) => {
    setBusy(true); setErr(null);
    const { error } = await supabase.from("campaigns").update(patch).eq("id", campaignId);
    setBusy(false);
    if (error) { setErr(/world_/.test(error.message) ? notReady("The in-game calendar", "p154") : `Could not save: ${error.message}`); return false; }
    setState(next); onChange?.(next.cal, next.day);
    return true;
  };

  const advance = (n: number) => {
    if (!state?.cal || state.day == null || !n) return;
    void save({ world_day: state.day + n }, { cal: state.cal, day: state.day + n });
  };

  const stamp = async () => {
    if (!sessionId || state?.day == null) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("sessions").update({ world_day: state.day }).eq("id", sessionId);
    setBusy(false);
    if (error) { setErr(`Could not mark the session: ${error.message}`); return; }
    setSessionDay(state.day);
  };

  const box: React.CSSProperties = { ...stonePanel(), marginBottom: 0, padding: "12px 14px" };

  if (!state) return <div style={box}><span style={{ color: C.muted, fontSize: 13 }}>Loading the calendar...</span></div>;
  if (missing) {
    return compact ? null : (
      <div style={box}><div style={tiny}>In-game calendar</div><p style={{ color: C.muted, fontSize: 13, margin: "6px 0 0" }}>{notReady("The in-game calendar", "p154")}</p></div>
    );
  }

  const { cal, day } = state;

  // No calendar yet.
  if (!cal || day == null) {
    if (compact) {
      return (
        <div style={box}>
          <div style={tiny}>In the world</div>
          <p style={{ color: C.muted, fontSize: 13, margin: "6px 0 0" }}>
            Not keeping in-game time. Set up a calendar on the <a href={`/gm/timeline?campaign=${campaignId}`} style={{ color: C.sun }}>Timeline</a> to track the world&apos;s date session by session.
          </p>
        </div>
      );
    }
    const draft = presetCalendar(preset);
    return (
      <div style={box}>
        <div style={tiny}>In-game calendar</div>
        <p style={{ color: C.muted, fontSize: 13, margin: "6px 0 10px", lineHeight: 1.5 }}>
          Track the date in your world: travel days, downtime, how long since the dragon attack. Pick a calendar to start from (you can rename the months and change their lengths after), then the date the story starts on.
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ fontSize: 12.5, color: C.muted, display: "grid", gap: 4 }}>Calendar
            <select value={preset} onChange={(e) => { setPreset(e.target.value); setStartDay(0); }} style={{ ...field, maxWidth: 380 }}>
              {CALENDAR_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <div style={{ fontSize: 12.5, color: C.muted, display: "grid", gap: 4 }}>The story starts on
            <DateFields cal={draft} value={startDay} onChange={setStartDay} idPrefix="wc-start" />
          </div>
          <div><button type="button" style={primary} disabled={busy} onClick={() => void save({ world_calendar: draft, world_day: startDay }, { cal: draft, day: startDay })}>Start keeping time</button></div>
        </div>
        {err && <p role="alert" style={{ color: C.warn, fontSize: 12.5, margin: "8px 0 0" }}>{err}</p>}
      </div>
    );
  }

  const week = cal.weekdays.length || 7;
  const stamped = sessionId != null && sessionDay != null;

  return (
    <div style={box}>
      <div style={tiny}>{compact ? "In the world" : "Today in the world"}</div>
      <div style={{ fontFamily: FORGE_FONTS.display, fontSize: compact ? 17 : 20, color: C.text, margin: "4px 0 8px" }} aria-live="polite">
        {formatWorldDate(cal, day)}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={btn} disabled={busy} onClick={() => advance(1)}>+1 day</button>
        <button type="button" style={btn} disabled={busy} onClick={() => advance(week)}>+1 week</button>
        <form onSubmit={(e) => { e.preventDefault(); const n = parseInt(jump, 10); if (n) { advance(n); setJump(""); } }} style={{ display: "inline-flex", gap: 4 }}>
          <input aria-label="Days to move the date (negative goes back)" value={jump} onChange={(e) => setJump(e.target.value.replace(/[^0-9-]/g, "").slice(0, 6))}
            placeholder="days" inputMode="numeric" style={{ ...field, width: 60 }} />
          <button type="submit" style={btn} disabled={busy || !parseInt(jump, 10)}>Move</button>
        </form>
        {!compact && <button type="button" style={btn} onClick={() => setSetting(setting == null ? day : null)}>{setting == null ? "Set date" : "Cancel"}</button>}
        {compact && sessionId && (
          stamped
            ? <span style={{ fontSize: 12.5, color: C.muted }}>This session started on {formatWorldDate(cal, sessionDay!, { weekday: false })}{sessionDay !== day ? "." : ", today."}</span>
            : <button type="button" style={primary} disabled={busy} onClick={() => void stamp()}>Mark this session as starting today</button>
        )}
      </div>
      {setting != null && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <DateFields cal={cal} value={setting} onChange={setSetting} idPrefix="wc-set" />
          <button type="button" style={primary} disabled={busy} onClick={() => void save({ world_day: setting }, { cal, day: setting }).then((ok) => { if (ok) setSetting(null); })}>Save date</button>
        </div>
      )}

      {!compact && (
        <div style={{ marginTop: 12 }}>
          {editing == null ? (
            <button type="button" style={{ ...btn, background: "transparent" }} onClick={() => setEditing({ months: monthsToText(cal), weekdays: cal.weekdays.join(", "), era: cal.era })}>
              Edit the calendar
            </button>
          ) : (
            <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
              <label style={{ fontSize: 12.5, color: C.muted, display: "grid", gap: 4 }}>Months, one per line: a name and its number of days
                <textarea value={editing.months} onChange={(e) => setEditing({ ...editing, months: e.target.value })} rows={Math.min(14, cal.months.length + 1)}
                  style={{ ...field, fontFamily: FORGE_FONTS.mono, resize: "vertical" }} />
              </label>
              <label style={{ fontSize: 12.5, color: C.muted, display: "grid", gap: 4 }}>Days of the week, separated by commas (leave empty for no week)
                <input value={editing.weekdays} onChange={(e) => setEditing({ ...editing, weekdays: e.target.value })} style={field} />
              </label>
              <label style={{ fontSize: 12.5, color: C.muted, display: "grid", gap: 4 }}>Era, written after the year (optional)
                <input value={editing.era} maxLength={20} onChange={(e) => setEditing({ ...editing, era: e.target.value })} placeholder="AF" style={{ ...field, width: 120 }} />
              </label>
              <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.5 }}>
                Dates are kept as days since the start of year 1, so renaming months never moves them; changing how many days a month has relabels the dates after it.
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" style={primary} disabled={busy} onClick={() => {
                  const months = textToMonths(editing.months);
                  if (!months.length) { setErr("Add at least one month: a name and a number of days, like \"Frostfall, 30\"."); return; }
                  const next = normalizeCalendar({ ...cal, preset: "custom", months, weekdays: editing.weekdays.split(/[,\n]/), era: editing.era });
                  if (!next) return;
                  void save({ world_calendar: next }, { cal: next, day }).then((ok) => { if (ok) setEditing(null); });
                }}>Save calendar</button>
                <button type="button" style={btn} onClick={() => { setEditing(null); setErr(null); }}>Cancel</button>
                <button type="button" style={{ ...btn, color: C.warn }} disabled={busy}
                  onClick={async () => {
                    if (!await askConfirm("Stop keeping in-game time for this campaign? The calendar and today's date are cleared. Sessions keep their dates, which read again if you set up the same calendar.")) return;
                    if (await save({ world_calendar: null, world_day: null }, { cal: null, day: null })) setEditing(null);
                  }}
                  title="Stops tracking in-game time. Sessions keep their dates, and they come back if you start again with the same calendar.">
                  Stop keeping time
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {err && <p role="alert" style={{ color: C.warn, fontSize: 12.5, margin: "8px 0 0" }}>{err}</p>}
    </div>
  );
}
