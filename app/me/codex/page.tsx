"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { stoneButton, C, FORGE_RADIUS } from "@/lib/forge-theme";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { Header } from "@/app/me/campaigns/page";
import { type Block } from "@/app/gm/codex/BlockEditor";

// The shared canon, across every campaign the player is in.
//
// codex_for_campaign() gates on owning a PC in the campaign and resolves reveals against that PC, so a
// player sees exactly what their GM has made visible to them and nothing more. Since p82 it returns the
// same rich fields the GM and the public wiki show for a revealed entry (summary, blocks, tags, image),
// so this page renders the FULL entry - blocks and images, not just plain text - splits lore into
// Factions / Items / Lore by tag exactly like the wiki, and offers a search across everything revealed.

type Item = {
  item_kind: string;
  item_type: string;
  id: string;
  title: string;
  summary: string | null;
  body: string | null;
  blocks: Block[] | null;
  tags: string[] | null;
  image_url: string | null;
};
type Campaign = { campaign_id: string; campaign_name: string };

// Labels + order mirror the GM codex and the public wiki, so the same campaign reads the same way in
// all three places. A type nobody anticipated keeps its own name rather than vanishing into a bucket.
const TYPE_LABEL: Record<string, string> = {
  location: "Locations", npc: "NPCs", faction: "Factions", item: "Items",
  lore: "Lore", note: "Notes", pc: "PCs",
};
const TYPE_ORDER = ["note", "location", "faction", "item", "lore", "npc", "pc"];
const labelFor = (t: string) => TYPE_LABEL[t] || (t.charAt(0).toUpperCase() + t.slice(1));

// Reserved tags split the raw 'lore' type into three tabs, the same rule the wiki and GM codex use:
// a lore item tagged 'faction' is a Faction, 'item' is an Item, otherwise it is Lore. Everything else
// keys on its own item_type.
function sectionKey(it: Item): string {
  if (it.item_type === "lore") {
    const tags = it.tags || [];
    if (tags.includes("faction")) return "faction";
    if (tags.includes("item")) return "item";
    return "lore";
  }
  return it.item_type;
}

const orderOf = (k: string) => {
  const i = TYPE_ORDER.indexOf(k);
  return i < 0 ? 99 : i;
};

// Everything a card can be matched against in search: title, summary, body, tags, and the text inside
// any blocks (so a detail a player only wrote into a block is still findable).
function haystack(it: Item): string {
  const blockText = (it.blocks || [])
    .map((b) => (b.type === "image" ? b.caption : b.text))
    .join(" ");
  return `${it.title} ${it.summary || ""} ${it.body || ""} ${(it.tags || []).join(" ")} ${blockText}`.toLowerCase();
}

export default function MyCodexPage() {
  const supabase = useMemo(() => createClient(), []);
  const [groups, setGroups] = useState<Array<{ campaign: Campaign; items: Item[] }>>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");

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

  const query = q.trim().toLowerCase();
  const searchGroups = useMemo(() => {
    if (!query) return [];
    return groups
      .map((g) => ({ campaign: g.campaign, items: g.items.filter((it) => haystack(it).includes(query)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);
  const searchCount = searchGroups.reduce((n, g) => n + g.items.length, 0);

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

        {status === "ready" && (
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search everything you have learned…"
              style={{
                boxSizing: "border-box", width: "100%", marginBottom: 18,
                background: C.surface2, color: C.text, border: `1px solid ${C.line}`,
                borderRadius: FORGE_RADIUS, padding: "11px 14px", fontSize: 14.5, outline: "none",
              }}
            />

            {query ? (
              searchCount === 0 ? (
                <Muted>Nothing matches &ldquo;{q.trim()}&rdquo; in what you have learned.</Muted>
              ) : (
                <>
                  <div style={{ ...eyebrow, marginBottom: 12 }}>
                    {searchCount} match{searchCount === 1 ? "" : "es"}
                  </div>
                  {searchGroups.map(({ campaign, items }) => (
                    <div key={campaign.campaign_id} style={{ marginBottom: 24 }}>
                      <div style={{ ...eyebrow, marginBottom: 10 }}>{campaign.campaign_name}</div>
                      {items.map((it) => (
                        <EntryCard key={it.id} item={it} campaignId={campaign.campaign_id}
                          open={openId === it.id} onToggle={() => setOpenId(openId === it.id ? null : it.id)}
                          supabase={supabase} showType />
                      ))}
                    </div>
                  ))}
                </>
              )
            ) : (
              groups.map(({ campaign, items }) => (
                <CampaignCodex key={campaign.campaign_id}
                  campaign={campaign} items={items}
                  openId={openId} setOpenId={setOpenId} supabase={supabase} />
              ))
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}

/**
 * One campaign's codex, split into sub-tabs. Tabs are built from the SECTIONS actually present (lore
 * split into Factions / Items / Lore by tag), so nobody sees an empty tab, and the order matches the GM
 * codex and the wiki.
 */
function CampaignCodex({ campaign, items, openId, setOpenId, supabase }: {
  campaign: Campaign;
  items: Item[];
  openId: string | null;
  setOpenId: (v: string | null) => void;
  supabase: ReturnType<typeof createClient>;
}) {
  const sections = useMemo(() => {
    const present = Array.from(new Set(items.map(sectionKey)));
    return present.sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b));
  }, [items]);

  const [tab, setTab] = useState<string>("");
  const active = sections.includes(tab) ? tab : (sections[0] || "");
  const rows = items.filter((i) => sectionKey(i) === active);

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ ...eyebrow, marginBottom: 10 }}>{campaign.campaign_name}</div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }} role="tablist">
        {sections.map((s) => {
          const on = s === active;
          const n = items.filter((i) => sectionKey(i) === s).length;
          return (
            <button key={s} role="tab" aria-selected={on} onClick={() => setTab(s)}
              style={{ ...stoneButton(on ? "primary" : "stone"), fontSize: 12.5, padding: "7px 12px", display: "flex", alignItems: "baseline", gap: 7 }}>
              {labelFor(s)}
              <span style={{ fontFamily: SAX.mono, fontSize: 10.5, opacity: 0.66 }}>{n}</span>
            </button>
          );
        })}
      </div>

      {rows.map((it) => (
        <EntryCard key={it.id} item={it} campaignId={campaign.campaign_id}
          open={openId === it.id} onToggle={() => setOpenId(openId === it.id ? null : it.id)}
          supabase={supabase} />
      ))}
    </div>
  );
}

/**
 * One codex entry, collapsed to a title (with a thumbnail if it has an image) and expanded to the full
 * page: summary, hero image, and blocks if the entry has them, otherwise its plain body. A player note
 * hangs off the bottom, private to the reader.
 */
function EntryCard({ item, campaignId, open, onToggle, supabase, showType }: {
  item: Item;
  campaignId: string;
  open: boolean;
  onToggle: () => void;
  supabase: ReturnType<typeof createClient>;
  showType?: boolean;
}) {
  const hasMore = Boolean(item.body || item.summary || (item.blocks && item.blocks.length) || item.image_url);
  return (
    <div
      onClick={onToggle}
      style={{
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
        padding: "13px 16px", marginBottom: 9, cursor: hasMore ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {item.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image_url} alt="" loading="lazy"
            style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", border: `1px solid ${C.line}`, flexShrink: 0 }} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <span style={{ color: C.text, fontSize: 15, fontWeight: 600 }}>{item.title}</span>
            <span style={{ fontFamily: SAX.mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, flexShrink: 0 }}>
              {showType ? labelFor(sectionKey(item)) : item.item_type}
            </span>
          </div>

          {!open && (item.summary || item.body) && (
            <div style={{
              color: C.muted, fontSize: 13.5, lineHeight: 1.6, marginTop: 5,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden",
            }}>
              {item.summary || item.body}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          {item.summary && (
            <div style={{ color: C.text, fontStyle: "italic", fontSize: 14.5, lineHeight: 1.6, marginBottom: 10 }}>
              {item.summary}
            </div>
          )}
          {item.blocks && item.blocks.length ? (
            <BlocksView blocks={item.blocks} />
          ) : item.body ? (
            <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{item.body}</div>
          ) : null}
          <NoteBox entryId={item.id} campaignId={campaignId} supabase={supabase} />
        </div>
      )}
    </div>
  );
}

/**
 * Read-only render of an entry's blocks, the same content the GM built and the public wiki shows. The
 * codex column is narrow, so blocks stack full width (the half-width side-by-side layout is a wiki-page
 * nicety, not needed to read the same content here).
 */
function BlocksView({ blocks }: { blocks: Block[] }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {blocks.map((b) => {
        if (b.type === "header") {
          return <div key={b.id} style={{ fontFamily: SAX.serif, fontSize: 16, fontWeight: 700, color: C.text }}>{b.text}</div>;
        }
        if (b.type === "text") {
          return <div key={b.id} style={{ color: C.muted, fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{b.text}</div>;
        }
        return (
          <figure key={b.id} style={{ margin: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.url} alt={b.caption} style={{ display: "block", maxWidth: "100%", borderRadius: 8, border: `1px solid ${C.line}` }} />
            {b.caption && <figcaption style={{ fontSize: 12.5, color: C.muted, fontStyle: "italic", marginTop: 6 }}>{b.caption}</figcaption>}
          </figure>
        );
      })}
    </div>
  );
}

/**
 * A player's private note on one codex entry. PRIVATE, PERMANENTLY: player_notes has no visibility
 * column and one owner-only policy, and this says so before the player types. Saves on blur.
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
    const { error } = await supabase.from("player_notes").upsert({
      profile_id: user.id, campaign_id: campaignId, entry_id: entryId, body,
    }, { onConflict: "profile_id,entry_id" });
    setState(error ? "idle" : "saved");
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}
      onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: SAX.mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted }}>
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
          padding: "8px 10px", fontSize: 13.5, lineHeight: 1.55, resize: "vertical", fontFamily: "inherit",
        }}
      />
    </div>
  );
}

const eyebrow: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.muted,
};

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.65 }}>{children}</p>;
}
