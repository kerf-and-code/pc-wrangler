import Link from "next/link";
import { FORGE_BUTTON_CSS } from "@/lib/forge-theme";
import { NIGHT_CLASS, NIGHT_CSS } from "@/lib/marketing/night-theme";
import { NightHeader, NightFooter } from "@/components/site/night-chrome";
import Reveal from "@/components/home/reveal";
import { PILOT_CTA } from "@/lib/marketing/nav";

// components/tools-shell.tsx
//
// The shared frame every free tool sits in. No auth, no database, no account: these pages exist to be
// found in search and used on the spot, then to point the visitor toward the pilot.
//
// REGISTER (2026-10): the night palette and the home page's column geometry. The root carries
// NIGHT_CLASS, which re-maps the app's theme variables, so each tool body re-tones; shared tool
// components opt into the night type and control styles with .fx-* classes, which do nothing inside the
// signed-in app.
//
// LAYOUT: on a tool page (the default) the children sit in .sn-toolgrid: from 1100px up, the tool takes
// the 60% column and the LAST child (each page's ToolCopy explainer) takes the 40% column beside it, so
// the result and the rules are visible together. Below 1100px they stack. The hub (hideHubLink) lays out
// its own grid at full width.
//
// Every tool passes a title and a one-line tagline; the shell supplies the top bar, the breadcrumb back
// to the hub, the pilot card and the footer, so each tool page only writes its body.

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
  const isHub = !!hideHubLink;
  return (
    <main className={NIGHT_CLASS}>
      <style dangerouslySetInnerHTML={{ __html: FORGE_BUTTON_CSS + NIGHT_CSS }} />
      <Reveal root=".sax-night" jsClass="sn-js" />
      <a href="#content" className="sn-skip">Skip to content</a>
      <NightHeader />

      <div className="sn-wrap sn-body" id="content">
        <div className="sn-main">
          <header className="sn-head" data-reveal>
            {!isHub && (
              <p className="sn-crumb"><Link href="/tools">Free tools</Link> / {title}</p>
            )}
            <h1 className="sn-h1">{title}</h1>
            {tagline && <p className="sn-lead">{tagline}</p>}
          </header>
          <hr className="sn-rule" />

          <div className={isHub ? undefined : "sn-toolgrid"}>{children}</div>

          <section className="sn-card" style={{ marginTop: 56, maxWidth: isHub ? undefined : 1040 }} data-reveal>
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
      </div>

      <NightFooter note="No account, nothing saved. System names are referenced for compatibility only." />
    </main>
  );
}
