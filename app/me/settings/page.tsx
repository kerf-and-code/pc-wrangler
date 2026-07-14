"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { UpgradeAccount } from "@/components/upgrade-account";
import { Header } from "@/app/me/campaigns/page";

const C = { surface: SAX.slateBg, line: SAX.line, text: SAX.text, muted: SAX.muted, good: SAX.good, warn: SAX.warn, sun: SAX.sun };

// Your account.
//
// This page reads public.profiles directly, which is allowed because the RLS is
// self-only (id = auth.uid()). It is in fact the ONLY page that reads profiles
// directly; everything that renders another person goes through profiles_public or
// a definer RPC. Keep it that way.

type Profile = {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  is_anonymous: boolean;
  upgraded_at: string | null;
  created_at: string;
};

export default function MySettingsPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "signedout" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Data rights. The privacy policy has promised these in production for some time
  // and they did not exist. They do now.
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [rightsError, setRightsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setStatus("signedout"); return; }

      const { data, error: e } = await supabase
        .from("profiles")
        .select("id, display_name, email, avatar_url, is_anonymous, upgraded_at, created_at")
        .eq("id", user.id)
        .maybeSingle();

      if (!active) return;
      if (e) { setStatus("error"); return; }

      const p = data as Profile | null;
      setProfile(p);
      setName(p?.display_name ?? "");
      setStatus("ready");
    })();
    return () => { active = false; };
  }, [supabase]);

  async function saveName() {
    if (!profile) return;
    setSaving(true); setError(null); setSaved(false);
    const { error: e } = await supabase
      .from("profiles")
      .update({ display_name: name.trim() || null })
      .eq("id", profile.id);
    setSaving(false);
    if (e) { setError("Could not save your name. Try again."); return; }
    setSaved(true);
  }

  async function exportData() {
    setExporting(true); setRightsError(null);
    try {
      const res = await fetch("/api/me/export");
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `six-axes-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setRightsError("Could not build your export. Try again.");
    }
    setExporting(false);
  }

  async function deleteAccount() {
    setDeleting(true); setRightsError(null);
    try {
      const res = await fetch("/api/me/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRightsError(out.error || "Could not delete your account.");
        setDeleting(false);
        return;
      }
      // Nothing left to sign in to.
      await supabase.auth.signOut();
      window.location.href = "/";
    } catch {
      setRightsError("Could not delete your account. Try again.");
      setDeleting(false);
    }
  }

  return (
    <PageShell width={920}>
      <div style={{ width: "100%", maxWidth: 640, margin: "0 auto" }}>
        <Header title="Your account" sub="WHO YOU ARE HERE" />

        <UpgradeAccount variant="card" next="/me/settings" />

        {status === "loading" && <Muted>Loading&hellip;</Muted>}
        {status === "error" && <Muted>Something went wrong loading your account. Please refresh.</Muted>}
        {status === "signedout" && (
          <Muted>You are not signed in. Claim a character with your GM&apos;s invite link to get started.</Muted>
        )}

        {status === "ready" && profile && (
          <>
            <Card>
              <Label>Display name</Label>
              <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.55, margin: "0 0 10px" }}>
                What your GM sees next to your RSVPs and your check-ins. Your
                characters have their own names; this one is yours.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  value={name}
                  onChange={(e) => { setName(e.target.value); setSaved(false); }}
                  placeholder="Your name"
                  style={{
                    flex: "1 1 200px", background: SAX.panelBg, color: C.text,
                    border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 12px", fontSize: 14,
                  }}
                />
                <button type="button" onClick={saveName} disabled={saving} style={btn(C.sun, SAX.inkDeep)}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
              {saved && <p style={{ color: C.good, fontSize: 12.5, margin: "10px 0 0" }}>Saved.</p>}
              {error && <p style={{ color: C.warn, fontSize: 12.5, margin: "10px 0 0" }}>{error}</p>}
            </Card>

            <Card>
              <Label>Account</Label>
              {profile.is_anonymous ? (
                <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
                  You are playing as a guest. Everything you have lives only in this
                  browser: clear your history and your characters go with it. Linking
                  an account above fixes that and changes nothing else.
                </p>
              ) : (
                <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
                  Signed in as <span style={{ color: C.text }}>{profile.email ?? "your linked account"}</span>.
                  Your characters follow you to any device.
                  {profile.upgraded_at && (
                    <> Linked {new Date(profile.upgraded_at).toLocaleDateString()}.</>
                  )}
                </p>
              )}
            </Card>

            <Card>
              <Label>Your recordings</Label>
              <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
                Session audio is deleted 60 days after it is recorded. The transcript
                and the moments drawn from it stay; the recording itself does not. You
                can withdraw consent at any time by telling your GM, and your track is
                excluded from that session onward.
              </p>
            </Card>

            <Card>
              <Label>Your data</Label>
              <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 12px" }}>
                Take everything we hold about you: your characters, your self-reports and
                how they changed over time, your dispositions, your threads, your check-ins,
                and your transcribed words. One JSON file, nothing withheld.
              </p>
              <button type="button" onClick={exportData} disabled={exporting} style={btn("transparent", C.text, C.line)}>
                {exporting ? "Building your export..." : "Export my data"}
              </button>
            </Card>

            <Card>
              <Label>Delete your account</Label>
              <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 12px" }}>
                Deletes everything that is <em>about you</em>: your recordings, your
                transcribed words, your self-reports, your dispositions, your threads,
                your check-ins, your chat.
              </p>
              <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 14px" }}>
                Your <strong style={{ color: C.text }}>characters stay in their campaigns</strong>,
                unlinked from you. The story your table told together is theirs as well as
                yours, and your leaving should not detonate it. Everything connecting those
                characters to <em>you</em> is severed.
              </p>

              {!showDelete ? (
                <button type="button" onClick={() => setShowDelete(true)} style={btn("transparent", C.warn, C.warn)}>
                  Delete my account
                </button>
              ) : (
                <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
                  <p style={{ color: C.warn, fontSize: 13, margin: "0 0 10px", lineHeight: 1.55 }}>
                    This cannot be undone. Type <strong>DELETE</strong> to confirm.
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="DELETE"
                      style={{
                        flex: "0 1 140px", background: SAX.panelBg, color: C.text,
                        border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 12px",
                        fontSize: 14, fontFamily: SAX.mono, letterSpacing: "0.1em",
                      }}
                    />
                    <button
                      type="button"
                      onClick={deleteAccount}
                      disabled={deleting || confirmText !== "DELETE"}
                      style={{
                        ...btn(confirmText === "DELETE" ? C.warn : "transparent",
                               confirmText === "DELETE" ? SAX.inkDeep : C.muted),
                        border: `1px solid ${confirmText === "DELETE" ? C.warn : C.line}`,
                        cursor: confirmText === "DELETE" && !deleting ? "pointer" : "default",
                      }}
                    >
                      {deleting ? "Deleting..." : "Delete forever"}
                    </button>
                    <button type="button" onClick={() => { setShowDelete(false); setConfirmText(""); }} style={btn("transparent", C.muted, C.line)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {rightsError && <p style={{ color: C.warn, fontSize: 13, margin: "12px 0 0", lineHeight: 1.55 }}>{rightsError}</p>}
            </Card>
          </>
        )}
      </div>
    </PageShell>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: SAX.slateBg, border: `1px solid ${SAX.line}`,
      borderRadius: 12, padding: "16px 18px", marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.18em",
      textTransform: "uppercase", color: SAX.muted, marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function btn(bg: string, fg: string, border?: string): React.CSSProperties {
  return {
    background: bg, color: fg, border: `1px solid ${border ?? bg}`, borderRadius: 8,
    padding: "9px 16px", fontSize: 13, fontWeight: 700,
    fontFamily: SAX.mono, letterSpacing: "0.04em", cursor: "pointer",
  };
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ textAlign: "center", color: SAX.muted, fontSize: 14, lineHeight: 1.65 }}>{children}</p>;
}
