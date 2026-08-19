"use client";

import { useState } from "react";
import { SAX, STONE } from "@/lib/theme";
import { stonePanel, stoneField, stoneButton, forgeLabel } from "@/lib/forge-theme";

// components/contact-form.tsx
//
// The public contact form. No auth: it posts to /api/contact, which only emails the admin. A honeypot
// field ("company") catches the simplest bots. Styled in the forge register; the submit button reuses
// the .forge-btn CSS the surrounding SiteShell injects.

const TOPICS = ["General question", "Pilot access", "A bug", "Press or partnership", "Something else"];

type State = { status: "idle" | "sending" | "sent" | "error"; error?: string };

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [state, setState] = useState<State>({ status: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state.status === "sending") return;
    if (!name.trim() || !email.trim() || !message.trim()) {
      setState({ status: "error", error: "Please fill in your name, email, and a message." });
      return;
    }
    setState({ status: "sending" });
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, topic, message, company }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ status: "error", error: out.error ?? "Could not send. Please email kncadmin@kerfandcode.com directly." });
        return;
      }
      setState({ status: "sent" });
    } catch {
      setState({ status: "error", error: "Could not reach the server. Please email kncadmin@kerfandcode.com directly." });
    }
  }

  if (state.status === "sent") {
    return (
      <div style={{ ...stonePanel(), padding: "26px 28px" }}>
        <h2 style={sentHead}>Thanks, that reached us.</h2>
        <p style={sentBody}>
          We read everything, and you will hear back at {email.trim()}. If it is urgent, you can also email{" "}
          <a href="mailto:kncadmin@kerfandcode.com" style={{ color: STONE.brassHi }}>kncadmin@kerfandcode.com</a>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ ...stonePanel(), padding: "24px 26px" }}>
      {/* honeypot: hidden from people, tempting to bots */}
      <div style={{ position: "absolute", left: "-9999px", top: "auto", width: 1, height: 1, overflow: "hidden" }} aria-hidden>
        <label>Company<input tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} /></label>
      </div>

      <div style={grid2}>
        <label style={{ display: "block" }}>
          <span style={forgeLabel}>Your name</span>
          <input style={stoneField()} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <label style={{ display: "block" }}>
          <span style={forgeLabel}>Email</span>
          <input style={stoneField()} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
        </label>
      </div>

      <label style={{ display: "block", marginTop: 14 }}>
        <span style={forgeLabel}>What is this about?</span>
        <select style={stoneField()} value={topic} onChange={(e) => setTopic(e.target.value)}>
          {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>

      <label style={{ display: "block", marginTop: 14 }}>
        <span style={forgeLabel}>Message</span>
        <textarea
          style={{ ...stoneField(), minHeight: 150, resize: "vertical", lineHeight: 1.55 }}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
        />
      </label>

      {state.status === "error" && <p style={errText}>{state.error}</p>}

      <div style={{ marginTop: 18 }}>
        <button type="submit" className="forge-btn is-primary" style={stoneButton("primary")} disabled={state.status === "sending"}>
          {state.status === "sending" ? "Sending…" : "Send message"}
        </button>
      </div>
      <p style={fine}>No account needed. This goes straight to the team; nothing is stored on the site.</p>
    </form>
  );
}

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 };
const sentHead: React.CSSProperties = { fontFamily: "var(--forge-display, 'Cinzel', serif)", fontSize: 24, color: STONE.ink, margin: "0 0 8px" };
const sentBody: React.CSSProperties = { fontSize: 16, lineHeight: 1.6, color: STONE.inkDim, margin: 0, fontFamily: SAX.serif };
const errText: React.CSSProperties = { color: STONE.bloodLit, fontSize: 14, margin: "14px 0 0", fontFamily: SAX.serif };
const fine: React.CSSProperties = { fontSize: 12.5, color: STONE.inkFaint, margin: "12px 0 0", fontFamily: SAX.serif };
