"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { UpgradeAccount } from "@/components/upgrade-account";
import { Header } from "@/app/me/campaigns/page";

const C = { surface: SAX.slateBg, line: SAX.line, text: SAX.text, muted: SAX.muted, good: SAX.good, warn: SAX.warn, sun: SAX.sun };

// The personal thread tracker: open threads, favors owed, grudges, hooks.
//
// This is the H1 wedge from the roadmap, and the one feature that delivers value to
// a single player with zero buy-in from anyone else at their table. It needs no
// transcription, no GM, no session. It is purely theirs.
//
// Threads are owner-only at the database level (RLS on profile_id = auth.uid()), and
// a trigger stops you attaching one to a character you do not own.

type Thread = {
  id: string;
  campaign_id: string | null;
  character_id: string | null;
  title: string;
  detail: string | null;
  kind: string;
  status: string;
  created_at: string;
};

type Char = { character_id: string; name: string; campaign_id: string; campaign_name: string; kind: string };

const KINDS = [
  { key: "thread", label: "Thread" },
  { key: "quest", label: "Quest" },
  { key: "favor", label: "Favor" },
  { key: "grudge", label: "Grudge" },
  { key: "hook", label: "Hook" },
];

export default function MyThreadsPage() {
  const supabase = createClient();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [chars, setChars] = useState<Char[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // new-thread form
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [kind, setKind] = useState("thread");
  const [charId, setCharId] = useState("");

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setStatus("ready"); return; }

    const [{ data: t, error: tErr }, { data: c }] = await Promise.all([
      supabase.from("threads").select("*").order("created_at", { ascending: false }),
      supabase.rpc("my_characters"),
    ]);
    if (tErr) { setStatus("error"); return; }
    setThreads((t as Thread[]) || []);
    setChars((((c as Char[]) || []).filter((x) => x.kind === "pc")));
    setStatus("ready");
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function add() {
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    setError(null);

    const picked = chars.find((c) => c.character_id === charId);
    const { error: e } = await supabase.from("threads").insert({
      title: t,
      detail: detail.trim() || null,
      kind,
      status: "open",
      character_id: picked?.character_id ?? null,
      // Derived from the character, never chosen freely: a thread belongs to the
      // campaign its character is in.
      campaign_id: picked?.campaign_id ?? null,
    });
    setBusy(false);

    if (e) { setError("Could not save that thread. Try again."); return; }
    setTitle(""); setDetail(""); setKind("thread"); setCharId("");
    load();
  }

  async function setStatusOf(id: string, next: string) {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, status: next } : t)));
    const { error: e } = await supabase.from("threads").update({ status: next, updated_at: new Date().toISOString() }).eq("id", id);
    if (e) load(); // roll back to the truth
  }

  async function remove(id: string) {
    setThreads((prev) => prev.filter((t) => t.id !== id));
    const { error: e } = await supabase.from("threads").delete().eq("id", id);
    if (e) load();
  }

  const open = threads.filter((t) => t.status === "open");
  const closed = threads.filter((t) => t.status !== "open");
  const charName = (id: string | null) => chars.find((c) => c.character_id === id)?.name ?? null;

  return (
    <PageShell width={920}>
      <div style={{ width: "100%", maxWidth: 700, margin: "0 auto" }}>
        <Header title="Your threads" sub="WHAT YOU ARE STILL OWED" />

        <UpgradeAccount variant="card" next="/me/threads" />

        {/* new thread */}
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 22 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Who owes you what? What did you leave unfinished?"
            style={input()}
          />
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Any detail you want to remember (optional)"
            rows={2}
            style={{ ...input(), marginTop: 8, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...input(), width: "auto", flex: "0 0 auto" }}>
              {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <select value={charId} onChange={(e) => setCharId(e.target.value)} style={{ ...input(), width: "auto", flex: "1 1 180px" }}>
              <option value="">No character</option>
              {chars.map((c) => (
                <option key={c.character_id} value={c.character_id}>
                  {c.name} ({c.campaign_name})
                </option>
              ))}
            </select>
            <button type="button" onClick={add} disabled={busy || !title.trim()} style={btn(C.sun, SAX.inkDeep)}>
              {busy ? "Saving..." : "Add"}
            </button>
          </div>
          {error && <p style={{ color: C.warn, fontSize: 12.5, margin: "10px 0 0" }}>{error}</p>}
        </div>

        {status === "loading" && <Muted>Loading&hellip;</Muted>}
        {status === "error" && <Muted>Something went wrong loading your threads. Please refresh.</Muted>}

        {status === "ready" && open.length === 0 && closed.length === 0 && (
          <Muted>
            Nothing open. This is yours alone: the favors owed, the grudges, the
            hooks you never followed up. Nobody else sees it, not even your GM.
          </Muted>
        )}

        {open.map((t) => (
          <Row key={t.id} t={t} charName={charName(t.character_id)} onClose={() => setStatusOf(t.id, "resolved")} onDelete={() => remove(t.id)} />
        ))}

        {closed.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowClosed((v) => !v)}
              style={{
                background: "transparent", border: "none", color: C.muted, cursor: "pointer",
                fontFamily: SAX.mono, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
                padding: "12px 0", marginTop: 6,
              }}
            >
              {showClosed ? "Hide" : "Show"} {closed.length} resolved
            </button>
            {showClosed && closed.map((t) => (
              <Row key={t.id} t={t} charName={charName(t.character_id)} onReopen={() => setStatusOf(t.id, "open")} onDelete={() => remove(t.id)} />
            ))}
          </>
        )}
      </div>
    </PageShell>
  );
}

function Row({
  t, charName, onClose, onReopen, onDelete,
}: {
  t: Thread; charName: string | null;
  onClose?: () => void; onReopen?: () => void; onDelete: () => void;
}) {
  const resolved = t.status !== "open";
  return (
    <div style={{
      background: SAX.slateBg, border: `1px solid ${SAX.line}`, borderRadius: 12,
      padding: "13px 16px", marginBottom: 9, opacity: resolved ? 0.55 : 1,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <span style={{
            color: SAX.text, fontSize: 15, fontWeight: 600,
            textDecoration: resolved ? "line-through" : "none",
          }}>
            {t.title}
          </span>
          {t.detail && (
            <div style={{ color: SAX.muted, fontSize: 13, marginTop: 4, lineHeight: 1.55 }}>{t.detail}</div>
          )}
          <div style={{
            fontFamily: SAX.mono, fontSize: 10.5, letterSpacing: "0.1em",
            textTransform: "uppercase", color: SAX.muted, marginTop: 7,
          }}>
            {t.kind}{charName ? ` · ${charName}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {onClose && <IconBtn onClick={onClose} title="Mark resolved">{"\u2713"}</IconBtn>}
          {onReopen && <IconBtn onClick={onReopen} title="Reopen">{"\u21BA"}</IconBtn>}
          <IconBtn onClick={onDelete} title="Delete">{"\u00D7"}</IconBtn>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} title={title}
      style={{
        background: "transparent", border: `1px solid ${SAX.line}`, color: SAX.muted,
        borderRadius: 7, width: 28, height: 28, cursor: "pointer", fontSize: 13, lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

function input(): React.CSSProperties {
  return {
    width: "100%", background: SAX.panelBg, color: SAX.text,
    border: `1px solid ${SAX.line}`, borderRadius: 8,
    padding: "9px 12px", fontSize: 14, fontFamily: "inherit",
  };
}

function btn(bg: string, fg: string): React.CSSProperties {
  return {
    background: bg, color: fg, border: `1px solid ${bg}`, borderRadius: 8,
    padding: "9px 16px", fontSize: 13, fontWeight: 700,
    fontFamily: SAX.mono, letterSpacing: "0.04em", cursor: "pointer",
  };
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ textAlign: "center", color: SAX.muted, fontSize: 14, lineHeight: 1.65 }}>{children}</p>;
}
