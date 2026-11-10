"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { UpgradeAccount } from "@/components/upgrade-account";
import { Header } from "@/app/me/campaigns/page";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { askConfirm } from "@/lib/confirm";
import { fmtDate } from "@/lib/format";

// Your account.
//
// Push 9: change the sign-in email (audit F12). Supabase sends a confirmation link; the address changes
// only when it is followed. On load the profile's copy of the address is refreshed from the sign-in
// record (sync_my_email, p145), so a change shows here once confirmed. The export and deletion texts
// now match what export_my_data and delete_my_account cover (audit T14, G11).
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

// Audit F5: standing recording consent, per campaign (p137 my_recording_consents).
// Push 1 (audit T12): which emails this address gets (p138 my_email_prefs / set_my_email_prefs).
type EmailPrefs = { email: string; reminders: boolean; recaps: boolean };
// Push 8 (audit T11): carried is true when the standing consent was filled in by the one-off backfill from
// an earlier single-session yes, not given by the player as standing consent; the page asks them to confirm.
type ConsentRow = { campaignId: string; campaignName: string; characters: { id: string; name: string }[]; state: "given" | "withdrawn" | "none"; carried?: boolean };

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
  const [consents, setConsents] = useState<ConsentRow[] | null>(null);
  const [consentBusy, setConsentBusy] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefs | null>(null);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [emailChangeBusy, setEmailChangeBusy] = useState(false);
  const [emailChangeMsg, setEmailChangeMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setStatus("signedout"); return; }
      // Keep the profile's copy of the address in step with the sign-in record (after an email change).
      if (!user.is_anonymous) await supabase.rpc("sync_my_email");

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
      const { data: cons, error: ce } = await supabase.rpc("my_recording_consents");
      if (!active) return;
      if (ce) setConsentError("Could not load your recording consent. Reload to try again.");
      else setConsents((cons as ConsentRow[]) || []);
      const { data: ep } = await supabase.rpc("my_email_prefs");
      if (!active) return;
      setEmailPrefs((ep as EmailPrefs | null) ?? null);
    })();
    return () => { active = false; };
  }, [supabase]);

  async function setConsent(row: ConsentRow, on: boolean) {
    if (!on && !await askConfirm(`Stop recording your voice in ${row.campaignName}? From the next session your audio is not uploaded or transcribed. You can turn it back on here.`)) return;
    setConsentBusy(row.campaignId); setConsentError(null);
    const { error: e } = await supabase.rpc("set_my_recording_consent", { p_campaign: row.campaignId, p_consented: on });
    setConsentBusy(null);
    if (e) { setConsentError(`Not saved: ${e.message}`); return; }
    setConsents((cs) => (cs || []).map((c) => (c.campaignId === row.campaignId ? { ...c, state: on ? "given" : "withdrawn", carried: false } : c)));
  }

  async function setEmailPref(key: "reminders" | "recaps", on: boolean) {
    if (!emailPrefs) return;
    const next = { ...emailPrefs, [key]: on };
    setEmailPrefs(next); setEmailMsg(null);
    const { error: e } = await supabase.rpc("set_my_email_prefs", { p_reminders: next.reminders, p_recaps: next.recaps });
    if (e) { setEmailPrefs(emailPrefs); setEmailMsg(`Not saved: ${e.message}`); return; }
    setEmailMsg("Saved.");
  }

  async function changeEmail() {
    const next = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { setEmailChangeMsg({ ok: false, text: "Enter a full email address." }); return; }
    if (profile?.email && next === profile.email.toLowerCase()) { setEmailChangeMsg({ ok: false, text: "That is already your address." }); return; }
    setEmailChangeBusy(true); setEmailChangeMsg(null);
    const { error: e } = await supabase.auth.updateUser(
      { email: next },
      { emailRedirectTo: `${window.location.origin}/auth/confirm?next=/me/settings` },
    );
    setEmailChangeBusy(false);
    if (e) { setEmailChangeMsg({ ok: false, text: `Not changed: ${e.message}` }); return; }
    setEmailChangeMsg({ ok: true, text: `Check ${next} (and your current address) for a confirmation link. Your email changes once you follow it.` });
    setNewEmail("");
  }

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
                    flex: "1 1 200px", color: C.text,
                    borderRadius: FORGE_RADIUS, padding: "9px 12px", fontSize: 14 }}
                />
                <button type="button" onClick={saveName} disabled={saving} style={btn(C.sun, C.ink)}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
              {saved && <p role="status" aria-live="polite" style={{ color: C.good, fontSize: 12.5, margin: "10px 0 0" }}>Saved.</p>}
              {error && <p role="alert" style={{ color: C.warn, fontSize: 12.5, margin: "10px 0 0" }}>{error}</p>}
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
                    <> Linked {fmtDate(profile.upgraded_at)}.</>
                  )}
                </p>
              )}
              {!profile.is_anonymous && (
                <div style={{ marginTop: 14 }}>
                  <label htmlFor="new-email" style={{ display: "block", color: C.text, fontSize: 13.5, marginBottom: 6 }}>Change your email</label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      id="new-email"
                      type="email"
                      autoComplete="email"
                      value={newEmail}
                      onChange={(e) => { setNewEmail(e.target.value); setEmailChangeMsg(null); }}
                      style={{ flex: "1 1 220px", color: C.text, borderRadius: FORGE_RADIUS, padding: "9px 12px", fontSize: 16 }}
                    />
                    <button type="button" onClick={changeEmail} disabled={emailChangeBusy} style={btn("transparent", C.text, C.line)}>
                      {emailChangeBusy ? "Sending…" : "Send confirmation"}
                    </button>
                  </div>
                  {emailChangeMsg && (
                    <p role={emailChangeMsg.ok ? "status" : "alert"} style={{ color: emailChangeMsg.ok ? C.good : C.warn, fontSize: 12.5, margin: "8px 0 0", lineHeight: 1.5 }}>
                      {emailChangeMsg.text}
                    </p>
                  )}
                </div>
              )}
            </Card>

            <Card>
              <Label>Your recordings</Label>
              <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 12px" }}>
                Session audio is deleted 60 days after it is recorded. The transcript
                and the moments drawn from it stay; the recording itself does not. You
                can stop or start recording of your voice for each campaign here (or with
                /consent in Discord). Turning it off applies from the next recording:
                your voice is not uploaded or transcribed. Audio already recorded follows
                the 60-day deletion.
              </p>
              {consents === null && !consentError && <p role="status" style={{ color: C.muted, fontSize: 13, margin: 0 }}>Loading your campaigns&hellip;</p>}
              {consents && consents.length === 0 && <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>You have no characters in a campaign yet.</p>}
              {consents && consents.length > 0 && (
                <div style={{ display: "grid", gap: 8 }}>
                  {consents.map((c) => (
                    <div key={c.campaignId} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 12px", border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS }}>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ color: C.text, fontSize: 14 }}>{c.campaignName}</div>
                        <div style={{ color: C.muted, fontSize: 12.5 }}>
                          {c.characters.map((ch) => ch.name).join(", ")}:{" "}
                          {c.state === "given" ? "recording on" : c.state === "withdrawn" ? "recording off" : "not asked yet (off)"}
                        </div>
                        {c.state === "given" && c.carried && (
                          <div style={{ color: C.text, fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>
                            This was carried over from a session you agreed to record, not asked as a standing yes.
                            Confirm it, or stop recording.
                          </div>
                        )}
                      </div>
                      {c.state === "given" && c.carried && (
                        <button type="button" disabled={consentBusy === c.campaignId} onClick={() => setConsent(c, true)} style={btn("transparent", C.text, C.line)}>
                          {consentBusy === c.campaignId ? "Saving…" : "Confirm, keep recording"}
                        </button>
                      )}
                      {c.state === "given"
                        ? <button type="button" disabled={consentBusy === c.campaignId} onClick={() => setConsent(c, false)} style={btn("transparent", C.text, C.line)}>
                            {consentBusy === c.campaignId ? "Saving…" : "Stop recording me"}
                          </button>
                        : <button type="button" disabled={consentBusy === c.campaignId} onClick={() => setConsent(c, true)} style={btn("transparent", C.text, C.line)}>
                            {consentBusy === c.campaignId ? "Saving…" : "I consent to recording"}
                          </button>}
                    </div>
                  ))}
                </div>
              )}
              {consentError && <p role="alert" style={{ color: C.warn, fontSize: 13, margin: "10px 0 0" }}>{consentError}</p>}
            </Card>

            {emailPrefs && (
              <Card>
                <Label>Email</Label>
                <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 12px" }}>
                  Emails to <span style={{ color: C.text }}>{emailPrefs.email}</span>. Every email also has its own
                  unsubscribe link.
                </p>
                <div style={{ display: "grid", gap: 10 }}>
                  {([["reminders", "Session reminders and RSVP requests"], ["recaps", "Session recaps your GM sends"]] as const).map(([key, label]) => (
                    <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, color: C.text, fontSize: 14, cursor: "pointer" }}>
                      <input type="checkbox" checked={emailPrefs[key]} onChange={(e) => setEmailPref(key, e.target.checked)} style={{ width: 18, height: 18 }} />
                      {label}
                    </label>
                  ))}
                </div>
                {emailMsg && <p role="status" style={{ color: emailMsg === "Saved." ? C.muted : C.warn, fontSize: 13, margin: "10px 0 0" }}>{emailMsg}</p>}
              </Card>
            )}

            <Card>
              <Label>Your data</Label>
              <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 12px" }}>
                Take everything we hold about you: your characters with their full sheets and
                pages, your library, your notes, your self-reports and how they changed over
                time, your dispositions, your threads, your check-ins, your chat, your
                transcribed words, and your settings. One JSON file, nothing withheld. A
                campaign you run has its own export in the GM workspace.
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
                your check-ins, your chat, your notes, your library, the character page
                sections you wrote, and your settings.
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
                        flex: "0 1 140px", color: C.text,
                        borderRadius: FORGE_RADIUS, padding: "9px 12px",
                        fontSize: 14, fontFamily: SAX.mono, letterSpacing: "0.1em" }}
                    />
                    <button
                      type="button"
                      onClick={deleteAccount}
                      disabled={deleting || confirmText !== "DELETE"}
                      style={{
                        ...btn(confirmText === "DELETE" ? C.warn : "transparent",
                               confirmText === "DELETE" ? C.ink : C.muted),
                        border: `1px solid ${confirmText === "DELETE" ? C.warn : C.line}`,
                        cursor: confirmText === "DELETE" && !deleting ? "pointer" : "default",
                      }}
                    >
                      {deleting ? "Deleting…" : "Delete forever"}
                    </button>
                    <button type="button" onClick={() => { setShowDelete(false); setConfirmText(""); }} style={btn("transparent", C.muted, C.line)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {rightsError && <p role="alert" style={{ color: C.warn, fontSize: 13, margin: "12px 0 0", lineHeight: 1.55 }}>{rightsError}</p>}
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
      background: C.surface, border: `1px solid ${C.line}`,
      borderRadius: FORGE_RADIUS, padding: "16px 18px", marginBottom: 12, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.18em",
      textTransform: "uppercase", color: C.muted, marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function btn(bg: string, fg: string, border?: string): React.CSSProperties {
  return {
    background: bg, color: fg, border: `1px solid ${border ?? bg}`, borderRadius: FORGE_RADIUS,
    padding: "9px 16px", fontSize: 13, fontWeight: 700,
    fontFamily: SAX.mono, letterSpacing: "0.04em", cursor: "pointer",
  };
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.65 }}>{children}</p>;
}
