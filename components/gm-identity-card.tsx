"use client";

import React, { useCallback, useEffect, useState } from "react";
import { SAX, surfaces } from "@/lib/theme";

const C = {
  surface2: "rgba(11,7,18,0.6)",
  line: SAX.line,
  text: SAX.text,
  muted: SAX.muted,
  sun: SAX.sun,
  plum: SAX.plum,
  warn: SAX.warn,
  good: SAX.good,
};

type Identity = {
  id: string;
  campaign_id: string;
  profile_id: string | null;
  discord_user_id: string | null;
  display_name: string | null;
};

type LoadResult = { identities?: Identity[]; mineId?: string | null; error?: string };
type SaveResult = { ok?: boolean; error?: string };

export default function GmIdentityCard({ campaignId }: { campaignId: string }) {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [mineId, setMineId] = useState<string | null>(null);
  const [discordId, setDiscordId] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gm-identity?campaignId=${encodeURIComponent(campaignId)}`);
      const out = (await res.json().catch(() => ({}))) as LoadResult;
      if (!res.ok) {
        setError(out.error || "Could not load narrator link.");
        setIdentities([]);
        setMineId(null);
      } else {
        const list = out.identities || [];
        setIdentities(list);
        setMineId(out.mineId ?? null);
        const mine = list.find((i) => i.id === out.mineId) || null;
        setDiscordId(mine?.discord_user_id || "");
        setDisplayName(mine?.display_name || "");
      }
    } catch {
      setError("Could not load narrator link.");
    }
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/gm-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, discordUserId: discordId, displayName }),
      });
      const out = (await res.json().catch(() => ({}))) as SaveResult;
      if (!res.ok) setError(out.error || "Could not save the narrator link.");
      else {
        setNotice("Narrator voice linked.");
        await load();
      }
    } catch {
      setError("Could not save the narrator link.");
    }
    setSaving(false);
  }

  async function unlink(id: string) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/gm-identity?id=${encodeURIComponent(id)}&campaignId=${encodeURIComponent(campaignId)}`,
        { method: "DELETE" },
      );
      const out = (await res.json().catch(() => ({}))) as SaveResult;
      if (!res.ok) setError(out.error || "Could not unlink.");
      else {
        if (id === mineId) {
          setDiscordId("");
          setDisplayName("");
        }
        setNotice("Narrator voice unlinked.");
        await load();
      }
    } catch {
      setError("Could not unlink.");
    }
    setSaving(false);
  }

  if (!campaignId) return null;

  const box = { ...surfaces.slate, padding: 20, marginBottom: 18 } as const;
  const input = {
    display: "block",
    width: "100%",
    marginTop: 6,
    background: C.surface2,
    color: C.text,
    border: `1px solid ${C.line}`,
    borderRadius: 9,
    padding: "10px 12px",
    fontSize: 15,
  } as const;

  const linked = mineId !== null;
  const others = identities.filter((i) => i.id !== mineId);

  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Narrator voice</div>
        <span style={{ fontSize: 12, fontWeight: 700, color: linked ? C.good : C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.04em" }}>
          {linked ? "LINKED" : "NOT LINKED"}
        </span>
      </div>
      <div style={{ color: C.muted, fontSize: 13, marginBottom: 14 }}>
        Running /record links whoever starts the recording as narrator automatically, so your voice is captured as GM narration, not as a player. Use this card to set a different narrator, or on the upload path where there is no /record. The narrator&apos;s stream is routed to the GM extractor (lore, NPCs, rulings, plot hooks) instead of the disposition model.
      </div>

      <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>DISCORD USER ID</label>
      <input
        value={discordId}
        onChange={(e) => setDiscordId(e.target.value.trim())}
        placeholder="e.g. 1493069747766427731"
        inputMode="numeric"
        style={input}
      />
      <div style={{ color: C.muted, fontSize: 12, marginTop: 6, marginBottom: 12 }}>
        In Discord: Settings, then Advanced, and turn on Developer Mode. Then right-click your own name and choose Copy User ID.
      </div>

      <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>DISPLAY NAME (OPTIONAL)</label>
      <input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="the GM"
        style={{ ...input, marginBottom: 14 }}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          onClick={save}
          disabled={saving || loading || !discordId}
          style={{
            background: C.sun,
            color: SAX.inkDeep,
            border: "none",
            borderRadius: 9,
            padding: "10px 18px",
            fontWeight: 700,
            fontSize: 13,
            cursor: saving || !discordId ? "default" : "pointer",
            opacity: saving || !discordId ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : linked ? "Update" : "Link my voice"}
        </button>
        {linked && (
          <button
            type="button"
            onClick={() => mineId && unlink(mineId)}
            disabled={saving}
            style={{ background: "transparent", color: C.warn, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}
          >
            Unlink
          </button>
        )}
        {notice && <span style={{ fontSize: 12.5, color: C.good }}>{notice}</span>}
        {error && <span style={{ fontSize: 12.5, color: C.warn }}>{error}</span>}
      </div>

      {others.length > 0 && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Other narrators linked on this campaign:</div>
          <div style={{ display: "grid", gap: 6 }}>
            {others.map((id) => (
              <div key={id.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px" }}>
                <span style={{ fontSize: 13 }}>
                  {id.display_name || "narrator"}
                  <span style={{ color: C.muted, fontFamily: "ui-monospace, monospace" }}> · {id.discord_user_id}</span>
                </span>
                <button
                  type="button"
                  onClick={() => unlink(id.id)}
                  disabled={saving}
                  style={{ background: "transparent", color: C.muted, border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
