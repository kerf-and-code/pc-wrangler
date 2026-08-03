import type { Metadata } from "next";
import Link from "next/link";

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
    <main style={page}>
      <div style={wrap}>
        <p style={eyebrow}>Foundry VTT</p>
        <h1 style={h1}>Six Axes for Foundry</h1>
        <p style={lede}>
          Sends what your table rolls to Six Axes, so your recap, campaign wiki and encounter maths
          are built from what actually happened rather than from what anyone remembered to write
          down.
        </p>

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
          <h2 style={h2}>Requirements</h2>
          <ul style={list}>
            <li style={li}>Foundry VTT v12 or later. Verified against 13.351.</li>
            <li style={li}>
              The dnd5e system for exact roll types. Other systems still send rolls; the app just
              has to guess from the flavour text what kind of roll it was, and labels anything it
              cannot place as &ldquo;other&rdquo; rather than guessing wrong.
            </li>
            <li style={li}>A Six Axes campaign with a live session, which is what a roll attaches to.</li>
          </ul>
        </section>

        <footer style={footer}>
          <p style={{ margin: 0 }}>
            <Link href="/" style={link}>Six Axes</Link>
            {" \u00B7 "}
            <Link href="/privacy" style={link}>Privacy</Link>
            {" \u00B7 "}
            <a href="/foundry/six-axes.zip" style={link}>Download the module directly</a>
          </p>
        </footer>
      </div>
    </main>
  );
}

const page: React.CSSProperties = {
  minHeight: "100vh", background: "#f6f2e9", color: "#2a2620",
  padding: "56px 20px 64px",
  fontFamily: "'Iowan Old Style', Georgia, 'Times New Roman', serif",
};
const wrap: React.CSSProperties = { maxWidth: 700, margin: "0 auto" };
const eyebrow: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11,
  letterSpacing: "0.24em", textTransform: "uppercase", color: "#8a7a55", margin: "0 0 10px",
};
const h1: React.CSSProperties = { fontSize: 38, lineHeight: 1.14, margin: "0 0 14px", fontWeight: 600 };
const lede: React.CSSProperties = { fontSize: 18, lineHeight: 1.65, color: "#4a443a", margin: "0 0 8px" };
const card: React.CSSProperties = { padding: "24px 0", borderTop: "1px solid #ddd4c2" };
const h2: React.CSSProperties = { fontSize: 24, margin: "0 0 10px", fontWeight: 600 };
const body: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.72, margin: "0 0 14px", color: "#3a352c" };
const list: React.CSSProperties = { margin: "4px 0 14px", paddingLeft: 22 };
const li: React.CSSProperties = { fontSize: 16.5, lineHeight: 1.72, marginBottom: 10, color: "#3a352c" };
const code: React.CSSProperties = {
  fontFamily: "ui-monospace, monospace", fontSize: 13.5, background: "#ece4d2",
  padding: "10px 12px", borderRadius: 3, margin: "10px 0 0", wordBreak: "break-all",
};
const link: React.CSSProperties = { color: "#8a6a2f" };
const footer: React.CSSProperties = {
  marginTop: 36, paddingTop: 18, borderTop: "1px solid #ddd4c2",
  fontSize: 13.5, color: "#8a8069",
};
