"use client";

// app/admin/page.tsx (push 17, audit F10)
//
// The owner console. Lists every account with its pilot access (GM, player or none), the campaigns it
// runs, its last sign-in and what its campaigns used in the last 30 days, and grants or revokes access
// with one button, instead of hand SQL on production. Only accounts in OWNER_IDS can load it: the
// page asks /api/admin/users, which checks on every call.

import { useCallback, useEffect, useMemo, useState } from "react";
import PageShell from "@/components/page-shell";
import PageHeader from "@/components/ui-forge/PageHeader";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { askConfirm } from "@/lib/confirm";
import { fmtDate, fmtRelative } from "@/lib/format";

type Account = {
  id: string; display_name: string | null; email: string | null; is_anonymous: boolean;
  access_granted: boolean; access_role: string | null; created_at: string;
  is_owner: boolean; last_sign_in_at: string | null; campaigns_run: number;
  usage30: { minutes: number; aiCalls: number; tokens: number; images: number } | null;
};
type Filter = "all" | "gm" | "player" | "none";

const accessOf = (a: Account): Filter => (!a.access_granted ? "none" : a.access_role === "gm" ? "gm" : "player");
const LABEL: Record<Filter, string> = { all: "Everyone", gm: "GM access", player: "Player access", none: "No access" };

export default function OwnerConsole() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [usageReady, setUsageReady] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [guests, setGuests] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) { setState("denied"); return; }
    if (!res.ok) { setState("error"); return; }
    const j = (await res.json()) as { accounts: Account[]; usageReady: boolean };
    setAccounts(j.accounts); setUsageReady(j.usageReady); setState("ready");
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (accounts ?? []).filter((a) =>
      (guests || !a.is_anonymous) &&
      (filter === "all" || accessOf(a) === filter) &&
      (!s || (a.display_name ?? "").toLowerCase().includes(s) || (a.email ?? "").toLowerCase().includes(s) || a.id.startsWith(s)));
  }, [accounts, q, filter, guests]);

  const counts = useMemo(() => {
    const real = (accounts ?? []).filter((a) => !a.is_anonymous);
    return { gm: real.filter((a) => accessOf(a) === "gm").length, player: real.filter((a) => accessOf(a) === "player").length, none: real.filter((a) => accessOf(a) === "none").length, guests: (accounts ?? []).length - real.length };
  }, [accounts]);

  async function act(a: Account, action: "gm" | "player" | "revoke") {
    const who = a.display_name || a.email || "this account";
    const msg = action === "gm" ? `Give ${who} GM access? They can open the GM tools, run campaigns and use the paid AI and image features.`
      : action === "player" ? `Set ${who} to player access? They keep their own pages but lose the GM tools. Campaigns they run stay as they are.`
      : `Revoke ${who}'s access? They are held at the code screen for the GM tools until they enter a code again or you grant it back. Their campaigns and characters stay.`;
    if (!await askConfirm(msg, { confirmLabel: action === "gm" ? "Give GM access" : action === "player" ? "Set to player" : "Revoke access", danger: action === "revoke" })) return;
    setBusy(a.id); setNote(null);
    const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: a.id, action }) });
    const j = (await res.json().catch(() => ({}))) as { error?: string; account?: { access_granted: boolean; access_role: string | null } };
    setBusy(null);
    if (!res.ok || !j.account) { setNote({ text: j.error || "Could not save that.", bad: true }); return; }
    setAccounts((xs) => (xs ?? []).map((x) => (x.id === a.id ? { ...x, ...j.account! } : x)));
    setNote({ text: `${who}: ${action === "revoke" ? "access revoked" : action === "gm" ? "GM access given" : "set to player access"}.`, bad: false });
  }

  const btn = (on = false): React.CSSProperties => ({
    background: on ? "rgba(200,162,75,0.14)" : "transparent", color: on ? C.sun : C.text, border: `1px solid ${on ? C.sun : C.line}`,
    borderRadius: FORGE_RADIUS, padding: "6px 11px", fontSize: 12.5, cursor: "pointer", minHeight: "var(--sax-tap, 0px)",
  });

  return (
    <PageShell width={1100}>
      <PageHeader eyebrow="Kerf and Code" title="Owner console" sub="Every account, its pilot access, and what its tables used in the last 30 days. Changes take effect on the account's next page load." />

      {state === "loading" && <p role="status" style={{ color: C.muted }}>Loading the accounts…</p>}
      {state === "denied" && <p style={{ color: C.muted }}>This page is only for the owners of Six Axes.</p>}
      {state === "error" && <p role="alert" style={{ color: C.warn }}>Could not load the accounts. Try again in a moment.</p>}

      {state === "ready" && accounts && (
        <>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", color: C.muted, fontSize: 13, marginBottom: 14 }}>
            <span><strong style={{ color: C.text }}>{counts.gm}</strong> with GM access</span>
            <span><strong style={{ color: C.text }}>{counts.player}</strong> with player access</span>
            <span><strong style={{ color: C.text }}>{counts.none}</strong> with no access</span>
            <span><strong style={{ color: C.text }}>{counts.guests}</strong> guest (share-link) accounts</span>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email or id" aria-label="Search accounts"
              style={{ flex: "1 1 240px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "8px 10px", fontSize: 14 }} />
            {(["all", "gm", "player", "none"] as Filter[]).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} style={btn(filter === f)}>{LABEL[f]}</button>
            ))}
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: C.muted }}>
              <input type="checkbox" checked={guests} onChange={(e) => setGuests(e.target.checked)} /> Show guests
            </label>
          </div>

          {note && <p role={note.bad ? "alert" : "status"} style={{ color: note.bad ? C.warn : C.muted, fontSize: 13.5 }}>{note.text}</p>}
          {!usageReady && <p style={{ color: C.muted, fontSize: 12.5 }}>Usage shows once migration p147 has run.</p>}

          <div style={{ display: "grid", gap: 10 }}>
            {shown.length === 0 && <p style={{ color: C.muted }}>No accounts match.</p>}
            {shown.map((a) => {
              const acc = accessOf(a);
              return (
                <div key={a.id} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "12px 14px", display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 15 }}>{a.display_name || (a.is_anonymous ? "Guest" : "No name")}</strong>
                    <span style={{ color: C.muted, fontSize: 13 }}>{a.email ?? ""}</span>
                    <span style={{ marginLeft: "auto", fontSize: 12, padding: "2px 9px", borderRadius: 999, border: `1px solid ${acc === "gm" ? C.sun : C.line}`, color: acc === "gm" ? C.sun : acc === "none" ? C.muted : C.text }}>
                      {a.is_owner ? "Owner, " : ""}{LABEL[acc]}{a.is_anonymous ? ", guest" : ""}
                    </span>
                  </div>
                  <div style={{ color: C.muted, fontSize: 12.5, display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <span>Joined {fmtDate(a.created_at)}</span>
                    <span>Last sign-in {a.last_sign_in_at ? fmtRelative(a.last_sign_in_at) : "never"}</span>
                    <span>Runs {a.campaigns_run} campaign{a.campaigns_run === 1 ? "" : "s"}</span>
                    {a.usage30 && <span>30 days: {Math.round(a.usage30.minutes).toLocaleString()} min transcribed, {a.usage30.aiCalls.toLocaleString()} AI calls, {a.usage30.images.toLocaleString()} images</span>}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {acc !== "gm" && <button type="button" disabled={busy === a.id} onClick={() => void act(a, "gm")} style={btn()}>Give GM access</button>}
                    {acc !== "player" && !a.is_owner && <button type="button" disabled={busy === a.id} onClick={() => void act(a, "player")} style={btn()}>Set to player</button>}
                    {acc !== "none" && !a.is_owner && <button type="button" disabled={busy === a.id} onClick={() => void act(a, "revoke")} style={{ ...btn(), color: C.warn }}>Revoke access</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </PageShell>
  );
}
