"use client";

// components/pilot-form.tsx
//
// The pilot application form. Presentational + submit only: it posts JSON to /api/pilot-request,
// which emails the admin. No auth, no persistence, nothing stored in an account. Styled to match the
// document register of the landing / pilot pages (cream, serif), not the in-app dungeon chrome.
//
// The `company` field is a honeypot: hidden from humans, and if a bot fills it the API silently
// accepts and drops the submission. Kept simple on purpose; a pilot form is low volume.

import { useState } from "react";

const SYSTEMS = [
  "Dungeons & Dragons 5e",
  "Pathfinder 2e",
  "Lancer",
  "Dark Matter",
  "Draw Steel",
  "Daggerheart",
  "Call of Cthulhu",
  "Vampire / d10 pool",
  "Other or not sure",
];

type Status = "idle" | "sending" | "sent" | "error";

export default function PilotForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending") return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") || "").trim(),
      email: String(data.get("email") || "").trim(),
      system: String(data.get("system") || "").trim(),
      setting: String(data.get("setting") || "").trim(),
      tables: String(data.get("tables") || "").trim(),
      description: String(data.get("description") || "").trim(),
      company: String(data.get("company") || ""), // honeypot
    };
    if (!payload.name || !payload.email) {
      setError("Please add your name and email.");
      setStatus("error");
      return;
    }
    setStatus("sending");
    setError("");
    try {
      const res = await fetch("/api/pilot-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Something went wrong. Please try again, or email us directly.");
        setStatus("error");
        return;
      }
      setStatus("sent");
    } catch {
      setError("Could not reach the server. Please try again, or email us directly.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div style={done}>
        <p style={{ ...body, margin: "0 0 8px", fontWeight: 600 }}>Thanks, that is in.</p>
        <p style={{ ...body, margin: 0 }}>
          We read every application and reply from a real address. Keep an eye on your inbox, and check
          spam if it is quiet for a day or two.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ marginTop: 8 }} noValidate>
      <Field label="Your name">
        <input name="name" type="text" required maxLength={120} style={input} autoComplete="name" />
      </Field>

      <Field label="Email">
        <input name="email" type="email" required maxLength={200} style={input} autoComplete="email" />
      </Field>

      <Field label="System you want to run">
        <select name="system" style={input} defaultValue={SYSTEMS[0]}>
          {SYSTEMS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>

      <Field label="How you play">
        <select name="setting" style={input} defaultValue="Online (Discord)">
          <option>Online (Discord)</option>
          <option>In person (one microphone)</option>
          <option>Both</option>
        </select>
      </Field>

      <Field label="How many tables do you run?">
        <select name="tables" style={input} defaultValue="1">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3+">3 or more</option>
        </select>
      </Field>

      <Field label="Tell us about your table" hint="Group size, how long you have been running it, what you are hoping Six Axes does for you. Anything you like.">
        <textarea name="description" rows={5} maxLength={2000} style={{ ...input, resize: "vertical" }} />
      </Field>

      {/* Honeypot: visually hidden, off the tab order, ignored by humans. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "auto", height: 0, overflow: "hidden" }}>
        <label>Company<input name="company" type="text" tabIndex={-1} autoComplete="off" /></label>
      </div>

      {status === "error" && <p style={errStyle}>{error}</p>}

      <button type="submit" style={{ ...cta, opacity: status === "sending" ? 0.6 : 1 }} disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Apply to the pilot"}
      </button>
      <p style={small}>We use your email only to reply about the pilot. Nothing is stored in an account.</p>
    </form>
  );
}

function Field(
  { label, hint, children }: { label: string; hint?: string; children: React.ReactNode },
) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <span style={fieldLabel}>{label}</span>
      {hint && <span style={fieldHint}>{hint}</span>}
      {children}
    </label>
  );
}

const body: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.72, color: "#3a352c" };
const fieldLabel: React.CSSProperties = {
  display: "block", fontSize: 13, letterSpacing: "0.04em", textTransform: "uppercase",
  color: "#6a6252", marginBottom: 6, fontFamily: "ui-monospace, SFMono-Regular, monospace",
};
const fieldHint: React.CSSProperties = {
  display: "block", fontSize: 13.5, color: "#8a8069", marginBottom: 8, fontStyle: "italic",
  fontFamily: "'Iowan Old Style', Georgia, serif",
};
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 16,
  fontFamily: "'Iowan Old Style', Georgia, serif", color: "#2a2620",
  background: "#fffdf8", border: "1px solid #c9bfa8", borderRadius: 3, colorScheme: "light",
};
const cta: React.CSSProperties = {
  display: "inline-block", background: "#3a352c", color: "#f6f2e9",
  padding: "12px 24px", borderRadius: 3, border: "none", cursor: "pointer",
  fontFamily: "ui-monospace, monospace", fontSize: 13,
  letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 4,
};
const small: React.CSSProperties = { fontSize: 13, color: "#8a8069", margin: "12px 0 0", lineHeight: 1.6 };
const errStyle: React.CSSProperties = {
  fontSize: 14.5, color: "#9a3b2e", margin: "4px 0 12px",
  fontFamily: "'Iowan Old Style', Georgia, serif",
};
const done: React.CSSProperties = {
  marginTop: 10, padding: "18px 20px", background: "#fffdf8",
  border: "1px solid #cfc3a4", borderRadius: 6,
};
