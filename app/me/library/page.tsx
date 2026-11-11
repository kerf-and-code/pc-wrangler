"use client";

// app/me/library/page.tsx
//
// The stable's forge-room: a player's saved character builds (pc_library). Each build is portable
// and campaign-free until launched. From here a player can:
//   - Create a new character (opens the Forge in NEW mode: /me/forge with no params).
//   - Edit a build (opens the Forge in library mode: /me/forge?lib=<id>).
//   - Play in a campaign (INSTANTIATE a fresh characters row via instantiateToCampaign, then route
//     straight to that new character's sheet). A build can be launched into many campaigns; each is
//     an independent instance with its own sheet and its own per-table disposition.
//   - Delete a build.
//
// The "Play in campaign" dropdown lists the player's campaigns (my_campaigns) plus a "No campaign"
// option, which simply does nothing but is there so the control reads as "assign later, or not."
//
// Owner-scoped by RLS end to end. Dungeon aesthetic from lib/forge-theme.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { STONE, FORGE_FONTS, stonePanel, FORGE_BUTTON_CSS, stoneField, stoneChip, forgeHeading, forgeLabel, forgeRuleLine, forgeBoss } from "@/lib/forge-theme";
import {
  listLibrary, deleteFromLibrary, listMyCampaigns, instantiateToCampaign,
  type LibraryRow, type CampaignOption,
} from "@/lib/pc-library";
import Button from "@/components/ui-forge/Button";

const OPTION_STYLE: React.CSSProperties = { background: "#1a1611", color: "#f0e6d0" };

export default function LibraryPage() {
  const supabase = createClient();
  const router = useRouter();

  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error" | "signedout">("loading");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setStatus("signedout"); return; }
    try {
      const [libs, camps] = await Promise.all([listLibrary(supabase), listMyCampaigns(supabase)]);
      setRows(libs);
      setCampaigns(camps);
      setStatus(libs.length ? "ready" : "empty");
    } catch {
      setStatus("error");
    }
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const onDelete = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await deleteFromLibrary(supabase, id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch { /* leave the row; a transient error shouldn't wipe the list */ }
    setBusyId(null);
  }, [supabase]);

  const onPlay = useCallback(async (lib: LibraryRow, campaignId: string) => {
    if (!campaignId) return; // "No campaign": nothing to do
    setBusyId(lib.id);
    try {
      const newCharId = await instantiateToCampaign(supabase, lib, campaignId);
      router.push(`/me/forge?c=${newCharId}`);
    } catch {
      setBusyId(null);
    }
  }, [supabase, router]);

  return (
    <PageShell width={920}>
      <FontsAndCss />

          <Header />

          {status === "loading" && <Muted>Opening the armory&hellip;</Muted>}
          {status === "signedout" && <Muted>Sign in to see your saved characters.</Muted>}
          {status === "error" && <Muted>Something went wrong loading your library. Please refresh.</Muted>}

          {(status === "ready" || status === "empty") && (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 18 }}>
                <Button variant="primary"
                  onClick={() => router.push("/me/forge")}>
                  + New character
                </Button>
              </div>

              {status === "empty" && (
                <Muted>
                  No saved characters yet. Forge one and it will wait here, ready to bring to any table.
                </Muted>
              )}

              {status === "ready" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
                  {rows.map((r) => (
                    <LibraryCard
                      key={r.id} row={r} campaigns={campaigns} busy={busyId === r.id}
                      onEdit={() => router.push(`/me/forge?lib=${r.id}`)}
                      onDelete={() => onDelete(r.id)}
                      onPlay={(cid) => onPlay(r, cid)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
    </PageShell>
  );
}

function LibraryCard({ row, campaigns, busy, onEdit, onDelete, onPlay }: {
  row: LibraryRow; campaigns: CampaignOption[]; busy: boolean;
  onEdit: () => void; onDelete: () => void; onPlay: (campaignId: string) => void;
}) {
  const [target, setTarget] = useState("");
  const [confirming, setConfirming] = useState(false);

  const subtitle = useMemo(() => [
    row.level ? `Level ${row.level}` : null,
    row.species,
    row.subclass ? `${row.subclass} ${row.class ?? ""}`.trim() : row.class,
  ].filter(Boolean).join(" · ") || "No details yet", [row]);

  return (
    <div style={stonePanel()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: FORGE_FONTS.display, fontSize: 22, color: STONE.ink }}>{row.name}</div>
          <div style={{ color: STONE.inkDim, fontSize: 14, marginTop: 3 }}>{subtitle}</div>
        </div>
        <span style={stoneChip("moss")}>Library build</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        {/* Play in campaign */}
        <div style={{ flex: "1 1 240px", position: "relative" }}>
          <label style={forgeLabel}>Play in campaign</label>
          <select aria-label="Play in campaign" value={target} onChange={(e) => setTarget(e.target.value)} style={stoneField()} disabled={busy}>
            <option value="" style={OPTION_STYLE}>No campaign</option>
            {campaigns.map((c) => (
              <option key={c.campaign_id} value={c.campaign_id} style={OPTION_STYLE}>{c.campaign_name}</option>
            ))}
          </select>
        </div>
        <Button title={!target ? "Choose a campaign first" : undefined} style={{ opacity: target && !busy ? 1 : 0.5 }}
          disabled={!target || busy} onClick={() => onPlay(target)}>
          {busy ? "Launching…" : "Launch"}
        </Button>

        <span style={{ flex: 1 }} />

        <Button variant="ghost" style={{ padding: "10px 16px" }}
          disabled={busy} onClick={onEdit}>
          Edit
        </Button>

        {confirming ? (
          <>
            <Button variant="danger" style={{ padding: "10px 16px" }}
              disabled={busy} onClick={onDelete}>
              {busy ? "Deleting…" : "Confirm delete"}
            </Button>
            <Button variant="ghost" style={{ padding: "10px 16px" }}
              disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="ghost" style={{ padding: "10px 16px" }}
            disabled={busy} onClick={() => setConfirming(true)}>
            Delete
          </Button>
        )}
      </div>

      {campaigns.length === 0 && (
        <p style={{ color: STONE.inkFaint, fontSize: 13, marginTop: 10 }}>
          You&rsquo;re not in any campaigns yet. Join a table with your GM&rsquo;s invite, then launch this character into it.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function FontsAndCss() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap" rel="stylesheet" />
      <style>{FORGE_BUTTON_CSS}</style>
    </>
  );
}

function Header() {
  return (
    <header style={{ textAlign: "center", margin: "10px 0 6px" }}>
      <h1 style={{ ...forgeHeading, fontSize: 38, margin: 0 }}>CHARACTER LIBRARY</h1>
      <p style={{ color: STONE.inkDim, fontStyle: "italic", fontSize: 17, marginTop: 4 }}>
        builds not yet in a campaign, ready for any table
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "26px 0" }}>
        <span style={forgeRuleLine} />
        <span style={forgeBoss} />
        <span style={{ ...forgeRuleLine, transform: "scaleX(-1)" }} />
      </div>
    </header>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ textAlign: "center", color: STONE.inkDim, fontSize: 15, lineHeight: 1.65, marginTop: 30 }}>{children}</p>;
}
