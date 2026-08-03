"use client";

// app/gm/publish/page.tsx
//
// Turns a campaign codex into a public, readable page - and decides, item by item, what goes on it.
//
// WHY THIS IS ITS OWN SCREEN RATHER THAN A TOGGLE ON THE CODEX
//   Publishing is a disclosure, not a display preference. The codex holds things said at a table and
//   details of other people's characters, so the decision deserves a screen where the whole set is
//   visible at once and the consequence is stated plainly. A checkbox tucked into an editor invites
//   publishing something by reflex while thinking about something else.
//
// THE TWO SWITCHES ARE INDEPENDENT ON PURPOSE
//   Nothing is readable unless the campaign is published AND the item is marked public. That means
//   a GM can mark up the whole codex over a week with nothing exposed, then publish in one act - and
//   can unpublish instantly without losing the per-item decisions they made.

import { useCallback, useEffect, useMemo, useState } from "react";
import PageShell from "@/components/page-shell";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS, STONE } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";

type Campaign = {
  id: string; name: string;
  public_slug: string | null; public_published_at: string | null; public_blurb: string | null;
  public_listed: boolean;
};
type Item = {
  key: string; kind: "entry" | "npc"; id: string;
  title: string; type: string; visibility: string | null; is_public: boolean;
};

const TYPE_LABEL: Record<string, string> = {
  location: "Places", lore: "Lore", note: "Notes", npc: "The cast",
};

export default function PublishPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [blurb, setBlurb] = useState("");
  const [listed, setListed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const campaign = campaigns.find((c) => c.id === campaignId) ?? null;
  const published = Boolean(campaign?.public_published_at);
  const publicCount = items.filter((i) => i.is_public).length;

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("campaigns")
        .select("id, name, public_slug, public_published_at, public_blurb, public_listed")
        .eq("gm_id", user.id).order("name");
      const rows = (data as Campaign[]) ?? [];
      setCampaigns(rows);
      if (rows.length === 1) setCampaignId(rows[0].id);
    })();
  }, [supabase]);

  const loadItems = useCallback(async (cid: string) => {
    const [{ data: entries }, { data: npcs }] = await Promise.all([
      supabase.from("entries").select("id, title, type, visibility, is_public")
        .eq("campaign_id", cid).order("type").order("title"),
      supabase.from("characters").select("id, name, visibility, is_public")
        .eq("campaign_id", cid).eq("kind", "npc").order("name"),
    ]);
    const e = ((entries as { id: string; title: string; type: string; visibility: string | null; is_public: boolean }[]) ?? [])
      .map<Item>((r) => ({ key: `e:${r.id}`, kind: "entry", id: r.id, title: r.title, type: r.type, visibility: r.visibility, is_public: r.is_public }));
    const n = ((npcs as { id: string; name: string; visibility: string | null; is_public: boolean }[]) ?? [])
      .map<Item>((r) => ({ key: `n:${r.id}`, kind: "npc", id: r.id, title: r.name, type: "npc", visibility: r.visibility, is_public: r.is_public }));
    setItems([...e, ...n]);
  }, [supabase]);

  useEffect(() => {
    if (!campaignId) { setItems([]); setBlurb(""); return; }
    const c = campaigns.find((x) => x.id === campaignId);
    setBlurb(c?.public_blurb ?? "");
    setListed(Boolean(c?.public_listed));
    void loadItems(campaignId);
  }, [campaignId, campaigns, loadItems]);

  const setPublic = useCallback(async (it: Item, next: boolean) => {
    setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, is_public: next } : x)));
    const table = it.kind === "entry" ? "entries" : "characters";
    const { error } = await supabase.from(table).update({ is_public: next }).eq("id", it.id);
    if (error) {
      setNote(`Could not change "${it.title}": ${error.message}`);
      setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, is_public: !next } : x)));
    }
  }, [supabase]);

  // A campaign with two hundred entries is not going to be reviewed one checkbox at a time, and a
  // GM who cannot do it in one move will publish nothing. This selects what the PARTY can already
  // see, which is the honest starting point: it has been shown to players and is not a GM secret.
  // It stops at 'gm' visibility, deliberately - that is the tier holding the things nobody has
  // found yet, and a bulk action must never reach it.
  const selectPartyVisible = useCallback(async () => {
    setBusy(true); setNote(null);
    try {
      const want = items.filter((i) => i.visibility === "common" || i.visibility === "player");
      await Promise.all([
        supabase.from("entries").update({ is_public: true })
          .eq("campaign_id", campaignId).in("visibility", ["common", "player"]),
        supabase.from("characters").update({ is_public: true })
          .eq("campaign_id", campaignId).eq("kind", "npc").in("visibility", ["common", "player"]),
      ]);
      await loadItems(campaignId);
      setNote(`Marked ${want.length} item(s) public. Nothing marked GM-only was touched.`);
    } finally { setBusy(false); }
  }, [items, campaignId, supabase, loadItems]);

  const clearAll = useCallback(async () => {
    setBusy(true); setNote(null);
    try {
      await Promise.all([
        supabase.from("entries").update({ is_public: false }).eq("campaign_id", campaignId),
        supabase.from("characters").update({ is_public: false }).eq("campaign_id", campaignId).eq("kind", "npc"),
      ]);
      await loadItems(campaignId);
      setNote("Everything is now private again.");
    } finally { setBusy(false); }
  }, [campaignId, supabase, loadItems]);

  const setListing = useCallback(async (next: boolean) => {
    if (!campaign) return;
    setListed(next);
    const { error } = await supabase.from("campaigns").update({ public_listed: next }).eq("id", campaign.id);
    if (error) { setNote(`Could not change that: ${error.message}`); setListed(!next); return; }
    setCampaigns((cs) => cs.map((c) => (c.id === campaign.id ? { ...c, public_listed: next } : c)));
  }, [campaign, supabase]);

  const togglePublished = useCallback(async () => {
    if (!campaign) return;
    setBusy(true); setNote(null);
    try {
      let slug = campaign.public_slug;
      if (!published && !slug) {
        // Minted server-side: the function checks the caller is this campaign's GM, which a client
        // update could not enforce.
        const { data, error } = await supabase.rpc("mint_public_slug", { p_campaign: campaign.id });
        if (error) { setNote(`Could not create the public address: ${error.message}`); return; }
        slug = data as string;
      }
      const { error } = await supabase.from("campaigns")
        .update({ public_published_at: published ? null : new Date().toISOString(), public_blurb: blurb || null })
        .eq("id", campaign.id);
      if (error) { setNote(`Could not save: ${error.message}`); return; }
      setCampaigns((cs) => cs.map((c) => c.id === campaign.id
        ? { ...c, public_slug: slug, public_published_at: published ? null : new Date().toISOString(), public_blurb: blurb || null }
        : c));
      setNote(published ? "Unpublished. The public page is gone." : "Published.");
    } finally { setBusy(false); }
  }, [campaign, published, blurb, supabase]);

  const url = campaign?.public_slug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/c/${campaign.public_slug}`
    : null;

  const groups = ["location", "npc", "lore", "note"]
    .map((t) => ({ type: t, rows: items.filter((i) => i.type === t) }))
    .filter((g) => g.rows.length);

  return (
    <PageShell width={780}>
      <h1 style={{ fontFamily: SAX.serif, fontSize: 30, margin: "4px 0 2px", color: C.text }}>
        Publish your codex
      </h1>
      <p style={{ color: C.muted, fontSize: 14, marginTop: 0, marginBottom: 18, lineHeight: 1.6 }}>
        Put your campaign&apos;s places, cast and lore on a page anyone can read, without an account.
        Nothing goes public until you both publish the campaign and choose what appears on it.
      </p>

      <Card>
        <Label>Campaign</Label>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={field}>
          <option value="">Pick a campaign</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Card>

      {campaign && (
        <>
          <Card tone={published ? "good" : undefined}>
            <Label>{published ? "Live" : "Not published"}</Label>
            <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} rows={2}
              placeholder="A line about the campaign, shown at the top of the page."
              style={{ ...field, marginBottom: 10, resize: "vertical" }} />
            {published && url && (
              <p style={{ ...body, marginBottom: 10 }}>
                <a href={url} target="_blank" rel="noreferrer" style={{ color: C.plum, fontFamily: SAX.mono, fontSize: 13 }}>{url}</a>
              </p>
            )}
            <button onClick={() => void togglePublished()} disabled={busy} style={btn(!published)}>
              {published ? "Unpublish" : "Publish this campaign"}
            </button>
            <p style={{ ...body, marginTop: 10, marginBottom: 0 }}>
              {published
                ? `${publicCount} item${publicCount === 1 ? "" : "s"} are readable at that address. Unpublishing hides the page immediately and keeps every choice below.`
                : "Publishing creates a public web address. It is separate from your players' link, so sharing it never lets a reader claim a character."}
            </p>
          </Card>

          <Card>
            <Label>Being found</Label>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", marginBottom: 10 }}>
              <input type="checkbox" checked={listed} disabled={busy}
                onChange={(e) => void setListing(e.target.checked)} style={{ marginTop: 3 }} />
              <span style={{ color: C.text, fontSize: 14, lineHeight: 1.5 }}>
                Let search engines index this page.
              </span>
            </label>
            <p style={{ ...body, marginBottom: 0 }}>
              {listed
                ? "This campaign will appear in the site map and search results. Worth knowing: a page that has been indexed can linger in results and caches after you unpublish it, in a way a shared link does not."
                : "Off by default. The page is still readable by anyone you give the link to and it just asks search engines to stay away, which stays reversible in a way indexing does not."}
            </p>
          </Card>

          <Card>
            <Label>What appears</Label>
            <p style={body}>
              {publicCount} of {items.length} chosen.
              {published ? "" : " Nothing is visible yet, because the campaign is not published."}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <button onClick={() => void selectPartyVisible()} disabled={busy} style={btn(false)}>
                Choose everything the party can see
              </button>
              <button onClick={() => void clearAll()} disabled={busy} style={btn(false)}>
                Clear all
              </button>
            </div>
            <p style={{ ...body, marginTop: 8, marginBottom: 0, fontSize: 12.5 }}>
              The first button never touches anything marked GM-only. That is where the things your
              players have not found yet live, and a bulk action should not be able to reach it.
            </p>
          </Card>

          {groups.map((g) => (
            <Card key={g.type}>
              <Label>{TYPE_LABEL[g.type] ?? g.type}</Label>
              {g.rows.map((it) => (
                <label key={it.key} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "7px 0",
                  borderTop: `1px solid ${C.line}`, cursor: "pointer",
                }}>
                  <input type="checkbox" checked={it.is_public}
                    onChange={(e) => void setPublic(it, e.target.checked)} />
                  <span style={{ color: C.text, fontSize: 14, flex: 1 }}>{it.title}</span>
                  {it.visibility === "gm" && (
                    <span style={{ fontFamily: SAX.mono, fontSize: 10, color: C.warn,
                      letterSpacing: "0.1em", textTransform: "uppercase" }}>GM only</span>
                  )}
                </label>
              ))}
            </Card>
          ))}

          {note && <Card tone="warn"><p style={{ ...body, marginBottom: 0 }}>{note}</p></Card>}
        </>
      )}
    </PageShell>
  );
}

function Card({ children, tone }: { children: React.ReactNode; tone?: "warn" | "good" }) {
  return (
    <section style={{
      background: "linear-gradient(160deg, rgba(52,47,39,0.80) 0%, rgba(38,34,28,0.85) 45%, rgba(22,19,15,0.90) 100%)",
      borderRadius: FORGE_RADIUS, padding: "14px 16px", marginBottom: 14,
      borderLeft: tone === "warn" ? `3px solid ${C.warn}` : tone === "good" ? `3px solid ${C.good}` : undefined,
      boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.5)",
    }}>{children}</section>
  );
}
const Label = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily: SAX.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase",
    color: C.muted, marginBottom: 8 }}>{children}</div>
);
const body: React.CSSProperties = { color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 10px" };
const field: React.CSSProperties = { width: "100%", padding: "10px 12px", fontSize: 15, fontFamily: SAX.serif };
const btn = (primary: boolean): React.CSSProperties => ({
  background: primary ? C.sun : "transparent",
  color: primary ? C.ink : C.text,
  border: primary ? "none" : `1px solid ${C.line}`,
  borderRadius: FORGE_RADIUS, padding: "10px 18px",
  fontFamily: SAX.mono, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
});
