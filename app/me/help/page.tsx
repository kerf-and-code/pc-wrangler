"use client";

// app/me/help/page.tsx (push 54, 2026-11-12)
//
// The player's Help page. Until now Help in the player menu went to the public FAQ, which is written to
// sell the product and explain privacy, and nothing in the app told a player how to install Six Axes
// Capture, why their first roll did not show, or how to stop being recorded. This page has the Player
// Guide and the Player Quick Card (lib/docs-files.ts, built into public/docs by npm run docs), short
// answers to the questions players actually ask, and the FAQ for the rest.
//
// Under /me, so a guest player (no account yet) reaches it: /me is open in lib/supabase/proxy.ts. A GM
// who opens it keeps the GM menu (components/six-axes-nav.tsx), and their own Help is /gm/help.

import React from "react";
import PageShell from "@/components/page-shell";
import DocLinks from "@/components/doc-links";
import { Header } from "@/app/me/campaigns/page";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";
import { CAPTURE_STORE_URL } from "@/lib/capture";

const box: React.CSSProperties = {
  background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
  padding: "18px 20px", marginBottom: 16,
};
const h2: React.CSSProperties = { fontFamily: SAX.serif, fontSize: 20, fontWeight: 700, margin: "0 0 8px", color: C.sun };
const p: React.CSSProperties = { color: C.text, fontSize: 14.5, lineHeight: 1.65, margin: "0 0 10px" };
const a: React.CSSProperties = { color: C.sun, textDecoration: "underline", textUnderlineOffset: 3 };

function Q({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details style={{ borderTop: `1px solid ${C.line}`, padding: "10px 0" }}>
      <summary style={{ color: C.text, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{q}</summary>
      <div style={{ ...p, color: C.muted, margin: "8px 0 0" }}>{children}</div>
    </details>
  );
}

export default function PlayerHelpPage() {
  return (
    <PageShell width={920}>
      <div style={{ width: "100%", maxWidth: 700, margin: "0 auto" }}>
        <Header title="Help" sub="THE GUIDE, AND QUICK ANSWERS" />

        <section style={box}>
          <h2 style={h2}>The player documents</h2>
          <p style={{ ...p, color: C.muted }}>
            The Player Guide covers everything from claiming your character to your data. The Quick Card is the
            same on one page.
          </p>
          <DocLinks only="players" />
        </section>

        <section style={box}>
          <h2 style={h2}>Quick answers</h2>
          <Q q="How do I get my rolls to the table?">
            If you roll on D&amp;D Beyond or in Roll20, install Six Axes Capture
            {CAPTURE_STORE_URL ? <> from the <a href={CAPTURE_STORE_URL} target="_blank" rel="noreferrer" style={a}>Chrome Web Store</a></> : null}.
            D&amp;D Beyond players also need Beyond20. Then click the setup link your GM pinned, while signed in, and
            press Connect the extension to me. In Roll20, open the extension, press Turn on Roll20 and reload the game.
            On the Six Axes tabletop there is nothing to install.
          </Q>
          <Q q="My first D&D Beyond roll did not show under my character.">
            That is expected. Open the extension and choose your character in the Link your character picker. Every
            earlier roll is filled in, and every later one goes to your character on its own.
          </Q>
          <Q q="How do I stop being recorded?">
            Press Stop recording me for that campaign in <a href="/me/settings" style={a}>Settings</a>, or run
            /consent choice:off in Discord. The bot stops keeping your voice within about a minute. I consent to
            recording, in the same place, turns it back on.
          </Q>
          <Q q="I cannot open the tabletop.">
            It opens once you have claimed a character and signed in. In Discord, run /claim and pick your
            character, then /mypage and sign in with the same Discord account.
          </Q>
          <Q q="The GM called for a save.">
            It waits for you on your <a href="/me/sheet" style={a}>Character sheet</a> (Roll the save), on the
            tabletop and on the Initiative page. Roll it there, or type the total from your own dice.
          </Q>
          <Q q="Can I take my data with me?">
            Yes. <a href="/me/settings" style={a}>Settings</a>, then Export my data, gives you everything held
            about you in one file.
          </Q>
          <p style={{ ...p, color: C.muted, margin: "14px 0 0" }}>
            Anything else: the <a href="/faq" style={a}>FAQ</a>, or ask your GM.
          </p>
        </section>
      </div>
    </PageShell>
  );
}
