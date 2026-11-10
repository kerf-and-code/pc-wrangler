"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import TableTapCard from "@/components/table-tap-card";
import BoundariesCard from "@/components/boundaries-card";
import { surfaces, ui } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import CharacterSheetPeek, { type Build } from "@/components/character-sheet-peek";
import { initialCampaignId, useRememberCampaign } from "@/lib/campaign-context";
import { friendlyError } from "@/lib/friendly-error";
import { askConfirm } from "@/lib/confirm";
import { fmtDate } from "@/lib/format";
import { LoadingState } from "@/components/ui-forge/States";

type Campaign = { id: string; name: string; share_code: string | null };
type Char = { id: string; name: string; profile_id: string | null; invite_code: string | null; build: Build; active: boolean | null };
type Resp = { id: string; player_name: string | null; assigned_character_id: string | null; created_at: string };

export default function RosterPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [rotating, setRotating] = useState<boolean>(false);
  const [rotateMsg, setRotateMsg] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string>("");
  useRememberCampaign(campaignId, campaigns);
  // Players in the party, and the ones removed from it. Removing a player used to leave them on
  // this list (and on Player check-ins, Capture and Roll), because only some pages honoured the
  // characters.active flag that "remove" sets.
  const [chars, setChars] = useState<Char[]>([]);
  const [removed, setRemoved] = useState<Char[]>([]);
  const [responses, setResponses] = useState<Resp[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<string>("");
  // One sheet open at a time. Seven expanded rows is a wall, and the reason to open one is almost
  // always to check a single thing about a single character.
  const [openSheet, setOpenSheet] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string>("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const inviteLink = (code: string | null): string => code ? `${origin}/join?c=${code}` : "";
  async function copyInvite(code: string | null) {
    const link = inviteLink(code);
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(code as string); setTimeout(() => setCopied(""), 1600); }
    catch (e) { /* clipboard blocked */ }
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name, share_code, system").order("created_at", { ascending: true });
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      // A brand-new GM has no campaigns, so campaignId stays "" and the loader
      // below never runs. Clear loading here so they see the empty state, not a
      // permanent "Loading…".
      if (list.length) setCampaignId(initialCampaignId(list));
      else setLoading(false);
    })();
  }, [supabase]);

  async function load(cid: string) {
    setLoading(true);
    const [{ data: ch }, { data: rs }, { data: ev }] = await Promise.all([
      supabase.from("characters").select("id, name, profile_id, invite_code, build, active").eq("campaign_id", cid).eq("kind", "pc").order("name", { ascending: true }),
      supabase.from("tpdi_responses").select("id, player_name, assigned_character_id, created_at").eq("campaign_id", cid).order("created_at", { ascending: false }),
      supabase.from("events").select("character_id").eq("campaign_id", cid),
    ]);
    const all = (ch as Char[]) || [];
    setChars(all.filter((c) => c.active !== false));
    setRemoved(all.filter((c) => c.active === false));
    setResponses((rs as Resp[]) || []);
    const tally: Record<string, number> = {};
    ((ev as { character_id: string | null }[]) || []).forEach((e) => { if (e.character_id) tally[e.character_id] = (tally[e.character_id] || 0) + 1; });
    setCounts(tally);
    setLoading(false);
  }

  useEffect(() => { if (campaignId) load(campaignId); }, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function bind(responseId: string, characterId: string) {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc("assign_response_to_character", { p_response: responseId, p_character: characterId });
    if (e) setError(friendlyError(e));
    await load(campaignId);
    setBusy(false);
  }
  async function setActive(ch: Char, activeNow: boolean) {
    if (!activeNow && !await askConfirm(`Remove ${ch.name} from this campaign? They leave the party everywhere: Tonight, check-ins, recording consent, encounters and the roll list, and the Discord bot stops treating them as a player here. Their history (events, rolls, recaps) is kept, and you can restore them below.`)) return;
    setBusy(true); setError(null);
    // Checked: an update that RLS filters out returns no error and changes nothing, so ask for the row back.
    const { data, error: e } = await supabase.from("characters").update({ active: activeNow }).eq("id", ch.id).select("id");
    if (e) setError(friendlyError(e));
    else if (!data || data.length === 0) setError(`${ch.name} was not ${activeNow ? "restored" : "removed"}: you may not have permission to change this character.`);
    await load(campaignId);
    setBusy(false);
  }
  async function unbind(responseId: string) {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc("unassign_response", { p_response: responseId });
    if (e) setError(friendlyError(e));
    await load(campaignId);
    setBusy(false);
  }

  const respFor = (charId: string): Resp | null => responses.find((r) => r.assigned_character_id === charId) || null;
  const unassigned = responses.filter((r) => !r.assigned_character_id);
  const respLabel = (r: Resp): string => r.player_name?.trim() || `Anonymous · ${fmtDate(r.created_at)}`;
  const boundCount = chars.filter((c) => respFor(c.id)).length;

  const box = { ...surfaces.slate, padding: 20, marginBottom: 18 } as const;

  return (
    <PageShell width={820}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Roster</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 20px" }}>
        Send each player their personal invite link below: opening it ties their inventory to that character from the start. Manual binding stays here as a fallback for anyone who took the inventory before joining.
      </p>

        <div style={box}>
          <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>CAMPAIGN</label>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "10px 12px", fontSize: 15, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </div>

        {loading ? (
          <LoadingState />
        ) : (
          <>
            <div style={{ ...box, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 14 }}>
                <span style={{ color: boundCount === chars.length && chars.length > 0 ? C.good : C.sun, fontWeight: 800, fontSize: 18 }}>{boundCount}</span>
                <span style={{ color: C.muted }}> of {chars.length} characters bound to an inventory</span>
              </div>
              {error && <span role="alert" style={{ color: C.warn, fontSize: 13 }}>{error}</span>}
            </div>

            {chars.length === 0 ? (
              <div style={{ ...box, color: C.muted, fontSize: 14 }}>No player characters in this campaign yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 12, marginBottom: 18 }}>
                {chars.map((ch) => {
                  const r = respFor(ch.id);
                  return (
                    <div key={ch.id} style={{ ...box, marginBottom: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 240 }}>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{ch.name}</div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{counts[ch.id] || 0} events logged</div>
                        <button type="button" onClick={() => copyInvite(ch.invite_code)}
                          style={{ marginTop: 8, background: "transparent", color: copied === ch.invite_code ? C.good : C.plum, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          {copied === ch.invite_code ? "Copied!" : "Copy player invite"}
                        </button>
                        <button type="button" onClick={() => setOpenSheet((cur) => (cur === ch.id ? null : ch.id))}
                          style={{ marginTop: 8, marginLeft: 8, background: "transparent", color: C.plum, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          {openSheet === ch.id ? "Hide sheet" : "View sheet"}
                        </button>
                        <a href={`/me/characters/${ch.id}`} target="_blank" rel="noopener noreferrer"
                          style={{ marginTop: 8, marginLeft: 8, display: "inline-block", textDecoration: "none", background: "transparent", color: C.plum, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "5px 10px", fontSize: 12, fontWeight: 600 }}>
                          Character page
                        </a>
                        <button type="button" onClick={() => void setActive(ch, false)} disabled={busy}
                          style={{ marginTop: 8, marginLeft: 8, background: "transparent", color: C.warn, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          Remove from campaign
                        </button>
                      </div>
                      {r ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 13 }}>
                            <span style={{ color: C.muted }}>inventory:</span> <span style={{ color: C.good, fontWeight: 600 }}>{respLabel(r)}</span>
                          </span>
                          <button type="button" onClick={async () => { if (await askConfirm(`Unbind ${respLabel(r)} from ${ch.name}? The inventory stays, but it stops showing on this character until you bind it again.`)) unbind(r.id); }} disabled={busy} style={{ background: "transparent", color: C.warn, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Unbind</button>
                        </div>
                      ) : unassigned.length > 0 ? (
                        <select defaultValue="" disabled={busy} onChange={async (e) => {
                          const el = e.currentTarget;
                          const id = el.value;
                          if (!id) return;
                          const u = unassigned.find((x) => x.id === id);
                          // Binding takes effect on pick, so a misclick in the list used to bind the wrong inventory.
                          if (await askConfirm(`Bind ${u ? respLabel(u) : "this inventory"} to ${ch.name}?`)) bind(id, ch.id);
                          else el.value = "";
                        }}
                          style={{ background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "9px 12px", fontSize: 13, minWidth: 200, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
                          <option value="">Bind an inventory…</option>
                          {unassigned.map((u) => (<option key={u.id} value={u.id}>{respLabel(u)}</option>))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 12.5, color: C.muted }}>no unbound inventories</span>
                      )}
                      {openSheet === ch.id && (
                        <CharacterSheetPeek build={ch.build} characterId={ch.id} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {removed.length > 0 && (
              <div style={{ ...box }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Removed from the party</div>
                <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10 }}>
                  Not shown anywhere in the campaign. Their history stays in recaps, mechanics and transcripts. Restore puts them back in the party.
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {removed.map((ch) => (
                    <div key={ch.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, color: C.muted }}>{ch.name} <span style={{ fontSize: 12 }}>({counts[ch.id] || 0} events logged)</span></span>
                      <button type="button" onClick={() => void setActive(ch, true)} disabled={busy}
                        style={{ background: "transparent", color: C.sun, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(() => {
              const shareCode = campaigns.find((c) => c.id === campaignId)?.share_code ?? null;
              if (!shareCode) return null;
              const rotate = async () => {
                if (rotating) return;
                if (!await askConfirm("Regenerate the session link? The old link stops working immediately, and everyone will need the new one.")) return;
                setRotating(true);
                setRotateMsg(null);
                try {
                  const res = await fetch("/api/campaign/rotate-share", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ campaign_id: campaignId }),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (res.ok && data.share_code) {
                    setCampaigns((prev) => prev.map((c) => (c.id === campaignId ? { ...c, share_code: data.share_code } : c)));
                    setRotateMsg("New link generated. Share it with your players.");
                  } else {
                    setRotateMsg(typeof data.error === "string" ? data.error : "Could not regenerate the link.");
                  }
                } catch {
                  setRotateMsg("Network error. Try again.");
                } finally {
                  setRotating(false);
                }
              };
              return (
                <div style={{ marginBottom: 18 }}>
                  <TableTapCard shareCode={shareCode} />
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={rotate} disabled={rotating}
                      style={{ background: "transparent", color: C.warn, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: rotating ? "default" : "pointer" }}>
                      {rotating ? "Regenerating…" : "Regenerate session link"}
                    </button>
                    {rotateMsg && <span style={{ fontSize: 12, color: C.muted }}>{rotateMsg}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, maxWidth: 520, lineHeight: 1.5 }}>
                    Use this if a link leaked or a player left the table. The old link stops working right away.
                  </div>
                </div>
              );
            })()}

            {campaignId && (
              <div style={{ marginBottom: 18 }}>
                <BoundariesCard campaignId={campaignId} />
              </div>
            )}

            <div style={box}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Unbound inventories</div>
              <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>People who took the inventory but aren&apos;t tied to a character yet. Bind them above.</div>
              {unassigned.length === 0 ? (
                <p style={{ color: C.muted, fontSize: 13 }}>None. Every inventory is bound.</p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {unassigned.map((u) => (
                    <span key={u.id} style={{ fontSize: 13, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 12px", boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>{respLabel(u)}</span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
    </PageShell>
  );
}
