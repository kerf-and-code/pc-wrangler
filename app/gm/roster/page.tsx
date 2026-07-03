"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import TableTapCard from "@/components/table-tap-card";
import BoundariesCard from "@/components/boundaries-card";
import { SAX, surfaces, ui } from "@/lib/theme";

const C = {
  bg: SAX.ink, surface: SAX.slateBg, surface2: "rgba(11,7,18,0.6)", line: SAX.line,
  text: SAX.text, muted: SAX.muted, sun: SAX.sun, plum: SAX.plum, warn: SAX.warn, good: SAX.good,
};

type Campaign = { id: string; name: string; share_code: string | null };
type Char = { id: string; name: string; profile_id: string | null; invite_code: string | null };
type Resp = { id: string; player_name: string | null; assigned_character_id: string | null; created_at: string };

export default function RosterPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [rotating, setRotating] = useState<boolean>(false);
  const [rotateMsg, setRotateMsg] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string>("");
  const [chars, setChars] = useState<Char[]>([]);
  const [responses, setResponses] = useState<Resp[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<string>("");
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
      const { data } = await supabase.from("campaigns").select("id, name, share_code").order("created_at", { ascending: true });
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  async function load(cid: string) {
    setLoading(true);
    const [{ data: ch }, { data: rs }, { data: ev }] = await Promise.all([
      supabase.from("characters").select("id, name, profile_id, invite_code").eq("campaign_id", cid).eq("kind", "pc").order("name", { ascending: true }),
      supabase.from("tpdi_responses").select("id, player_name, assigned_character_id, created_at").eq("campaign_id", cid).order("created_at", { ascending: false }),
      supabase.from("events").select("character_id").eq("campaign_id", cid),
    ]);
    setChars((ch as Char[]) || []);
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
    if (e) setError(e.message);
    await load(campaignId);
    setBusy(false);
  }
  async function unbind(responseId: string) {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc("unassign_response", { p_response: responseId });
    if (e) setError(e.message);
    await load(campaignId);
    setBusy(false);
  }

  const respFor = (charId: string): Resp | null => responses.find((r) => r.assigned_character_id === charId) || null;
  const unassigned = responses.filter((r) => !r.assigned_character_id);
  const respLabel = (r: Resp): string => r.player_name?.trim() || `Anonymous · ${new Date(r.created_at).toLocaleDateString()}`;
  const boundCount = chars.filter((c) => respFor(c.id)).length;

  const box = { ...surfaces.slate, padding: 20, marginBottom: 18 } as const;

  return (
    <PageShell width={820}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Roster &amp; identity</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 20px" }}>
        Send each player their personal invite link below: opening it ties their inventory to that character from the start. Manual binding stays here as a fallback for anyone who took the inventory before joining.
      </p>

        <div style={box}>
          <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>CAMPAIGN</label>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 15 }}>
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </div>

        {loading ? (
          <div style={{ ...box, color: C.muted, fontSize: 14 }}>Loading…</div>
        ) : (
          <>
            <div style={{ ...box, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 14 }}>
                <span style={{ color: boundCount === chars.length && chars.length > 0 ? C.good : C.sun, fontWeight: 800, fontSize: 18 }}>{boundCount}</span>
                <span style={{ color: C.muted }}> of {chars.length} characters bound to an inventory</span>
              </div>
              {error && <span style={{ color: C.warn, fontSize: 13 }}>{error}</span>}
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
                          style={{ marginTop: 8, background: "transparent", color: copied === ch.invite_code ? C.good : C.plum, border: `1px solid ${C.line}`, borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          {copied === ch.invite_code ? "Copied!" : "Copy player invite"}
                        </button>
                      </div>
                      {r ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 13 }}>
                            <span style={{ color: C.muted }}>inventory:</span> <span style={{ color: C.good, fontWeight: 600 }}>{respLabel(r)}</span>
                          </span>
                          <button type="button" onClick={() => unbind(r.id)} disabled={busy} style={{ background: "transparent", color: C.warn, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Unbind</button>
                        </div>
                      ) : unassigned.length > 0 ? (
                        <select defaultValue="" disabled={busy} onChange={(e) => { if (e.target.value) bind(e.target.value, ch.id); }}
                          style={{ background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 12px", fontSize: 13, minWidth: 200 }}>
                          <option value="">Bind an inventory…</option>
                          {unassigned.map((u) => (<option key={u.id} value={u.id}>{respLabel(u)}</option>))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 12.5, color: C.muted }}>no unbound inventories</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {(() => {
              const shareCode = campaigns.find((c) => c.id === campaignId)?.share_code ?? null;
              if (!shareCode) return null;
              const rotate = async () => {
                if (rotating) return;
                if (!window.confirm("Regenerate the session link? The old link stops working immediately, and everyone will need the new one.")) return;
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
                      style={{ background: "transparent", color: C.warn, border: `1px solid ${C.line}`, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: rotating ? "default" : "pointer" }}>
                      {rotating ? "Regenerating..." : "Regenerate session link"}
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
                    <span key={u.id} style={{ fontSize: 13, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 12px" }}>{respLabel(u)}</span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
    </PageShell>
  );
}
