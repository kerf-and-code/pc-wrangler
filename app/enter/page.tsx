"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";
import { createClient } from "@/lib/supabase/client";

// The way into the GM tools during the pilot. The marketing nav's Sign in lands here, and the proxy
// sends a signed-in account without GM access here from /gm.
//
// Push 41.5 (2026-11-12): there is no access code any more. GM access comes from GM_EMAILS (an
// allowlist of emails in the server environment, lib/gm-allowlist.ts) or from the owner console. This
// page asks /api/gate where the account stands: a GM (or co-GM) goes straight on to the Workspace; a
// visitor is offered sign-in; anyone else is told plainly that GM access is by invitation, with the way
// to ask for it and the way to their own tables as a player.

type Status =
  | { kind: "checking" }
  | { kind: "signed-out" }
  | { kind: "not-gm"; email: string | null; anonymous: boolean }
  | { kind: "error"; message: string };

export default function EnterGate() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<Status>({ kind: "checking" });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/gate", { method: "POST" });
        const d = await res.json().catch(() => null) as
          | { signedIn: boolean; gm: boolean; coGm?: boolean; anonymous?: boolean; email?: string | null; error?: string }
          | null;
        if (!active) return;
        if (!d) { setStatus({ kind: "error", message: "Could not check your access. Reload the page to try again." }); return; }
        if (d.error) { setStatus({ kind: "error", message: d.error }); return; }
        if (!d.signedIn) { setStatus({ kind: "signed-out" }); return; }
        if (d.gm || d.coGm) { router.replace("/gm"); router.refresh(); return; }
        setStatus({ kind: "not-gm", email: d.email ?? null, anonymous: !!d.anonymous });
      } catch {
        if (active) setStatus({ kind: "error", message: "Could not check your access. Reload the page to try again." });
      }
    })();
    return () => { active = false; };
  }, [router]);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/auth/login";
  }

  const btn = (primary: boolean): CSSProperties => ({
    display: "block", width: "100%", padding: 12, fontSize: 15, fontWeight: 600, textAlign: "center", textDecoration: "none",
    background: primary ? C.sun : "transparent", color: primary ? "#1b1712" : C.text,
    border: primary ? "none" : `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, cursor: "pointer", marginTop: 10,
  });
  const p: CSSProperties = { color: C.muted, fontSize: 15, lineHeight: 1.6, margin: "0 0 14px" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.surface, padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 400, textAlign: "center" }}>
        <h1 style={{ fontFamily: SAX.serif, fontSize: 26, fontWeight: 700, color: C.text, margin: "0 0 10px" }}>Six Axes</h1>

        {status.kind === "checking" && <p style={p} role="status">Checking your access...</p>}

        {status.kind === "error" && <p style={{ ...p, color: C.warn }} role="alert">{status.message}</p>}

        {status.kind === "signed-out" && (
          <>
            <p style={p}>Sign in to open your campaigns. GMs in the pilot are let in by the email they were invited with.</p>
            <Link href="/auth/login" style={btn(true)}>Sign in</Link>
            <Link href="/pilot" style={btn(false)}>Apply to run a table in the pilot</Link>
            <p style={{ ...p, fontSize: 13, marginTop: 16 }}>Playing at someone&apos;s table? Use the invite link your GM sent, or run /mypage in their Discord server.</p>
          </>
        )}

        {status.kind === "not-gm" && (
          <>
            <p style={p}>
              {status.anonymous || !status.email
                ? "You are signed in without an email address, so this account cannot be given GM access."
                : <>You are signed in as <b style={{ color: C.text }}>{status.email}</b>, which is not on the pilot&apos;s list of GMs.</>}
            </p>
            <p style={p}>GM access is by invitation during the pilot. If you were invited with a different email, sign out and sign in with that one.</p>
            <Link href="/me/campaigns" style={btn(true)}>Go to your tables as a player</Link>
            <Link href="/pilot?from=player" style={btn(false)}>Ask for GM access</Link>
            <button type="button" onClick={() => void signOut()} style={btn(false)}>Sign out and use another account</button>
          </>
        )}
      </div>
    </div>
  );
}
