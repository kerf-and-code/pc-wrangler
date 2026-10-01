import { FORGE_BUTTON_CSS } from "@/lib/forge-theme";
import { NIGHT_CLASS, NIGHT_CSS } from "@/lib/marketing/night-theme";
import { NightHeader, NightFooter } from "@/components/site/night-chrome";
import Reveal from "@/components/home/reveal";

// components/site/site-shell.tsx
//
// The shared chrome for the marketing site's inner pages (pricing, contact, about, faq, features, for
// players, guides, pilot, foundry): the night-palette top bar, page heading and footer, on the home
// page's column geometry so every page reads as one site. The root carries NIGHT_CLASS, which re-maps
// the app's theme variables, so page bodies built from SAX / STONE / stonePanel / stoneButton re-tone.
//
// layout: "narrow" (default) caps the content at 1040px, left-aligned to the header, for forms and
// short pages. "wide" gives the page the full column, for pages that use .sn-split or their own grid.
// ctaHref: overrides the header's pilot button target (the pilot page points it at its own form).
// Server component (static nav, no client state).

export default function SiteShell({
  title,
  tagline,
  layout = "narrow",
  ctaHref,
  children,
}: {
  title: string;
  tagline?: string;
  layout?: "narrow" | "wide";
  ctaHref?: string;
  children: React.ReactNode;
}) {
  return (
    <main className={NIGHT_CLASS}>
      <style dangerouslySetInnerHTML={{ __html: FORGE_BUTTON_CSS + NIGHT_CSS }} />
      <Reveal root=".sax-night" jsClass="sn-js" />
      <a href="#content" className="sn-skip">Skip to content</a>
      <NightHeader ctaHref={ctaHref} />

      <div className="sn-wrap sn-body" id="content">
        <div className={`sn-main${layout === "narrow" ? " is-narrow" : ""}`}>
          <header className="sn-head" data-reveal>
            <h1 className="sn-h1">{title}</h1>
            {tagline && <p className="sn-lead">{tagline}</p>}
          </header>
          {children}
        </div>
      </div>

      <NightFooter />
    </main>
  );
}
