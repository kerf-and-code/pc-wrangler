"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { fmtDate } from "@/lib/format";
import { askConfirm } from "@/lib/confirm";
import { TABLE_LANGUAGES } from "@/lib/languages";

// components/campaign-safety.tsx (2026-11-09)
//
// Push 2 of the audit plan, on the GM workspace:
//   CampaignSettings   rename the campaign and set its time zone (audit F9; the zone is what reminder
//                      emails use), plus a Danger zone that moves the campaign to the trash (audit F4,
//                      U16). Moving to the trash is undoable for 30 days, so it takes a second click, not
//                      a typed name.
//   Push 3: CampaignSettings also downloads the whole campaign (audit F3, /api/gm/campaign/export) and,
//   for the owner, hands it to another GM (audit F2, /api/gm/campaign/transfer and p140).
//   CampaignTrash      the GM's trash: restore, or delete forever now, which is permanent and so takes the
//                      campaign's name typed in (p139 my_trashed_campaigns / restore_campaign, and
//                      /api/gm/campaign/delete, which also removes the files).
// One danger style throughout: C.warn outline, warning-coloured text.

export type CampaignBasics = { id: string; name: string; gm_id: string; time_zone?: string | null };

const field = { background: C.ink, color: C.vellum, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "9px 11px", fontSize: 14 } as const;
const ghost = { background: "none", color: C.brass, border: `1px solid ${C.brassDim}`, borderRadius: FORGE_RADIUS, padding: "9px 16px", fontSize: 13, cursor: "pointer" } as const;
const danger = { background: "none", color: C.warn, border: `1px solid ${C.warn}`, borderRadius: FORGE_RADIUS, padding: "9px 14px", fontSize: 13, cursor: "pointer" } as const;

function timeZones(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (f) return f("timeZone");
  } catch { /* older browsers */ }
  return ["UTC"];
}

export function CampaignSettings({ campaign, isOwner, onChanged, onTrashed }: {
  campaign: CampaignBasics;
  isOwner: boolean;
  onChanged: (patch: Partial<CampaignBasics>) => void;
  onTrashed: (eraseAt: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState(campaign.name);
  const [tz, setTz] = useState(campaign.time_zone || "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const zones = useMemo(() => timeZones(), []);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [handTo, setHandTo] = useState("");
  const [handBusy, setHandBusy] = useState(false);
  const [handMsg, setHandMsg] = useState<string | null>(null);
  const [handLink, setHandLink] = useState<string | null>(null);
  const [pending, setPending] = useState<{ toEmail: string; expiresAt: string } | null>(null);

  useEffect(() => {
    if (!isOwner) { setPending(null); return; }
    let live = true;
    (async () => {
      const { data } = await supabase.rpc("my_campaign_transfer", { p_campaign: campaign.id });
      if (live) setPending((data as { toEmail: string; expiresAt: string } | null) ?? null);
    })();
    return () => { live = false; };
  }, [supabase, campaign.id, isOwner]);

  // Push 24 (audit F16): copy the prepared world into a new campaign, then open it in the Workspace.
  const [duplicating, setDuplicating] = useState(false);
  const [dupMsg, setDupMsg] = useState<string | null>(null);
  async function duplicateCampaign() {
    const ok = await askConfirm(`Make a new campaign from ${campaign.name}? It copies the codex, NPCs, stat blocks, encounters, roll tables, prep, maps, tabletop scenes and card decks. Players, sessions, recaps and recordings stay here.`, { confirmLabel: "Duplicate" });
    if (!ok) return;
    setDuplicating(true); setDupMsg(null);
    const res = await fetch("/api/gm/campaign/duplicate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId: campaign.id }),
    }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { campaignId?: string; name?: string; error?: string } | null;
    setDuplicating(false);
    if (!res || !res.ok || !out?.campaignId) { setDupMsg(out?.error || "Could not duplicate the campaign. Try again."); return; }
    setDupMsg(`Made ${out.name}. Opening it...`);
    window.location.assign(`/gm?campaign=${encodeURIComponent(out.campaignId)}`);
  }

  async function exportCampaign() {
    setExporting(true); setExportMsg(null);
    const res = await fetch("/api/gm/campaign/export", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId: campaign.id }),
    }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { url?: string; bytes?: number; error?: string; skipped?: string[] } | null;
    setExporting(false);
    if (!res || !res.ok || !out?.url) { setExportMsg(out?.error || "Could not build the export. Try again."); return; }
    window.location.href = out.url;
    const mb = ((out.bytes || 0) / 1048576).toFixed(1);
    setExportMsg(`Downloading (${mb} MB).${out.skipped?.length ? ` Some parts could not be read: ${out.skipped.length}. The README in the zip lists them.` : ""}`);
  }

  async function handOver() {
    setHandBusy(true); setHandMsg(null); setHandLink(null);
    const res = await fetch("/api/gm/campaign/transfer", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId: campaign.id, email: handTo }),
    }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { link?: string; emailed?: boolean; expiresAt?: string; error?: string } | null;
    setHandBusy(false);
    if (!res || !res.ok || !out?.link) { setHandMsg(out?.error || "Could not start the handover. Try again."); return; }
    setPending({ toEmail: handTo.trim().toLowerCase(), expiresAt: out.expiresAt || "" });
    setHandLink(out.link);
    setHandTo("");
    setHandMsg(out.emailed ? "Sent. They accept from the email; the link below works too." : "The email did not go out. Send them the link below yourself.");
  }

  async function cancelHandover() {
    setHandBusy(true); setHandMsg(null);
    const { error } = await supabase.rpc("cancel_campaign_transfer", { p_campaign: campaign.id });
    setHandBusy(false);
    if (error) { setHandMsg(`Not cancelled: ${error.message}`); return; }
    setPending(null); setHandLink(null);
    setHandMsg("Handover cancelled. The link no longer works.");
  }

  useEffect(() => { setName(campaign.name); setTz(campaign.time_zone || ""); setConfirming(false); setMsg(null); }, [campaign.id, campaign.name, campaign.time_zone]);

  const dirty = name.trim() !== campaign.name || (tz || null) !== (campaign.time_zone || null);

  // Push 26 (audit P2): the table's language, read on its own so the panel still works before p152
  // has run (then the field stays hidden).
  const [lang, setLang] = useState<string | null>(null);
  const [langMsg, setLangMsg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setLang(null); setLangMsg(null);
    void supabase.from("campaigns").select("audio_language").eq("id", campaign.id).maybeSingle().then(({ data, error }) => {
      if (live && !error) setLang((data as { audio_language: string | null } | null)?.audio_language || "en");
    });
    return () => { live = false; };
  }, [supabase, campaign.id]);
  async function saveLang(code: string) {
    const prev = lang;
    setLang(code); setLangMsg(null);
    const { error } = await supabase.from("campaigns").update({ audio_language: code === "en" ? null : code }).eq("id", campaign.id);
    if (error) { setLang(prev); setLangMsg(`Not saved: ${error.message}`); return; }
    setLangMsg("Saved. New recordings are transcribed in this language, and recaps are written in it.");
  }

  async function save() {
    const n = name.trim();
    if (!n) { setMsg("A campaign needs a name."); return; }
    setBusy(true); setMsg(null);
    const patch = { name: n.slice(0, 120), time_zone: tz || null };
    const { error } = await supabase.from("campaigns").update(patch).eq("id", campaign.id);
    setBusy(false);
    if (error) { setMsg(`Not saved: ${error.message}`); return; }
    onChanged(patch);
    setMsg("Saved.");
  }

  async function trash() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("trash_campaign", { p_campaign: campaign.id });
    setBusy(false);
    if (error) { setMsg(`Not moved to the trash: ${error.message}`); return; }
    onTrashed(String(data ?? ""));
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}`, display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5, color: C.muted, flex: "1 1 220px" }}>
          Campaign name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} style={field} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5, color: C.muted, flex: "1 1 220px" }}>
          Time zone (for session times in emails)
          <select value={tz} onChange={(e) => setTz(e.target.value)} style={field}>
            <option value="">Not set (emails say UTC)</option>
            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <button title={!dirty ? "Nothing has changed yet" : undefined} type="button" style={ghost} onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save details"}</button>
      </div>
      {msg && <p role="status" style={{ margin: 0, fontSize: 13, color: msg === "Saved." ? C.muted : C.warn }}>{msg}</p>}

      {lang !== null && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12.5, color: C.muted, flex: "1 1 220px", maxWidth: 320 }}>
            Language the table plays in
            <select value={lang} onChange={(e) => void saveLang(e.target.value)} style={field}>
              {TABLE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </label>
          <span style={{ fontSize: 12.5, color: C.muted, flex: "1 1 240px" }}>Sets the language recordings are transcribed in and recaps and the journal are written in. The app itself stays in English.</span>
        </div>
      )}
      {langMsg && <p role="status" style={{ margin: 0, fontSize: 13, color: langMsg.startsWith("Saved") ? C.muted : C.warn }}>{langMsg}</p>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={ghost} onClick={exportCampaign} disabled={exporting}>{exporting ? "Building the export..." : "Download campaign (zip)"}</button>
        <span style={{ fontSize: 12.5, color: C.muted }}>Sessions, recaps, codex, characters, maps and table, as JSON and Markdown. Players&rsquo; private notes and the recordings are not included.</span>
      </div>
      {exportMsg && <p role="status" style={{ margin: 0, fontSize: 13, color: C.muted }}>{exportMsg}</p>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={ghost} onClick={() => void duplicateCampaign()} disabled={duplicating}>{duplicating ? "Duplicating..." : "Duplicate campaign"}</button>
        <span style={{ fontSize: 12.5, color: C.muted }}>A fresh campaign with the same world and prep, for another table or a new run. No players, sessions or recordings.</span>
      </div>
      {dupMsg && <p role="status" style={{ margin: 0, fontSize: 13, color: C.muted }}>{dupMsg}</p>}

      {isOwner && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "12px 14px", display: "grid", gap: 8 }}>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>Hand over to another GM</div>
          {pending ? (
            <>
              <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
                Offered to <span style={{ color: C.text }}>{pending.toEmail}</span>
                {pending.expiresAt ? `, until ${fmtDate(pending.expiresAt)}` : ""}.
                When they accept, they become the GM and you stay in the campaign as a player.
              </p>
              {handLink && <input readOnly value={handLink} onFocus={(e) => e.currentTarget.select()} aria-label="Handover link" style={{ ...field, width: "100%" }} />}
              <div><button type="button" style={ghost} onClick={cancelHandover} disabled={handBusy}>Cancel the handover</button></div>
            </>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
                They get an email with a link and accept while signed in with that address (they need GM access). You stay in the
                campaign as a player. The link works for 7 days.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input type="email" value={handTo} onChange={(e) => setHandTo(e.target.value)} placeholder="their email address"
                  aria-label="New GM's email address" style={{ ...field, flex: "1 1 240px" }} />
                <button title={!handTo.trim() ? "Type who should receive the campaign first" : undefined} type="button" style={ghost} onClick={handOver} disabled={handBusy || !handTo.trim()}>{handBusy ? "Sending…" : "Send handover"}</button>
              </div>
            </>
          )}
          {handMsg && <p role="status" style={{ margin: 0, fontSize: 13, color: C.muted }}>{handMsg}</p>}
        </div>
      )}

      {isOwner && (
        <div style={{ border: `1px solid ${C.warn}`, borderRadius: FORGE_RADIUS, padding: "12px 14px", display: "grid", gap: 8 }}>
          <div style={{ fontSize: 13, color: C.warn, fontWeight: 600 }}>Danger zone</div>
          <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
            Moving {campaign.name} to the trash hides it from you and your players at once: its share code, Discord link and
            public codex stop working. You can restore it for 30 days; after that it is erased with its recordings and files.
          </p>
          {!confirming
            ? <div><button type="button" style={danger} onClick={() => setConfirming(true)} disabled={busy}>Move to trash</button></div>
            : <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" style={{ ...danger, background: "rgba(200,80,70,0.12)" }} onClick={trash} disabled={busy}>
                  {busy ? "Moving…" : `Yes, move ${campaign.name} to the trash`}
                </button>
                <button type="button" style={ghost} onClick={() => setConfirming(false)} disabled={busy}>Keep it</button>
              </div>}
        </div>
      )}
    </div>
  );
}

type Trashed = { id: string; name: string; deletedAt: string; eraseAt: string };

export function CampaignTrash({ refreshKey, onRestored }: { refreshKey: number; onRestored: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Trashed[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [erasing, setErasing] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase.rpc("my_trashed_campaigns");
      if (!live) return;
      if (error) { setMsg("Could not load your trash."); return; }
      setItems((data as Trashed[]) || []);
    })();
    return () => { live = false; };
  }, [supabase, refreshKey]);

  async function restore(t: Trashed) {
    setBusy(t.id); setMsg(null);
    const { error } = await supabase.rpc("restore_campaign", { p_campaign: t.id });
    setBusy(null);
    if (error) { setMsg(`Not restored: ${error.message}`); return; }
    setItems((xs) => xs.filter((x) => x.id !== t.id));
    setMsg(`${t.name} is back, with its share code and Discord link.`);
    onRestored();
  }

  async function eraseNow(t: Trashed) {
    if (typed.trim() !== t.name.trim()) { setMsg("The name didn't match, so nothing was deleted."); return; }
    setBusy(t.id); setMsg(null);
    const res = await fetch("/api/gm/campaign/delete", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId: t.id, confirm: typed.trim() }),
    }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; note?: string } | null;
    setBusy(null);
    if (!res || !res.ok || !out?.ok) { setMsg(out?.error || "Could not delete it. Check your connection and try again."); return; }
    setItems((xs) => xs.filter((x) => x.id !== t.id));
    setErasing(null); setTyped("");
    setMsg(out.note || `${t.name} is deleted for good.`);
  }

  if (!items.length && !msg) return null;
  const day = (iso: string) => fmtDate(iso);
  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Trash</div>
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((t) => (
          <div key={t.id} style={{ border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "10px 12px", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ flex: 1, color: C.text, fontSize: 14 }}>{t.name}</span>
              <span style={{ fontSize: 12.5, color: C.muted }}>erased on {day(t.eraseAt)}</span>
              <button type="button" style={ghost} onClick={() => restore(t)} disabled={busy === t.id}>{busy === t.id ? "Working…" : "Restore"}</button>
              <button type="button" style={danger} onClick={() => { setErasing(erasing === t.id ? null : t.id); setTyped(""); }} disabled={busy === t.id}>Delete forever now</button>
            </div>
            {erasing === t.id && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ fontSize: 12.5, color: C.muted, display: "grid", gap: 4, flex: "1 1 220px" }}>
                  This cannot be undone. Type {t.name} to confirm.
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} style={field} autoComplete="off" />
                </label>
                <button title={typed.trim() !== t.name.trim() ? "Type the campaign name to confirm" : undefined} type="button" style={{ ...danger, background: "rgba(200,80,70,0.12)" }} onClick={() => eraseNow(t)}
                  disabled={busy === t.id || typed.trim() !== t.name.trim()}>
                  {busy === t.id ? "Deleting…" : "Delete forever"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {msg && <p role="status" style={{ margin: "10px 0 0", fontSize: 13, color: C.muted }}>{msg}</p>}
    </div>
  );
}
