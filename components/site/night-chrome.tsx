import Link from "next/link";
import MobileMenu from "@/components/site/mobile-menu";
import { PILOT_CTA, type NavItem } from "@/lib/marketing/nav";

// components/site/night-chrome.tsx
//
// The top bar and footer shared by SiteShell and ToolsShell, in the night palette. The markup mirrors
// the home page's header and footer (app/page.tsx) so a visitor moving from the home page to any inner
// page or tool sees the same chrome. Styles live in NIGHT_CSS (lib/marketing/night-theme.ts), which the
// shell injects once. Server components, no client state.

export function NightHeader({ items }: { items: NavItem[] }) {
  return (
    <header className="sn-top">
      <div className="sn-wrap sn-top-in">
        <div className="sn-brandwrap">
          <Link href="/" className="sn-brand">
            <img src="/six-axes-mark-60.png" alt="" width={30} height={30} className="sn-mark" aria-hidden />
            <span>Six Axes</span>
          </Link>
          <a href="https://kerfandcode.com" target="_blank" rel="noopener noreferrer" className="sn-by">by Kerf and Code &#8599;</a>
        </div>
        <nav className="sn-nav" aria-label="Main">
          {items.map((it) => (
            <Link key={it.href} href={it.href} className="sn-navlink">{it.label}</Link>
          ))}
          <Link href={PILOT_CTA.href} className="sn-btn sn-btn-fill sn-btn-sm">{PILOT_CTA.label}</Link>
        </nav>
        <MobileMenu items={items} cta={PILOT_CTA} />
      </div>
    </header>
  );
}

const FOOT_LINKS: NavItem[] = [
  { href: "/features", label: "Features" },
  { href: "/players", label: "For players" },
  { href: "/tools", label: "Free tools" },
  { href: "/guides", label: "Guides" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/licenses", label: "Licenses" },
];

export function NightFooter({ note }: { note?: string }) {
  return (
    <footer className="sn-foot">
      {note && <div className="sn-wrap"><p className="sn-foot-note">{note}</p></div>}
      <div className="sn-wrap sn-foot-in">
        <span>Six Axes is made by <a href="https://kerfandcode.com" target="_blank" rel="noopener noreferrer" className="sn-foot-maker">Kerf and Code &#8599;</a>, a studio building other tools too.</span>
        <span className="sn-foot-links">
          {FOOT_LINKS.map((it) => (
            <Link key={it.href} href={it.href}>{it.label}</Link>
          ))}
        </span>
      </div>
    </footer>
  );
}
