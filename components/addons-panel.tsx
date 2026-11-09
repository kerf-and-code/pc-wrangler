"use client";

import React, { useCallback, useEffect, useState } from "react";
import { C } from "@/lib/forge-theme";
import type { createClient } from "@/lib/supabase/client";

// components/addons-panel.tsx (2026-11-09)
//
// Phase 6b (p131): the GM's Add-ons tab at the table.
//   Keys      for programs that use /api/addon/v1 (a Discord bot, a stream overlay, a script): what each
//             may do (read, chat, roll), when it was last used, revoke. A new key is shown once.
//   Webhooks  addresses the table's events are sent to as they happen (rolls, chat, turns, fights
//             starting and ending), signed with the hook's secret: on or off, what it gets, how the last
//             delivery went, send a test.
//   A short reference for whoever writes the add-on.

type Supa = ReturnType<typeof createClient>;
type Key = { id: string; name: string; prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null };
type Hook = { id: string; name: string; url: string; secret: string; events: string[]; include_secret: boolean; enabled: boolean; fail_count: number; last_status: number | null; last_error: string | null; last_attempt_at: string | null; last_ok_at: string | null };

const SCOPE_LABEL: Record<string, string> = { read: "Read chat and the turn order", chat: "Post to chat", roll: "Roll dice" };
const EVENT_LABEL: Record<string, string> = { roll: "Rolls", chat: "Chat (not whispers)", turn: "Whose turn it is", combat: "Fights starting and ending" };

const small: React.CSSProperties = { padding: "5px 9px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" };
const primary: React.CSSProperties = { ...small, background: C.sun, color: "#1b1712", border: "none", fontWeight: 600 };
const field: React.CSSProperties = { padding: "5px 7px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, boxSizing: "border-box", width: "100%" };
const head: React.CSSProperties = { fontWeight: 600, fontSize: 13, margin: "16px 0 6px" };
const box: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 9, padding: 8, marginBottom: 8 };
const code: React.CSSProperties = { display: "block", whiteSpace: "pre", overflowX: "auto", background: "rgba(0,0,0,0.35)", border: `1px solid ${C.line}`, borderRadius: 7, padding: 8, fontSize: 11.5, fontFamily: "ui-monospace, Menlo, Consolas, monospace", color: C.text };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

async function post(path: string, body: unknown, method = "POST") {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return res.ok ? { ok: true as const, j } : { ok: false as const, error: (j.error as string) || `Failed (${res.status}).` };
}

export default function AddonsPanel({ campaignId, supabase, onHooksChanged }: { campaignId: string; supabase: Supa; onHooksChanged: () => void }) {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [keyName, setKeyName] = useState("");
  const [keyScopes, setKeyScopes] = useState<string[]>(["read"]);
  const [makingKey, setMakingKey] = useState(false);
  const [makingHook, setMakingHook] = useState(false);
  const [showRef, setShowRef] = useState(false);

  const load = useCallback(async () => {
    const [k, h] = await Promise.all([
      supabase.from("addon_keys").select("id, name, prefix, scopes, created_at, last_used_at, revoked_at").eq("campaign_id", campaignId).order("created_at"),
      supabase.from("addon_hooks").select("*").eq("campaign_id", campaignId).order("created_at"),
    ]);
    const e = k.error ?? h.error;
    if (e) { setErr(/addon_/.test(e.message) ? "Add-ons are not set up yet (the p131 migration)." : e.message); return; }
    setKeys((k.data ?? []) as Key[]); setHooks((h.data ?? []) as Hook[]);
  }, [supabase, campaignId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (job: () => PromiseLike<{ error: { message: string } | null }>, hooksChanged = false) => {
    setBusy(true); setErr(null);
    const { error } = await job();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await load();
    if (hooksChanged) onHooksChanged();
  };

  const makeKey = async () => {
    setBusy(true); setErr(null);
    const r = await post("/api/addon/keys", { campaignId, name: keyName, scopes: keyScopes });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setFresh({ name: keyName.trim(), token: r.j.token as string });
    setMakingKey(false); setKeyName(""); setKeyScopes(["read"]);
    await load();
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (err && keys === null) return <div style={{ padding: 12, color: C.muted, fontSize: 13 }}>{err}</div>;
  if (keys === null || hooks === null) return <div style={{ padding: 12, color: C.muted, fontSize: 13 }}>Loading add-ons...</div>;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 12, fontSize: 12.5, color: C.text }}>
      <p style={{ color: C.muted, margin: 0 }}>Connect other programs to this table: a Discord bot that posts rolls, a stream overlay, your own scripts. Keys let them talk to the table; webhooks tell them what happens here.</p>
      {err && <p role="status" style={{ color: "#e07a70", margin: "8px 0 0" }}>{err}</p>}

      <div style={head}>Keys</div>
      {fresh && (
        <div style={{ ...box, borderColor: C.sun }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Your key for {fresh.name}</div>
          <p style={{ color: C.muted, margin: "0 0 6px" }}>Copy it now: it is not shown again. Anyone with it can do what you allowed, so keep it out of public code.</p>
          <code style={{ ...code, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{fresh.token}</code>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(fresh.token)} style={primary}>Copy</button>
            <button type="button" onClick={() => setFresh(null)} style={small}>I have saved it</button>
          </div>
        </div>
      )}
      {keys.length === 0 && !fresh && <p style={{ color: C.muted, margin: 0 }}>No keys yet.</p>}
      {keys.map((k) => (
        <div key={k.id} style={{ ...box, opacity: k.revoked_at ? 0.6 : 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <strong style={{ flex: 1 }}>{k.name}</strong>
            <code style={{ fontSize: 11, color: C.muted }}>{k.prefix}...</code>
          </div>
          <div style={{ color: C.muted, fontSize: 11.5, margin: "3px 0 6px" }}>
            {k.scopes.map((s) => SCOPE_LABEL[s] ?? s).join(", ")}. {k.revoked_at ? `Revoked ${when(k.revoked_at)}.` : `Last used ${when(k.last_used_at)}.`}
          </div>
          {k.revoked_at
            ? <button type="button" disabled={busy} onClick={() => void act(() => supabase.from("addon_keys").delete().eq("id", k.id))} style={small}>Remove</button>
            : <button type="button" disabled={busy} onClick={() => void act(() => supabase.from("addon_keys").update({ revoked_at: new Date().toISOString() }).eq("id", k.id))} style={{ ...small, color: "#e07a70" }}>Revoke</button>}
        </div>
      ))}
      {makingKey ? (
        <div style={box}>
          <label htmlFor="key-name" style={{ display: "block", color: C.muted, fontSize: 11.5, marginBottom: 4 }}>Name (what it is for)</label>
          <input id="key-name" value={keyName} maxLength={40} onChange={(e) => setKeyName(e.target.value)} placeholder="Discord bot" style={field} />
          <div role="group" aria-label="What the key may do" style={{ marginTop: 8 }}>
            {Object.entries(SCOPE_LABEL).map(([s, label]) => (
              <label key={s} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
                <input type="checkbox" checked={keyScopes.includes(s)} onChange={(e) => setKeyScopes(e.target.checked ? [...keyScopes, s] : keyScopes.filter((x) => x !== s))} style={{ accentColor: C.sun }} />{label}
              </label>
            ))}
          </div>
          <p style={{ color: C.muted, fontSize: 11.5, margin: "6px 0 0" }}>Lines it posts show as from the add-on, marked &quot;via {keyName.trim() || "its name"}&quot;.</p>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="button" disabled={busy || !keyName.trim() || !keyScopes.length} onClick={() => void makeKey()} style={primary}>Make the key</button>
            <button type="button" onClick={() => setMakingKey(false)} style={small}>Cancel</button>
          </div>
        </div>
      ) : <button type="button" onClick={() => setMakingKey(true)} style={small}>New key</button>}

      <div style={head}>Webhooks</div>
      {hooks.length === 0 && <p style={{ color: C.muted, margin: 0 }}>No webhooks yet.</p>}
      {hooks.map((h) => <HookRow key={h.id} hook={h} supabase={supabase} busy={busy} act={act} onReload={load} />)}
      {makingHook
        ? <NewHook campaignId={campaignId} onDone={async () => { setMakingHook(false); await load(); onHooksChanged(); }} onCancel={() => setMakingHook(false)} />
        : <button type="button" onClick={() => setMakingHook(true)} style={small}>New webhook</button>}

      <div style={head}>
        <button type="button" aria-expanded={showRef} onClick={() => setShowRef(!showRef)} style={{ ...small, border: "none", padding: 0, fontWeight: 600, fontSize: 13 }}>{showRef ? "Hide" : "Show"} the reference for add-on authors</button>
      </div>
      {showRef && (
        <div style={{ color: C.muted, lineHeight: 1.5 }}>
          <p style={{ margin: "0 0 6px" }}>Send the key as a header on every call. 60 calls a minute per key.</p>
          <code style={code}>{`curl ${origin}/api/addon/v1 \\
  -H "Authorization: Bearer sxa_..."`}</code>
          <p style={{ margin: "8px 0 4px" }}>The calls (the key needs the scope in brackets):</p>
          <code style={code}>{`GET  /api/addon/v1                 this campaign and key
GET  /api/addon/v1/chat?since=ISO  chat and rolls, oldest first  [read]
     add &secret=1 for your secret rolls too
GET  /api/addon/v1/combat          round and turn order, no HP   [read]
POST /api/addon/v1/chat  {"text":"...","kind":"say|emote","as":"Name"}      [chat]
POST /api/addon/v1/roll  {"notation":"1d20+5","label":"Attack","secret":false} [roll]`}</code>
          <p style={{ margin: "8px 0 4px" }}>Webhooks POST JSON like this, within seconds of it happening:</p>
          <code style={code}>{`{ "id": "dlv_123", "type": "roll",
  "campaign": { "id": "...", "name": "..." },
  "createdAt": "...",
  "data": { "who": "Bobert", "text": "Attack", "secret": false, "addon": null,
            "roll": { "label": "Attack", "notation": "1d20+5", "total": 19, "natural": 14, "dice": [...] } } }`}</code>
          <p style={{ margin: "8px 0 4px" }}>Types: roll, chat, turn ({`{ round, current: { name, kind } }`}), combat ({`{ state: "started" | "ended", name }`}), ping. Lines posted by an add-on carry its name in data.addon, so a bot can skip its own. Answer with any 2xx within 5 seconds; failures are retried 5 times over about 15 minutes.</p>
          <p style={{ margin: "8px 0 4px" }}>Check the X-SixAxes-Signature header (t=time,v1=signature) with the webhook&apos;s secret before trusting a delivery:</p>
          <code style={code}>{`const [t, v1] = header.split(",").map(p => p.split("=")[1]);
const want = crypto.createHmac("sha256", secret)
  .update(t + "." + rawBody).digest("hex");
// accept when want === v1 and t is within 5 minutes of now`}</code>
        </div>
      )}
    </div>
  );
}

function HookRow({ hook: h, supabase, busy, act, onReload }: {
  hook: Hook; supabase: Supa; busy: boolean;
  act: (job: () => PromiseLike<{ error: { message: string } | null }>, hooksChanged?: boolean) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [url, setUrl] = useState(h.url);
  const status = !h.enabled
    ? (h.fail_count >= 25 ? "Switched off after failing 25 times in a row." : "Off.")
    : h.last_attempt_at === null ? "Nothing sent yet."
    : h.last_error ? `Last try ${when(h.last_attempt_at)} failed: ${h.last_error}${h.fail_count > 1 ? ` (${h.fail_count} in a row)` : ""}`
    : `Working. Last delivered ${when(h.last_ok_at)}.`;
  const test = async () => {
    setTesting(true); setNote(null);
    const r = await post("/api/addon/hooks/test", { hookId: h.id });
    setTesting(false);
    if (!r.ok) { setNote(r.error); return; }
    const after = r.j.hook as { last_error: string | null; last_status: number | null } | null;
    setNote(after?.last_error ? `The test failed: ${after.last_error}` : `The test arrived (answered ${after?.last_status ?? "ok"}).`);
    await onReload();
  };
  const saveUrl = async () => {
    const r = await post("/api/addon/hooks", { hookId: h.id, url }, "PATCH");
    if (!r.ok) { setNote(r.error); setUrl(h.url); return; }
    setNote("Address saved."); await onReload();
  };
  const setEvents = (events: string[]) => events.length ? act(() => supabase.from("addon_hooks").update({ events, updated_at: new Date().toISOString() }).eq("id", h.id)) : Promise.resolve();

  return (
    <div style={{ ...box, opacity: h.enabled ? 1 : 0.75 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <strong style={{ flex: 1 }}>{h.name}</strong>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={h.enabled} disabled={busy}
            onChange={(e) => void act(() => supabase.from("addon_hooks").update({ enabled: e.target.checked, fail_count: 0, updated_at: new Date().toISOString() }).eq("id", h.id), true)}
            style={{ accentColor: C.sun }} />On
        </label>
      </div>
      <input aria-label={`Address for ${h.name}`} value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => { if (url.trim() !== h.url) void saveUrl(); }} style={{ ...field, marginTop: 6, fontSize: 11.5 }} />
      <div role="group" aria-label="What it gets" style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", marginTop: 6 }}>
        {Object.entries(EVENT_LABEL).map(([ev, label]) => (
          <label key={ev} style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <input type="checkbox" checked={h.events.includes(ev)} disabled={busy} onChange={(e) => void setEvents(e.target.checked ? [...h.events, ev] : h.events.filter((x) => x !== ev))} style={{ accentColor: C.sun }} />{label}
          </label>
        ))}
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={h.include_secret} disabled={busy} onChange={(e) => void act(() => supabase.from("addon_hooks").update({ include_secret: e.target.checked, updated_at: new Date().toISOString() }).eq("id", h.id))} style={{ accentColor: C.sun }} />Your secret rolls too
        </label>
      </div>
      <div style={{ color: h.last_error || !h.enabled ? "#d98a3a" : C.muted, fontSize: 11.5, marginTop: 6 }}>{status}</div>
      {showSecret && <code style={{ ...code, marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{h.secret}</code>}
      {note && <p role="status" style={{ color: C.muted, margin: "6px 0 0" }}>{note}</p>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" disabled={testing || !h.enabled} onClick={() => void test()} style={small}>{testing ? "Sending..." : "Send a test"}</button>
        <button type="button" onClick={() => setShowSecret(!showSecret)} style={small}>{showSecret ? "Hide the secret" : "Show the signing secret"}</button>
        {showSecret && <button type="button" onClick={() => void navigator.clipboard?.writeText(h.secret)} style={small}>Copy</button>}
        {confirmDel
          ? <button type="button" disabled={busy} onClick={() => void act(() => supabase.from("addon_hooks").delete().eq("id", h.id), true)} style={{ ...small, background: "#e07a70", color: "#1b1712", border: "none", marginLeft: "auto" }}>Delete {h.name}</button>
          : <button type="button" onClick={() => setConfirmDel(true)} style={{ ...small, color: "#e07a70", marginLeft: "auto" }}>Delete</button>}
      </div>
    </div>
  );
}

function NewHook({ campaignId, onDone, onCancel }: { campaignId: string; onDone: () => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://");
  const [events, setEvents] = useState<string[]>(["roll"]);
  const [secretRolls, setSecretRolls] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    const r = await post("/api/addon/hooks", { campaignId, name, url, events, includeSecret: secretRolls });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    await onDone();
  };
  return (
    <div style={box}>
      <label htmlFor="hook-name" style={{ display: "block", color: C.muted, fontSize: 11.5, marginBottom: 4 }}>Name</label>
      <input id="hook-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Discord rolls channel" style={field} />
      <label htmlFor="hook-url" style={{ display: "block", color: C.muted, fontSize: 11.5, margin: "8px 0 4px" }}>Address (https)</label>
      <input id="hook-url" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} style={field} />
      <div role="group" aria-label="What it gets" style={{ marginTop: 8 }}>
        {Object.entries(EVENT_LABEL).map(([ev, label]) => (
          <label key={ev} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
            <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))} style={{ accentColor: C.sun }} />{label}
          </label>
        ))}
        <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
          <input type="checkbox" checked={secretRolls} onChange={(e) => setSecretRolls(e.target.checked)} style={{ accentColor: C.sun }} />Your secret rolls too
        </label>
      </div>
      {err && <p role="status" style={{ color: "#e07a70", margin: "6px 0 0" }}>{err}</p>}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button type="button" disabled={busy || !name.trim() || !events.length} onClick={() => void save()} style={primary}>{busy ? "Checking the address..." : "Add the webhook"}</button>
        <button type="button" onClick={onCancel} style={small}>Cancel</button>
      </div>
    </div>
  );
}
