import Link from "next/link";
import { FORGE_BUTTON_CSS } from "@/lib/forge-theme";
import { NIGHT_CLASS, NIGHT_CSS } from "@/lib/marketing/night-theme";
import { NightHeader, NightFooter } from "@/components/site/night-chrome";
import { TOOLS_NAV, PILOT_CTA } from "@/lib/marketing/nav";

// components/tools-shell.tsx
//
// The shared frame every free tool sits in. No auth, no database, no account: these pages exist to be
// found in search and used on the spot, then to point the visitor toward the pilot.
//
// REGISTER (2026-10): the night palette, matching the home page and the rest of the marketing site. The
// root carries NIGHT_CLASS, which re-maps the app's theme variables, so each tool body (built from SAX,
// STONE and the forge helpers) re-tones without edits. The same tool components still render in the
// forge look inside the signed-in app, where no night root exists.
//
// Every tool passes a title and a one-line tagline; the shell supplies the top bar, the eyebrow, the
// link back to the tools hub, the pilot card, and the footer, so each tool page only writes its body.

export default function ToolsShell({
  title,
  tagline,
  hideHubLink,
  children,
}: {
  title: string;
  tagline?: string;
  hideHubLink?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className={NIGHT_CLASS}>
      <style dangerouslySetInnerHTML={{ __html: FORGE_BUTTON_CSS + NIGHT_CSS }} />
      <NightHeader items={TOOLS_NAV} />

      <div className="sn-body">
        <header className="sn-head">
          <p className="sn-eyebrow">
            <span>Free tools</span>
            {!hideHubLink && <Link href="/tools">All tools</Link>}
          </p>
          <h1 className="sn-h1">{title}</h1>
          {tagline && <p className="sn-lead">{tagline}</p>}
        </header>
        <hr className="sn-rule" />

        <div>{children}</div>

        <section className="sn-card" style={{ marginTop: 40 }}>
          <h2>These tools run on a slice of what Six Axes does at the table.</h2>
          <p>
            The full product records your session, writes the recap, keeps the campaign wiki, and reads how
            your table actually plays, across whatever system you run. It is in free pilot now.
          </p>
          <div className="sn-ctas">
            <Link href={PILOT_CTA.href} className="sn-btn sn-btn-fill">{PILOT_CTA.label}</Link>
            <Link href="/features" className="sn-btn sn-btn-ghost">What is Six Axes?</Link>
          </div>
        </section>
      </div>

      <NightFooter note="No account, nothing saved. System names are referenced for compatibility only." />
    </main>
  );
}
