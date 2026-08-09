"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { stoneButton, C, FORGE_RADIUS } from "@/lib/forge-theme";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { Header } from "@/app/me/campaigns/page";

// The shared canon, across every campaign the player is in.
//
// codex_for_campaign() gates on owning a PC in the campaign, and resolves reveals
// against that PC, so a player sees exactly what their GM has made visible to them
// and nothing more. Same rules as the single-campaign /lore page; this one just
// fans out across the whole dossier.

type Item = { item_kind: string; item_type: string; id: string; title: string; body: string | null };

// Mirrors the GM's codex and the published page, so the same campaign reads the same way in all
// three places. An item_type nobody anticipated falls into Other rather than vanishing.
// Labels for the item_types the GM codex uses, so the same campaign reads the same way on both
// sides. A type not listed here keeps its own name rather than falling into a bucket - an
// unexpected category should be visible, not swept up.
const TYPE_LABEL: Record<string, string> = {
  location: "Locations",
  npc: "NPCs",
  faction: "Factions",
  item: "Items",
  lore: "Lore",
  note: "Notes",
  pc: "PCs",
};
// The order the GM codex presents them in.
const TYPE_ORDER = ["note", "location", "faction", "item", "lore", "npc", "pc"];

const labelFor = (t: string) => TYPE_LABEL[t] || (t.charAt(0).toUpperCase() + t.slice(1));
type Campaign = { campaign_id: string; campaign_name: string };


/**
 * A player's private note on one codex entry.
 *
 * PRIVATE, PERMANENTLY. There is no share control here because there is nothing in the schema to
 * share with: player_notes has no visibility column and one owner-only policy. That is deliberate,
 * and this component says so to the player rather than leaving them to infer it - somebody deciding
 * whether to write down a suspicion about another player's character needs to know before they type,
 * not after.
 *
 * SAVES ON BLUR, NOT ON EVERY KEYSTROKE. A note is a paragraph, not a chat message: debouncing every
 * character would fire a write per word for no benefit a player would notice.
 */
function NoteBox({ entryId, campaignId, supabase }: {
  entryId: string;
  campaignId: string;
  supabase: ReturnType<typeof createClient>;
}) {
  const [body, setBody] = useState("");
  const [state, setState] = useState<"loading" | "idle" | "saving" | "saved">("loading");

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await supabase
        .from("player_notes").select("body").eq("entry_id", entryId).maybeSingle();
      if (!live) return;
      setBody(((data as { body?: string } | null)?.body) || "");
      setState("idle");
    })();
    return () => { live = false; };
  }, [entryId, supabase]);

  const save = async () => {
    setState("saving");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setState("idle"); return; }
    // Upsert on the unique index, so editing the same note twice updates rather than duplicating.
    const { error } = await supabase.from("player_notes").upsert({
      profile_id: user.id, campaign_id: campaignId, entry_id: entryId, body,
    }, { onConflict: "profile_id,entry_id" });
    setState(error ? "idle" : "saved");
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}
      onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: SAX.mono, fontSize: 10, letterSpacing: "0.12em",
          textTransform: "uppercase", color: C.muted }}>
          Your note
        </span>
        <span style={{ fontFamily: SAX.mono, fontSize: 10, color: C.muted }}>
          {state === "saving" ? "saving" : state === "saved" ? "saved" : "only you can see this"}
        </span>
      </div>
      <textarea
        value={body}
        onChange={(e) => { setBody(e.target.value); setState("idle"); }}
        onBlur={() => { if (state === "idle") void save(); }}
        placeholder={state === "loading" ? "" : "What you made of this, what you suspect, what you want to come back to."}
        rows={3}
        style={{
          width: "100%", marginTop: 6, background: C.surface2, color: C.text,
          border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
          padding: "8px 10px", fontSize: 13.5, lineHeight: 1.55, resize: "vertical",
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}

export default function MyCodexPage() {
  const supabase = createClient();
  const [groups, setGroups] = useState<Array<{ campaign: Campaign; items: Item[] }>>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setStatus("empty"); return; }

      const { data: camps, error } = await supabase.rpc("my_campaigns");
      if (!active) return;
      if (error) { setStatus("error"); return; }

      const list = (camps as Campaign[]) || [];
      if (list.length === 0) { setStatus("empty"); return; }

      // One call per campaign. Fine at dossier scale (a player is in a handful of
      // campaigns, not hundreds), and it keeps the gate per-campaign where it
      // belongs rather than inventing a cross-campaign RPC that would have to
      // re-derive the same ownership check anyway.
      const results = await Promise.all(
        list.map(async (c) => {
          const { data } = await supabase.rpc("codex_for_campaign", { p_campaign: c.campaign_id });
          return { campaign: c, items: ((data as Item[]) || []) };
        }),
      );
      if (!active) return;

      const nonEmpty = results.filter((r) => r.items.length > 0);
      setGroups(nonEmpty);
      setStatus(nonEmpty.length ? "ready" : "empty");
    })();
    return () => { active = false; };
  }, [supabase]);

  return (
    <PageShell width={920}>
      <div style={{ width: "100%", maxWidth: 700, margin: "0 auto" }}>
        <Header title="Your codex" sub="WHAT YOU HAVE LEARNED" />

        {status === "loading" && <Muted>Loading&hellip;</Muted>}
        {status === "error" && <Muted>Something went wrong loading your codex. Please refresh.</Muted>}
        {status === "empty" && (
          <Muted>
            Nothing revealed yet. As your GM shares locations, lore, and the people
            you meet, they will gather here, campaign by campaign.
          </Muted>
        )}

        {status === "ready" && groups.map(({ campaign, items }) => (
          <CampaignCodex key={campaign.campaign_id}
            campaign={campaign} items={items}
            openId={openId} setOpenId={setOpenId} supabase={supabase} />
        ))}
      </div>
    </PageShell>
  );
}

/**
 * One campaign's codex, split into sub-tabs by entry type.
 *
 * WHY TABS AND NOT HEADED SECTIONS
 *   Headings gave the page structure but not navigation: a player still scrolled past the NPCs to
 *   reach the lore. The GM codex has had tabs since it was built, and a player looking at the same
 *   campaign should not have to work harder than the GM to find the same entry.
 *
 * TABS ARE BUILT FROM THE TYPES ACTUALLY PRESENT, not from a fixed list, so nobody sees an empty
 * Factions tab in a campaign that has no factions - and a type nobody anticipated gets its own tab
 * under its own name rather than being swept into Other.
 */
function CampaignCodex({ campaign, items, openId, setOpenId, supabase }: {
  campaign: { campaign_id: string; campaign_name: string };
  items: Item[];
  openId: string | null;
  setOpenId: (v: string | null) => void;
  supabase: ReturnType<typeof createClient>;
}) {
  const types = React.useMemo(() => {
    const present = Array.from(new Set(items.map((i) => i.item_type)));
    return present.sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }, [items]);

  const [tab, setTab] = useState<string>("");
  // Default to the first tab that exists, and re-pick if the current one empties out.
  const active = types.includes(tab) ? tab : (types[0] || "");
  const rows = items.filter((i) => i.item_type === active);

  return (
          <div style={{ marginBottom: 28 }}>
            <div style={{
              fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.18em",
              textTransform: "uppercase", color: C.muted, marginBottom: 10,
            }}>
              {campaign.campaign_name}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }} role="tablist">
              {types.map((t) => {
                const on = t === active;
                const n = items.filter((i) => i.item_type === t).length;
                return (
                  <button key={t} role="tab" aria-selected={on} onClick={() => setTab(t)}
                    style={{
                      ...stoneButton(on ? "primary" : "stone"),
                      fontSize: 12.5, padding: "7px 12px",
                      display: "flex", alignItems: "baseline", gap: 7,
                    }}>
                    {labelFor(t)}
                    <span style={{ fontFamily: SAX.mono, fontSize: 10.5, opacity: 0.66 }}>{n}</span>
                  </button>
                );
              })}
            </div>

            {rows.map((it) => {
              const open = openId === it.id;
              return (
                <div
                  key={it.id}
                  onClick={() => setOpenId(open ? null : it.id)}
                  style={{
                    background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
                    padding: "13px 16px", marginBottom: 9,
                    cursor: it.body ? "pointer" : "default",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <span style={{ color: C.text, fontSize: 15, fontWeight: 600 }}>{it.title}</span>
                    <span style={{
                      fontFamily: SAX.mono, fontSize: 10.5, letterSpacing: "0.1em",
                      textTransform: "uppercase", color: C.muted, flexShrink: 0,
                    }}>
                      {it.item_type}
                    </span>
                  </div>
                  {open && (
                    <NoteBox
                      entryId={it.id}
                      campaignId={campaign.campaign_id}
                      supabase={supabase}
                    />
                  )}
                  {it.body && (
                    <div style={{
                      color: C.muted, fontSize: 13.5, lineHeight: 1.6, marginTop: open ? 8 : 5,
                      display: "-webkit-box",
                      WebkitLineClamp: open ? "unset" : 2,
                      WebkitBoxOrient: "vertical" as const,
                      overflow: open ? "visible" : "hidden",
                    }}>
                      {it.body}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.65 }}>{children}</p>;
}
