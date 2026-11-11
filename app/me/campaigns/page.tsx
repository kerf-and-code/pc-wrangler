"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { UpgradeAccount } from "@/components/upgrade-account";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { setActiveCampaign } from "@/lib/active-campaign";
import { openTabletop, tabletopUrl } from "@/lib/tabletop/open";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { askConfirm } from "@/lib/confirm";
import { friendlyError } from "@/lib/friendly-error";
import { downloadSessionIcs } from "@/lib/calendar";
import { saveCharacterToLibrary } from "@/lib/pc-library";

// Every campaign this player has a character in, across all of them.
//
// Reads my_campaigns(), which derives membership from characters you OWN rather
// than from the memberships table (players never get membership rows in this app;
// see p3-dossier-rpcs.sql). It also returns the GM's display name, because the
// client can no longer read profiles for anyone but itself.
type Campaign = {
  campaign_id: string;
  campaign_name: string;
  system: string | null;
  share_code: string | null;
  gm_name: string | null;
  my_characters: number;
  last_session_at: string | null;
};
type Next = { campaign_id: string; session_id: string; session_number: number | null; scheduled_at: string };

export default function MyCampaignsPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Campaign[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [next, setNext] = useState<Record<string, Next>>({});
  const [isGm, setIsGm] = useState<boolean | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [calUrl, setCalUrl] = useState<string | null>(null);
  const [calBusy, setCalBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // A guest who has never touched the app has nothing here, and signing them
        // in anonymously would create an empty account for no reason. The claim
        // link is what starts a player's life in the product.
        if (active) setStatus("empty");
        return;
      }

      const [{ data, error }, { data: nx }, { data: prof }] = await Promise.all([
        supabase.rpc("my_campaigns"),
        // Audit F8: the next scheduled session per campaign (p147). Missing before p147 runs: no dates.
        supabase.rpc("my_next_sessions"),
        supabase.from("profiles").select("access_role").eq("id", user.id).maybeSingle(),
      ]);
      if (!active) return;
      if (error) { setStatus("error"); return; }

      const list = (data as Campaign[]) || [];
      setRows(list);
      setNext(Object.fromEntries(((nx as Next[] | null) ?? []).map((n) => [n.campaign_id, n])));
      setIsGm((prof as { access_role: string | null } | null)?.access_role === "gm");
      setStatus(list.length ? "ready" : "empty");
    })();
    return () => { active = false; };
  }, [supabase]);

  // Audit F6: leave a table. Each of your characters there is copied to your Character library first,
  // so nothing you built is lost, then leaves the party (active = false, the same as the GM's remove).
  async function leave(c: Campaign) {
    const n = c.my_characters;
    if (!await askConfirm(`Leave ${c.campaign_name}? Your ${n === 1 ? "character there is" : `${n} characters there are`} copied to your Character library first, then ${n === 1 ? "leaves" : "leave"} the party. The story you played stays with the campaign, and your GM can bring them back.`, { confirmLabel: "Leave the table" })) return;
    setLeaving(c.campaign_id); setNote(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { data: chars, error: e1 } = await supabase.from("characters").select("id")
        .eq("campaign_id", c.campaign_id).eq("profile_id", user.id).eq("kind", "pc").eq("active", true);
      if (e1) throw e1;
      for (const ch of (chars as { id: string }[] | null) ?? []) {
        await saveCharacterToLibrary(supabase, ch.id);
        const { error: e2 } = await supabase.from("characters").update({ active: false }).eq("id", ch.id);
        if (e2) throw e2;
      }
      setRows((rs) => rs.filter((r) => r.campaign_id !== c.campaign_id));
      setNote({ text: `You left ${c.campaign_name}. Your characters are in your Character library.`, bad: false });
    } catch (e) {
      setNote({ text: friendlyError(e, "leave the table"), bad: true });
    } finally {
      setLeaving(null);
    }
  }

  // Audit F8: a private calendar address for every session at every table (p147, /api/calendar).
  async function calendarLink(reset = false) {
    if (reset && !await askConfirm("Replace your calendar link? The old address stops working, so any calendar subscribed to it stops updating until you add the new one.", { confirmLabel: "Replace the link" })) return;
    setCalBusy(true); setNote(null);
    const { data, error } = await supabase.rpc(reset ? "reset_my_calendar_token" : "my_calendar_token");
    setCalBusy(false);
    if (error || !data) { setNote({ text: friendlyError(error, "make the calendar link"), bad: true }); return; }
    setCalUrl(`${window.location.origin}/api/calendar/${data as string}.ics`);
  }

  return (
    <PageShell width={920}>
      <div style={{ width: "100%", maxWidth: 700, margin: "0 auto" }}>
        <Header title="Your campaigns" sub="EVERY TABLE YOU PLAY AT" />

        <UpgradeAccount variant="card" next="/me/campaigns" />

        {note && <p role={note.bad ? "alert" : "status"} style={{ color: note.bad ? C.warn : C.muted, fontSize: 13.5, textAlign: "center", margin: "0 0 14px" }}>{note.text}</p>}
        {status === "loading" && <Muted>Loading&hellip;</Muted>}
        {status === "error" && <Muted>Something went wrong loading your campaigns. Please refresh.</Muted>}

        {status === "empty" && (
          <Muted>
            You are not in any campaigns yet. When your GM sends you a personal invite
            link, claim your character and the campaign will appear here.
          </Muted>
        )}

        {status === "ready" && rows.map((c) => {
          // Picking a campaign sets it as the player's active campaign, which themes their whole
          // experience to that system and points the Forge at it. Fires on any way into the table.
          const enter = () => setActiveCampaign({ id: c.campaign_id, name: c.campaign_name, system: c.system });
          return (
          <div
            key={c.campaign_id}
            style={{
              background: C.surface, border: `1px solid ${C.line}`,
              borderRadius: FORGE_RADIUS, padding: "16px 18px", marginBottom: 12, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontFamily: SAX.serif, fontSize: 19, fontWeight: 700, color: C.text }}>
                {c.campaign_name}
              </span>
              <span style={{ fontFamily: SAX.mono, fontSize: 11.5, color: C.muted, letterSpacing: "0.06em" }}>
                {c.system ? c.system.toUpperCase() : ""}
              </span>
            </div>

            <div style={{ color: C.muted, fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
              Run by {c.gm_name}. You play{" "}
              {c.my_characters === 1 ? "one character" : `${c.my_characters} characters`} here.
              {c.last_session_at && (
                <> Last session {fmtDate(c.last_session_at)}.</>
              )}
            </div>
            {next[c.campaign_id] && (() => {
              const n = next[c.campaign_id];
              const title = `${c.campaign_name}${n.session_number != null ? `: session ${n.session_number}` : ""}`;
              return (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8, fontSize: 13.5, color: C.text }}>
                  <span>Next session {fmtDateTime(n.scheduled_at)}.</span>
                  <button type="button" onClick={() => downloadSessionIcs({ id: n.session_id, title, start: n.scheduled_at, url: `${window.location.origin}/me/campaigns` })}
                    style={{ background: "transparent", border: "none", padding: 0, color: C.sun, fontSize: 13, cursor: "pointer", textDecoration: "underline", minHeight: "var(--sax-tap, 0px)" }}>
                    Add to calendar
                  </button>
                </div>
              );
            })()}

            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {c.share_code && <>
                <A href={`/me?share=${c.share_code}`} onClick={enter}>Journal</A>
                <A href={`/recaps?share=${c.share_code}`} onClick={enter}>Recaps</A>
                <A href={`/lore?share=${c.share_code}`} onClick={enter}>Lore</A>
                <A href={`/record?share=${c.share_code}`} onClick={enter}>Record</A>
              </>}
              <A href={tabletopUrl(c.campaign_id)} onClick={(e) => { e?.preventDefault(); enter(); openTabletop(c.campaign_id); }}>Tabletop</A>
              <A href="/me/forge" onClick={enter}>+ New character</A>
              <button type="button" onClick={() => void leave(c)} disabled={leaving === c.campaign_id}
                style={{ marginLeft: "auto", background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "6px 12px", fontSize: 12.5, fontFamily: SAX.mono, letterSpacing: "0.04em", cursor: "pointer", minHeight: "var(--sax-tap, 0px)" }}>
                {leaving === c.campaign_id ? "Leaving…" : "Leave this table"}
              </button>
            </div>
          </div>
          );
        })}

        {status === "ready" && (
          <div style={{ ...card, marginTop: 22 }}>
            <div style={{ fontFamily: SAX.serif, fontSize: 17, fontWeight: 700, color: C.text }}>Your sessions in your own calendar</div>
            <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "6px 0 10px" }}>
              One private address with every scheduled session at every table you play at or run. Add it to Google, Apple or Outlook
              Calendar once and new sessions appear on their own. Anyone with the address can see your session times, so keep it to yourself.
            </p>
            {!calUrl ? (
              <button type="button" onClick={() => void calendarLink()} disabled={calBusy} style={smallBtn}>{calBusy ? "Making it…" : "Get my calendar link"}</button>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <input readOnly value={calUrl} aria-label="Your calendar address" onFocus={(e) => e.currentTarget.select()}
                  style={{ width: "100%", boxSizing: "border-box", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "8px 10px", fontSize: 13 }} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" style={smallBtn} onClick={() => { void navigator.clipboard?.writeText(calUrl); setNote({ text: "Calendar address copied.", bad: false }); }}>Copy</button>
                  <a href={calUrl.replace(/^https?:/, "webcal:")} style={{ ...smallBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Open in my calendar app</a>
                  <button type="button" style={{ ...smallBtn, color: C.muted }} onClick={() => void calendarLink(true)} disabled={calBusy}>Replace the link</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Audit F13: the way from player to GM. GM access is still granted by hand while the pilot is
            gated, so this sends the request through the pilot form. */}
        {isGm === false && status !== "loading" && (
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ fontFamily: SAX.serif, fontSize: 17, fontWeight: 700, color: C.text }}>Run your own game</div>
            <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "6px 0 10px" }}>
              Want to be the GM of a table of your own? Six Axes is in a small pilot, so GM access is given by hand. Tell us about your table and we will get back to you.
            </p>
            <a href="/pilot?from=player" style={{ ...smallBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Ask for GM access</a>
          </div>
        )}
      </div>
    </PageShell>
  );
}

const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "16px 18px" };
const smallBtn: React.CSSProperties = {
  background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
  padding: "7px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: SAX.mono, letterSpacing: "0.04em", cursor: "pointer", minHeight: "var(--sax-tap, 0px)",
};

export function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <span style={{ fontFamily: SAX.serif, fontSize: 26, fontWeight: 700, color: C.text }}>{title}</span>
      </div>
      <div style={{
        fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.22em",
        textTransform: "uppercase", color: C.muted, textAlign: "center", marginBottom: 18,
      }}>
        {sub}
      </div>
      <div style={{ height: 3, borderRadius: 3, background: `linear-gradient(90deg, ${C.sun}, ${C.plum})`, marginBottom: 24 }} />
    </>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.65 }}>{children}</p>;
}

function A({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: (e?: React.MouseEvent) => void }) {
  return (
    <a
      href={href}
      onClick={onClick}
      style={{
        background: "transparent", color: C.text,
        border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
        padding: "6px 12px", fontSize: 12.5, fontWeight: 700,
        fontFamily: SAX.mono, letterSpacing: "0.04em", textDecoration: "none",
      }}
    >
      {children}
    </a>
  );
}
