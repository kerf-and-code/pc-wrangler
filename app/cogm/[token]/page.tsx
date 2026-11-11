"use client";

// app/cogm/[token]/page.tsx (2026-11-10, push 18)
//
// Where a co-GM invite link lands (p149). Shows which campaign and whose it is, then accepts on a
// click (accept_gm_invite) and goes to the Workspace on that campaign. Lives outside /gm on purpose: the
// /gm gate would turn away someone who is not a GM yet, which is everyone opening this link. A logged-
// out visitor sees a sign-in prompt (the page is on the proxy allowlist so the token is not lost to the
// login redirect). The token is the only key; the RPCs check it, its expiry and single use.
// useParams needs a Suspense boundary under cacheComponents (see app/x/[code]/page.tsx).

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { friendlyError } from "@/lib/friendly-error";

type Preview = { campaign_id: string; campaign_name: string; owner_name: string; state: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "22px 24px", display: "grid", gap: 14, maxWidth: 560 } as const;
const btn = { background: C.brass, color: C.ink, border: "none", borderRadius: FORGE_RADIUS, padding: "11px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", minHeight: "var(--sax-tap, 0px)" } as const;

const STATE_TEXT: Record<string, string> = {
  used: "This invite has already been used. Ask the GM for a new link.",
  cancelled: "The GM cancelled this invite. Ask them for a new link if you still need one.",
  expired: "This invite has expired. Invite links work for 7 days; ask the GM for a new one.",
};

export default function CoGmInvitePage() {
  return (
    <Suspense fallback={<PageShell width={640}><p style={{ color: C.muted }}>Loading the invite...</p></PageShell>}>
      <CoGmInvite />
    </Suspense>
  );
}

function CoGmInvite() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [phase, setPhase] = useState<"loading" | "signin" | "guest" | "missing" | "ready">("loading");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!UUID.test(token)) { setPhase("missing"); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!live) return;
      if (!user) { setPhase("signin"); return; }
      if (user.is_anonymous) { setPhase("guest"); return; }
      const { data, error } = await supabase.rpc("gm_invite_preview", { p_token: token });
      if (!live) return;
      if (error) { setErr(friendlyError(error)); setPhase("missing"); return; }
      const row = ((data as Preview[]) ?? [])[0] ?? null;
      if (!row) { setPhase("missing"); return; }
      setPreview(row);
      setPhase("ready");
    })();
    return () => { live = false; };
  }, [supabase, token]);

  function openWorkspace(campaignId: string) {
    router.push(`/gm?campaign=${encodeURIComponent(campaignId)}`);
  }

  async function accept() {
    if (!preview) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("accept_gm_invite", { p_token: token });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    openWorkspace(String(data ?? preview.campaign_id));
  }

  return (
    <PageShell width={640}>
      <h1 style={{ fontSize: 24, margin: "8px 0 18px", color: C.vellum }}>Co-GM invite</h1>
      <div style={card}>
        {phase === "loading" && <p style={{ margin: 0, color: C.muted }}>Checking the invite...</p>}
        {phase === "missing" && (
          <p style={{ margin: 0, color: C.text, lineHeight: 1.6 }}>
            {err || "This invite link is not valid. Check that the whole link was copied, or ask the GM for a new one."}
          </p>
        )}
        {phase === "signin" && (
          <>
            <p style={{ margin: 0, color: C.text, lineHeight: 1.6 }}>
              Sign in with your own account to accept this invite, then open this link again.
            </p>
            <div><a href="/auth/login" style={{ ...btn, display: "inline-block", textDecoration: "none" }}>Sign in</a></div>
          </>
        )}
        {phase === "guest" && (
          <p style={{ margin: 0, color: C.text, lineHeight: 1.6 }}>
            You are signed in as a guest. A co-GM needs their own account: <a href="/auth/sign-up">create one</a> or <a href="/auth/login">sign in</a>, then open this link again.
          </p>
        )}
        {phase === "ready" && preview && (
          <>
            <p style={{ margin: 0, color: C.text, lineHeight: 1.6 }}>
              <strong style={{ color: C.vellum }}>{preview.owner_name}</strong> invited you to co-GM <strong style={{ color: C.vellum }}>{preview.campaign_name}</strong>.
            </p>
            {preview.state === "open" && (
              <>
                <p style={{ margin: 0, color: C.muted, fontSize: 13.5, lineHeight: 1.6 }}>
                  As co-GM you can run sessions, recaps, the codex, maps and the table for this campaign. The owner keeps
                  deleting it, handing it over, and choosing who else is a GM.
                </p>
                <div><button type="button" style={btn} onClick={accept} disabled={busy}>{busy ? "Joining..." : `Co-GM ${preview.campaign_name}`}</button></div>
              </>
            )}
            {(preview.state === "already" || preview.state === "owner") && (
              <>
                <p style={{ margin: 0, color: C.muted, fontSize: 13.5 }}>
                  {preview.state === "owner" ? "This is your own campaign." : "You already co-GM this campaign."}
                </p>
                <div><button type="button" style={btn} onClick={() => openWorkspace(preview.campaign_id)}>Open the Workspace</button></div>
              </>
            )}
            {STATE_TEXT[preview.state] && <p style={{ margin: 0, color: C.text, fontSize: 13.5 }}>{STATE_TEXT[preview.state]}</p>}
          </>
        )}
        {err && phase === "ready" && <p role="alert" style={{ margin: 0, color: C.warn, fontSize: 13.5 }}>{err}</p>}
      </div>
    </PageShell>
  );
}
