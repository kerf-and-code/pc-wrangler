import Link from "next/link";
import { STONE, SAX } from "@/lib/theme";
import { stoneButton } from "@/lib/forge-theme";

// components/site/mobile-menu.tsx
//
// A no-JavaScript mobile nav for the marketing chromes. It is a native <details> disclosure: a
// hamburger button that drops a vertical menu when tapped, with no client state, so it works inside
// the server-rendered SiteShell / ToolsShell / landing header and stays crawlable. It is hidden above
// 620px, where the horizontal desktop nav shows instead; below 620px the desktop nav is hidden and
// this shows. Pass the same links the desktop nav uses, plus the optional primary CTA (the pilot
// button), so the two never drift.

export type NavItem = { href: string; label: string };

export default function MobileMenu({ items, cta }: { items: NavItem[]; cta?: NavItem }) {
  return (
    <details className="sax-mm">
      <summary className="sax-mm-btn" aria-label="Open menu">
        <span className="sax-mm-bars" aria-hidden="true"><span /><span /><span /></span>
      </summary>
      <nav className="sax-mm-panel" aria-label="Site">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className="sax-mm-link">{it.label}</Link>
        ))}
        {cta && (
          <Link
            href={cta.href}
            className="forge-btn is-primary sax-mm-cta"
            style={{ ...stoneButton("primary"), padding: "11px 16px", fontSize: 13 }}
          >
            {cta.label}
          </Link>
        )}
      </nav>
      <style dangerouslySetInnerHTML={{ __html: MM_CSS }} />
    </details>
  );
}

const MM_CSS = `
.sax-mm { display: none; position: relative; }
@media (max-width: 620px) { .sax-mm { display: block; } }
.sax-mm-btn {
  list-style: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 8px; border: 1px solid ${STONE.hi};
  background: linear-gradient(180deg, rgba(40,36,30,0.7), rgba(22,19,15,0.7));
}
.sax-mm-btn::-webkit-details-marker { display: none; }
.sax-mm-btn:focus-visible { outline: 2px solid ${SAX.brass}; outline-offset: 2px; }
.sax-mm-bars { display: inline-block; width: 20px; height: 14px; position: relative; }
.sax-mm-bars span { position: absolute; left: 0; right: 0; height: 2px; border-radius: 2px; background: ${STONE.brassHi}; }
.sax-mm-bars span:nth-child(1) { top: 0; }
.sax-mm-bars span:nth-child(2) { top: 6px; }
.sax-mm-bars span:nth-child(3) { top: 12px; }
.sax-mm[open] .sax-mm-btn { border-color: ${STONE.brassDeep}; }
.sax-mm-panel {
  position: absolute; right: 0; top: calc(100% + 8px); z-index: 50;
  display: flex; flex-direction: column; min-width: 210px; padding: 8px;
  border-radius: 10px; border: 1px solid ${STONE.mortar};
  background: linear-gradient(180deg, rgba(24,20,15,0.98), rgba(14,11,8,0.98));
  box-shadow: 0 10px 26px rgba(0,0,0,0.6);
}
.sax-mm-link {
  font-family: ${SAX.mono}; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase;
  color: ${STONE.inkDim}; text-decoration: none; padding: 11px 12px; border-radius: 6px;
}
.sax-mm-link:hover { color: ${STONE.brassHi}; background: rgba(255,235,200,0.05); }
.sax-mm-cta { margin-top: 6px; text-align: center; }
`;
