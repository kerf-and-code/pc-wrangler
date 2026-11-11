"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { fmtDate } from "@/lib/format";
import { askConfirm } from "@/lib/confirm";
import { friendlyError } from "@/lib/friendly-error";

// components/campaign-gms.tsx (2026-11-10, push 18)
//
// The GMs panel on the Workspace (p149). Everyone who runs the campaign sees who the GMs are. The owner
// invites co-GMs with a single-use link (7 days), copies or cancels open links, and removes co-GMs. A
// co-GM can step down. Co-GMs can do everything the owner can except delete or trash the campaign, hand
// it over, and change who is a GM (Terry, 2026-11-10).

type Gm = { profile_id: string; display_name: string; role: "owner" | "co-gm"; since: string };
type Invite = { id: string; token: string; created_at: string; expires_at: string };

const field = { background: C.ink, color: C.vellum, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "9px 11px", fontSize: 14 } as const;
const ghost = { background: "none", color: C.brass, border: `1px solid ${C.brassDim}`, borderRadius: FORGE_RADIUS, padding: "9px 16px", fontSize: 13, cursor: "pointer", minHeight: "var(--sax-tap, 0px)" } as const;
const danger = { background: "none", color: C.warn, border: `1px solid ${C.warn}`, borderRadius: FORGE_RADIUS, padding: "7px 12px", fontSize: 12.5, cursor: "pointer", minHeight: "var(--sax-tap, 0px)" } as const;

function inviteLink(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/cogm/${token}`;
}

export function CampaignGms({ campaignId, campaignName, isOwner, userId, onLeft }: {
  campaignId: string;
  campaignName: string;
  isOwner: boolean;
  userId: string | null;
  onLeft: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [gms, setGms] = useState<Gm[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("campaign_gms", { p_campaign: campaignId });
    if (error) {
      setGms([]);
      setMsg(/function|schema cache/i.test(error.message) ? "Co-GMs are being set up. Try again in a few minutes." : friendlyError(error));
      return;
    }
    setGms((data as Gm[]) ?? []);
    if (isOwner) {
      const { data: inv } = await supabase.rpc("gm_invites_open", { p_campaign: campaignId });
      setInvites((inv as Invite[]) ?? []);
    } else {
      setInvites([]);
    }
  }, [supabase, campaignId, isOwner]);

  useEffect(() => { setMsg(null); setFresh(null); void load(); }, [load]);

  async function copy(token: string) {
    const link = inviteLink(token);
    try { await navigator.clipboard.writeText(link); setCopied(token); setTimeout(() => setCopied(null), 2000); }
    catch { setMsg("Could not copy. Select the link and copy it yourself."); }
  }

  async function invite() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("create_gm_invite", { p_campaign: campaignId });
    setBusy(false);
    if (error) { setMsg(friendlyError(error)); return; }
    const token = String(data ?? "");
    setFresh(token);
    void copy(token);
    void load();
  }

  async function cancel(inv: Invite) {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("revoke_gm_invite", { p_invite: inv.id });
    setBusy(false);
    if (error) { setMsg(friendlyError(error)); return; }
    if (fresh === inv.token) setFresh(null);
    setMsg("Invite cancelled. That link no longer works.");
    void load();
  }

  async function remove(g: Gm) {
    const self = g.profile_id === userId;
    const ok = await askConfirm(self
      ? `Step down as co-GM of ${campaignName}? You lose the GM tools for it. If you have a character here you stay as a player.`
      : `Remove ${g.display_name} as co-GM of ${campaignName}? They lose the GM tools for it straight away, and any add-on keys they made stop working.`,
      { confirmLabel: self ? "Step down" : "Remove co-GM" });
    if (!ok) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("remove_campaign_gm", { p_campaign: campaignId, p_profile: g.profile_id });
    setBusy(false);
    if (error) { setMsg(friendlyError(error)); return; }
    if (self) { onLeft(); return; }
    setMsg(`${g.display_name} is no longer a co-GM.`);
    void load();
  }

  const coGms = (gms ?? []).filter((g) => g.role === "co-gm");
  const iAmCoGm = !isOwner && coGms.some((g) => g.profile_id === userId);

  return (
    <section aria-labelledby={`gms-${campaignId}`} style={{ marginTop: 14, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "12px 14px", display: "grid", gap: 10 }}>
      <h3 id={`gms-${campaignId}`} style={{ margin: 0, fontSize: 13, color: C.text, fontWeight: 600 }}>GMs</h3>
      {gms === null ? (
        <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Loading the GMs...</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {gms.map((g) => (
            <li key={g.profile_id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13.5, color: C.vellum }}>
              <span>{g.display_name}{g.profile_id === userId ? " (you)" : ""}</span>
              <span style={{ fontSize: 12, color: C.muted }}>{g.role === "owner" ? "Owner" : `Co-GM since ${fmtDate(g.since)}`}</span>
              {g.role === "co-gm" && (isOwner || g.profile_id === userId) && (
                <button type="button" style={danger} onClick={() => remove(g)} disabled={busy}>
                  {g.profile_id === userId ? "Step down" : "Remove"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isOwner && (
        <>
          <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
            A co-GM can do everything you can here except delete or trash the campaign, hand it over, or change who is a GM.
            Each invite link works once, for 7 days, and needs them signed in with their own account.
          </p>
          <div><button type="button" style={ghost} onClick={invite} disabled={busy}>{busy ? "Working..." : "Invite a co-GM"}</button></div>
          {invites.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {invites.map((inv) => (
                <li key={inv.id} style={{ display: "grid", gap: 6 }}>
                  <input readOnly value={inviteLink(inv.token)} onFocus={(e) => e.currentTarget.select()}
                    aria-label={`Co-GM invite link, works until ${fmtDate(inv.expires_at)}`} style={{ ...field, width: "100%" }} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button type="button" style={ghost} onClick={() => copy(inv.token)}>{copied === inv.token ? "Copied" : "Copy link"}</button>
                    <button type="button" style={danger} onClick={() => cancel(inv)} disabled={busy}>Cancel invite</button>
                    <span style={{ fontSize: 12, color: C.muted }}>
                      {fresh === inv.token ? "New link, copied. " : ""}Works until {fmtDate(inv.expires_at)}.
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {iAmCoGm && (
        <p style={{ margin: 0, fontSize: 12.5, color: C.muted, lineHeight: 1.55 }}>
          You co-GM this campaign. The owner can delete it, hand it over, and add or remove GMs.
        </p>
      )}
      {msg && <p role="status" style={{ margin: 0, fontSize: 13, color: C.muted }}>{msg}</p>}
    </section>
  );
}
