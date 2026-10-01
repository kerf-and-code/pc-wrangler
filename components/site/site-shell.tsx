import { FORGE_BUTTON_CSS } from "@/lib/forge-theme";
import { NIGHT_CLASS, NIGHT_CSS } from "@/lib/marketing/night-theme";
import { NightHeader, NightFooter } from "@/components/site/night-chrome";
import { SITE_NAV } from "@/lib/marketing/nav";

// components/site/site-shell.tsx
//
// The shared chrome for the marketing site's inner pages (pricing, contact, about, faq, features, for
// players, guides, pilot, foundry): the night-palette top bar, page heading and footer, matching the
// home page so every page reads as one site. The root carries NIGHT_CLASS, which re-maps the app's theme
// variables, so page bodies built from SAX / STONE / stonePanel / stoneButton re-tone with no edits.
// Server component (static nav, no client state).

export default function SiteShell({
  title,
  tagline,
  children,
}: {
  title: string;
  tagline?: string;
  children: React.ReactNode;
}) {
  return (
    <main className={NIGHT_CLASS}>
      <style dangerouslySetInnerHTML={{ __html: FORGE_BUTTON_CSS + NIGHT_CSS }} />
      <NightHeader items={SITE_NAV} />

      <div className="sn-body">
        <header className="sn-head">
          <h1 className="sn-h1">{title}</h1>
          {tagline && <p className="sn-lead">{tagline}</p>}
        </header>
        {children}
      </div>

      <NightFooter />
    </main>
  );
}
