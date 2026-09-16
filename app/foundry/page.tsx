import type { Metadata } from "next";
import SiteShell from "@/components/site/site-shell";
import { SAX } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

// app/foundry/page.tsx
//
// Where a GM lands from the module's readme link, and the page whose URL gets pasted into a Discord
// thread when someone asks "does this work with Foundry".
//
// Server-rendered and in the same document register as the landing page and a published codex: a
// person reading install instructions is reading, not playing.
//
// It states what the module can see BEFORE it says how to install it. A table is being asked to let
// software watch their game, and burying the boundary under a numbered list would be the wrong way
// round.

export const metadata: Metadata = {
  title: "Six Axes for Foundry VTT",
  description:
    "A Foundry module that sends your table's rolls to Six Axes, so recaps, the campaign wiki and "
    + "encounter maths are built from what actually happened. Rolls only.",
  alternates: { canonical: "/foundry" },
};

const MANIFEST = "https://www.six-axes.com/foundry/module.json";

export default function FoundryPage() {
  return (
    <SiteShell
      title="Six Axes for Foundry"
      tagline="Sends what your table rolls to Six Axes, so your recap, campaign wiki and encounter maths are built from what actually happened rather than from what anyone remembered to write down."
    >
        <section style={card}>
          <h2 style={h2}>What it can see</h2>
          <p style={body}>
            Dice. The faces, the total, and what the roll was for.
          </p>
          <p style={body}>
            It does not read chat messages, character sheets, journal entries, tokens, scenes or
            audio, and it has no socket connection to other players. That is the whole surface, and
            it is deliberately small enough to state in a sentence: <strong>it sees dice</strong>.
          </p>
        </section>

        <section style={card}>
          <h2 style={h2}>Installing it</h2>
          <ol style={list}>
            <li style={li}>
              In Foundry, go to <strong>Add-on Modules</strong> and press{" "}
              <strong>Install Module</strong>.
            </li>
            <li style={li}>
              Paste this into <strong>Manifest URL</strong> and press Install:
              <div style={code}>{MANIFEST}</div>
            </li>
            <li style={li}>
              Open your world, enable <strong>Six Axes</strong> in Manage Modules.
            </li>
            <li style={li}>
              In <strong>Module Settings</strong>, paste your table code. Get it from Six Axes under{" "}
              <strong>Table &rarr; Roster &rarr; Table Tap</strong>. Nothing is sent anywhere until
              this is filled in.
            </li>
          </ol>
          <p style={body}>
            That is it. Roll something and it will appear on your session&apos;s Mechanics page.
          </p>
        </section>

        <section style={card}>
          <h2 style={h2}>Who sends the rolls</h2>
          <p style={body}>
            The GM&apos;s client, and only the GM&apos;s. Foundry already broadcasts every roll to
            everyone in the world, so if each player sent them too, one roll would arrive five times.
          </p>
          <p style={body}>
            There is a per-player setting for the unusual case where the GM does not run Foundry
            themselves. Leave it off otherwise.
          </p>
        </section>

        <section style={card}>
          <h2 style={h2}>Linking characters</h2>
          <p style={body}>
            The first roll from a character will arrive unattributed, because Six Axes has not seen
            that Foundry actor before. Open your table link once and match them up; every earlier
            roll is backfilled and every later one attributes automatically.
          </p>
          <p style={body}>
            If you already use the D&amp;D Beyond extension, this is the same step you did there.
          </p>
        </section>

        <section style={card}>
          <h2 style={h2}>What about voice?</h2>
          <p style={body}>
            If your table talks over <strong>Discord</strong> while playing in Foundry, which most
            do, you are already covered: invite the Six Axes bot to your server and it records each
            player on their own track exactly as it would for a Discord-only game. This module
            handles the rolls; the bot handles the voice. Nothing extra to set up beyond the two.
          </p>
          <p style={body}>
            If you use Foundry&apos;s built-in audio instead, voice capture is not supported yet.
            Foundry sends audio directly between players rather than through a server, so there is
            no single stream for a bot to join. Say so if that is your setup and it moves up the
            list.
          </p>
        </section>

        <section style={card}>
          <h2 style={h2}>Requirements</h2>
          <ul style={list}>
            <li style={li}>Foundry VTT v12 or later. Verified against 14.365.</li>
            <li style={li}>
              The dnd5e system for exact roll types. Other systems still send rolls; the app just
              has to guess from the flavour text what kind of roll it was, and labels anything it
              cannot place as &ldquo;other&rdquo; rather than guessing wrong.
            </li>
            <li style={li}>A Six Axes campaign with a live session, which is what a roll attaches to.</li>
          </ul>
        </section>

        <p style={{ ...body, marginTop: 24 }}>
          Prefer to install by hand? <a href="/foundry/six-axes.zip" style={link}>Download the module directly</a>.
        </p>
    </SiteShell>
  );
}

// Content styles for the dark forge chrome (SiteShell). The page frame, title, and tagline now come
// from SiteShell; these style only the body sections.
const card: React.CSSProperties = { padding: "24px 0", borderTop: `1px solid ${C.line}` };
const h2: React.CSSProperties = { fontSize: 24, margin: "0 0 10px", fontWeight: 600, color: C.text, fontFamily: SAX.serif };
const body: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.72, margin: "0 0 14px", color: C.text };
const list: React.CSSProperties = { margin: "4px 0 14px", paddingLeft: 22 };
const li: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.72, marginBottom: 10, color: C.text };
const code: React.CSSProperties = {
  fontFamily: SAX.mono, fontSize: 13.5, background: "rgba(0,0,0,0.32)", color: C.accent,
  border: `1px solid ${C.line}`, padding: "10px 12px", borderRadius: FORGE_RADIUS, margin: "10px 0 0", wordBreak: "break-all",
};
const link: React.CSSProperties = { color: C.plum };
