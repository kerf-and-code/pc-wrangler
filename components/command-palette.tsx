"use client";

// components/command-palette.tsx
//
// Ctrl+K (Cmd+K on a Mac) anywhere on the GM side: jump to a page, find a Codex entry, NPC, player
// character or session in the active campaign, look something up in the Compendium, or jot a quick
// GM-only note or NPC mid-session without leaving the page you are on.
//
// Mounted once by the GM navigation. The campaign's Codex rows load on first open (and again when the
// active campaign changes), so the palette costs nothing until it is used. Writes mirror the Codex
// page's own inserts (entries with type note, characters with kind npc), always at visibility gm.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SAX } from "@/lib/theme";
import { STONE, FORGE_FONTS } from "@/lib/forge-theme";
import { createClient } from "@/lib/supabase/client";
import { getActiveCampaign, onActiveCampaignChange } from "@/lib/active-campaign";
import { gmHref } from "@/lib/campaign-context";

export type PalettePage = { href: string; label: string; group: string };

type Item = {
  key: string;
  kind: "page" | "entry" | "npc" | "pc" | "session" | "action";
  label: string;
  sub?: string;
  href?: string;
  run?: () => Promise<void>;
};

/** Other components can open the palette with window.dispatchEvent(new Event(OPEN_PALETTE)). */
export const OPEN_PALETTE = "sax:open-palette";

const KIND_LABEL: Record<Item["kind"], string> = { page: "Page", entry: "Codex", npc: "NPC", pc: "PC", session: "Session", action: "" };

function score(text: string, q: string): number {
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.split(/[\s(/-]+/).some((w) => w.startsWith(q))) return 60;
  if (t.includes(q)) return 40;
  return 0;
}

export default function CommandPalette({ pages }: { pages: PalettePage[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [campaign, setCampaign] = useState<{ id: string; name?: string } | null>(null);
  const [rows, setRows] = useState<Item[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = () => { const c = getActiveCampaign(); setCampaign(c ? { id: c.id, name: c.name } : null); };
    read();
    return onActiveCampaignChange(read);
  }, []);

  // Keyboard shortcut and the open event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE, onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_PALETTE, onOpen); };
  }, []);

  useEffect(() => {
    if (!open) return;
    // Remember what had focus (the Find button, or wherever Ctrl+K was pressed) and hand it back on close.
    const opener = document.activeElement as HTMLElement | null;
    setQ(""); setSel(0); setErr(null);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => { window.clearTimeout(t); if (opener && opener !== document.body) opener.focus?.(); };
  }, [open]);

  // Load the campaign's searchable rows on first open per campaign.
  useEffect(() => {
    if (!open || !campaign || loadedFor === campaign.id) return;
    const cid = campaign.id;
    let off = false;
    (async () => {
      const [{ data: e }, { data: c }, { data: s }] = await Promise.all([
        supabase.from("entries").select("id, type, title, tags").eq("campaign_id", cid).order("title"),
        supabase.from("characters").select("id, name, kind, active").eq("campaign_id", cid).in("kind", ["npc", "pc"]).order("name"),
        supabase.from("sessions").select("id, session_number, status, scheduled_at").eq("campaign_id", cid).order("session_number", { ascending: false }),
      ]);
      if (off) return;
      const out: Item[] = [];
      for (const r of (e as { id: string; type: string; title: string; tags: string[] | null }[]) || []) {
        const tag = (r.tags || []).find((t) => t === "faction" || t === "item");
        out.push({ key: `e:${r.id}`, kind: "entry", label: r.title, sub: tag || r.type, href: gmHref("/gm/codex", { campaign: cid, entry: r.id }) });
      }
      for (const r of (c as { id: string; name: string; kind: string; active: boolean | null }[]) || []) {
        // A PC removed from the party is history, not someone to jump to.
        if (r.kind === "pc" && r.active === false) continue;
        out.push({ key: `c:${r.id}`, kind: r.kind === "pc" ? "pc" : "npc", label: r.name, href: gmHref("/gm/codex", { campaign: cid, character: r.id }) });
      }
      for (const r of (s as { id: string; session_number: number | null; status: string | null; scheduled_at: string | null }[]) || []) {
        out.push({ key: `s:${r.id}`, kind: "session", label: `Session ${r.session_number ?? "?"}`, sub: r.status || undefined, href: gmHref("/gm/sessions", { campaign: cid, session: r.id }) });
      }
      setRows(out);
      setLoadedFor(cid);
    })();
    return () => { off = true; };
  }, [open, campaign, loadedFor, supabase]);

  const quickCreate = useCallback(async (what: "note" | "npc", text: string) => {
    if (!campaign) return;
    setBusy(true); setErr(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(false); setErr("Sign in first."); return; }
    if (what === "note") {
      const { data, error } = await supabase.from("entries")
        .insert({ campaign_id: campaign.id, type: "note", title: text, body: "", summary: "", visibility: "gm", tags: [] })
        .select("id").single();
      setBusy(false);
      if (error || !data) { setErr(error?.message || "Could not save the note."); return; }
      window.location.href = gmHref("/gm/codex", { campaign: campaign.id, entry: (data as { id: string }).id });
    } else {
      const { data, error } = await supabase.from("characters")
        .insert({ campaign_id: campaign.id, kind: "npc", name: text, description: "", visibility: "gm", tags: [] })
        .select("id").single();
      setBusy(false);
      if (error || !data) { setErr(error?.message || "Could not save the NPC."); return; }
      window.location.href = gmHref("/gm/codex", { campaign: campaign.id, character: (data as { id: string }).id });
    }
  }, [campaign, supabase]);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const pageItems: Item[] = pages.map((p) => ({ key: `p:${p.href}`, kind: "page", label: p.label, sub: p.group, href: p.href }));
    if (!needle) return pageItems.slice(0, 12);
    // Pages get a small lead over Codex rows, but only once they match: adding it before the filter
    // let every page through, so typing "review" listed all of them.
    const ranked = [...pageItems.map((i) => { const m = score(i.label, needle); return { i, s: m > 0 ? m + 5 : 0 }; }), ...rows.map((i) => ({ i, s: score(i.label, needle) }))]
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i.label.localeCompare(b.i.label))
      .slice(0, 30)
      .map((x) => x.i);
    const text = q.trim();
    const actions: Item[] = [
      { key: "a:compendium", kind: "action", label: `Look up “${text}” in the Compendium`, href: `/gm/compendium?q=${encodeURIComponent(text)}` },
    ];
    if (campaign) {
      actions.push(
        { key: "a:note", kind: "action", label: `New GM note: “${text}”`, sub: campaign.name, run: () => quickCreate("note", text) },
        { key: "a:npc", kind: "action", label: `New NPC: “${text}”`, sub: campaign.name, run: () => quickCreate("npc", text) },
      );
    }
    return [...ranked, ...actions];
  }, [q, pages, rows, campaign, quickCreate]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (it: Item | undefined) => {
    if (!it || busy) return;
    if (it.run) { void it.run(); return; }
    if (it.href) window.location.href = it.href;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    // The list is driven by the arrow keys, so Tab has nowhere useful to go: keep focus in the field
    // rather than letting it escape behind the dialog.
    else if (e.key === "Tab") { e.preventDefault(); inputRef.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[sel]); }
  };

  if (!open) return null;

  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.55)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "12vh 16px 16px" }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}
        style={{ width: "100%", maxWidth: 600, background: STONE.shadow, border: `1px solid ${STONE.hi}`, borderRadius: 12, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", overflow: "hidden", fontFamily: FORGE_FONTS.body }}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search pages, Codex, NPCs and sessions"
          placeholder={campaign ? `Search pages, Codex, NPCs, sessions in ${campaign.name || "this campaign"}…` : "Search pages…"}
          role="combobox" aria-expanded="true" aria-controls="sax-palette-list" aria-activedescendant={items[sel] ? `sax-pal-${sel}` : undefined}
          style={{ width: "100%", boxSizing: "border-box", background: "transparent", border: "none", borderBottom: `1px solid ${STONE.hi}`, color: STONE.ink, fontSize: 16, padding: "14px 16px", outline: "none" }} />
        {err && <div role="alert" style={{ color: "#e08a7a", fontSize: 13, padding: "8px 16px" }}>{err}</div>}
        <div ref={listRef} id="sax-palette-list" role="listbox" style={{ maxHeight: "50vh", overflowY: "auto", padding: 6 }}>
          {items.length === 0 && <div style={{ color: STONE.inkDim, fontSize: 13.5, padding: "10px 12px" }}>Nothing matches.</div>}
          {items.map((it, idx) => {
            const on = idx === sel;
            return (
              <div key={it.key} id={`sax-pal-${idx}`} data-idx={idx} role="option" aria-selected={on}
                onMouseMove={() => { if (sel !== idx) setSel(idx); }} onClick={() => choose(it)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, cursor: "pointer", background: on ? "rgba(200,162,75,0.14)" : "transparent" }}>
                {it.kind !== "action"
                  ? <span style={{ fontFamily: SAX.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: STONE.inkDim, minWidth: 58 }}>{KIND_LABEL[it.kind]}</span>
                  : <span aria-hidden="true" style={{ minWidth: 58, color: SAX.brass, fontSize: 13 }}>{"→"}</span>}
                <span style={{ color: on ? STONE.ink : STONE.ink, fontSize: 14, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                {it.sub && <span style={{ color: STONE.inkDim, fontSize: 12 }}>{it.sub}</span>}
              </div>
            );
          })}
        </div>
        <div style={{ borderTop: `1px solid ${STONE.hi}`, padding: "7px 14px", color: STONE.inkDim, fontSize: 11.5, fontFamily: SAX.mono, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span>{"↑↓"} move</span><span>Enter open</span><span>Esc close</span>
          {busy && <span style={{ color: SAX.brass }}>Saving…</span>}
        </div>
      </div>
    </div>
  );
}
