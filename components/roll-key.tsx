"use client";

// components/roll-key.tsx (audit B12, push 7)
//
// Roll keys prove who is sending rolls (lib/vtt/ingest-keys.ts). Two places hand one out:
//
//   <RollKeyForExtension code>  on the table link page (/x/<code>). One press makes a key and hands it
//                               straight to the Six Axes Capture extension, which keeps it for this
//                               table. Nothing to copy. Needs extension 2.3 or later.
//   <RollKeyForCopy>            on the Foundry page. The GM types the table code, makes a key and pastes
//                               it into the module's settings.
//
// Without a key rolls still arrive, but as unverified.

import { useCallback, useEffect, useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

type Info = { role: "gm" | "player" | null; campaign_name: string; has_key: boolean; created_at: string | null };

async function readInfo(code: string): Promise<{ info: Info | null; signedOut: boolean; error: string | null }> {
  try {
    const res = await fetch(`/api/vtt/key?share_code=${encodeURIComponent(code)}`, { cache: "no-store" });
    if (res.status === 401) return { info: null, signedOut: true, error: null };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { info: null, signedOut: false, error: data.error || "Could not check this table." };
    return { info: data as Info, signedOut: false, error: null };
  } catch {
    return { info: null, signedOut: false, error: "Could not reach Six Axes. Check your connection." };
  }
}

async function makeKey(code: string): Promise<{ key: string | null; error: string | null }> {
  try {
    const res = await fetch("/api/vtt/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share_code: code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data.key !== "string") return { key: null, error: data.error || "Could not make a key. Try again." };
    return { key: data.key, error: null };
  } catch {
    return { key: null, error: "Could not reach Six Axes. Check your connection." };
  }
}

const box: React.CSSProperties = {
  background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 16, marginTop: 16,
};
const btn: React.CSSProperties = {
  marginTop: 10, padding: "10px 14px", border: "none", borderRadius: FORGE_RADIUS, background: C.brass,
  color: C.ink, fontWeight: 700, fontSize: 14, cursor: "pointer", minHeight: 44,
};
const note: React.CSSProperties = { color: C.muted, fontSize: 13.5, lineHeight: 1.5, marginTop: 6 };

/** On /x/<code>: make a key and give it to the extension. extensionVersion is what link-capture reported. */
export function RollKeyForExtension({ code, extensionVersion }: { code: string; extensionVersion: string | null }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const r = await readInfo(code);
    setInfo(r.info); setSignedOut(r.signedOut); setError(r.error);
  }, [code]);

  useEffect(() => { if (code) void load(); }, [code, load]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== window) return;
      const d = e.data as { __sixaxesKeySaved?: boolean; ok?: boolean; code?: string };
      if (!d || d.__sixaxesKeySaved !== true || d.code !== code) return;
      if (waiting.current) { clearTimeout(waiting.current); waiting.current = null; }
      setBusy(false);
      if (d.ok) { setDone(true); setError(null); void load(); }
      else setError("The extension could not save the key. Reopen this link and try again.");
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (waiting.current) clearTimeout(waiting.current);
    };
  }, [code, load]);

  async function connect() {
    setBusy(true); setError(null);
    const r = await makeKey(code);
    if (!r.key) { setBusy(false); setError(r.error); return; }
    window.postMessage({ __sixaxesKey: true, code, key: r.key }, window.location.origin);
    waiting.current = setTimeout(() => {
      setBusy(false);
      setError("The extension did not answer. Update Six Axes Capture to version 2.3 or later, then reopen this link.");
    }, 3000);
  }

  if (!code) return null;

  return (
    <div style={box}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>Verify your rolls</div>
      {signedOut ? (
        <div style={note}>
          Rolls sent with only the table code count as unverified. <a href="/auth/login" style={{ color: C.sun }}>Sign in</a>,
          then reopen this link to connect the extension to you.
        </div>
      ) : info && info.role === null ? (
        <div style={note}>
          This account has no character in {info.campaign_name} yet. Ask your GM to add yours, then reopen this link.
        </div>
      ) : info ? (
        <>
          <div role="status" aria-live="polite" style={note}>
            {done
              ? "Done. Rolls from this browser now count as verified for your characters."
              : info.has_key
                ? "This table already has a key for you. Connect again if you switched browsers or reinstalled the extension."
                : "Connect the extension to your account so your rolls count as verified, not just as rolls from someone with the link."}
          </div>
          {extensionVersion === null ? (
            <div style={note}>Install Six Axes Capture first (step 2 below), then reopen this link.</div>
          ) : extensionVersion === "old" ? (
            <div style={note}>Your Six Axes Capture is an older version. Update it to 2.3 or later to connect it to you.</div>
          ) : (
            <button type="button" style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={connect}>
              {busy ? "Connecting..." : info.has_key ? "Connect again" : "Connect the extension to me"}
            </button>
          )}
        </>
      ) : null}
      {error && <div role="alert" style={{ ...note, color: C.warn }}>{error}</div>}
    </div>
  );
}

/** On /foundry: make a key to paste into the module. */
export function RollKeyForCopy() {
  const [code, setCode] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function go() {
    const c = code.trim().toLowerCase();
    if (!c) { setError("Enter your table code first."); return; }
    setBusy(true); setError(null); setKey(null); setCopied(false);
    const info = await readInfo(c);
    if (info.signedOut) { setBusy(false); setError("Sign in to Six Axes as the GM first, then come back to this page."); return; }
    if (info.error) { setBusy(false); setError(info.error); return; }
    const r = await makeKey(c);
    setBusy(false);
    if (!r.key) { setError(r.error); return; }
    setKey(r.key);
  }

  async function copy() {
    if (!key) return;
    try { await navigator.clipboard.writeText(key); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <div style={box}>
      <label htmlFor="roll-key-code" style={{ fontWeight: 700, fontSize: 15 }}>Table code</label>
      <input
        id="roll-key-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="off"
        style={{
          display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: 10, fontSize: 16,
          borderRadius: FORGE_RADIUS, border: `1px solid ${C.line}`, background: "rgba(0,0,0,0.32)", color: C.text,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        }}
      />
      <button type="button" style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={go}>
        {busy ? "Making a key..." : "Make a roll key"}
      </button>
      {key && (
        <>
          <div style={{ ...note, color: C.text }}>
            Paste this into <strong>Roll key</strong> in the module settings. It is shown once; making another
            one retires this one.
          </div>
          <div style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 14, background: "rgba(0,0,0,0.32)",
            color: C.accent, border: `1px solid ${C.line}`, padding: "10px 12px", borderRadius: FORGE_RADIUS, marginTop: 8, wordBreak: "break-all",
          }}>{key}</div>
          <button type="button" style={btn} onClick={copy}>{copied ? "Copied" : "Copy key"}</button>
        </>
      )}
      {error && <div role="alert" style={{ ...note, color: C.warn }}>{error}</div>}
    </div>
  );
}
