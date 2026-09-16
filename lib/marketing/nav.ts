// lib/marketing/nav.ts
//
// Single source of truth for the marketing top-nav links. The landing page, SiteShell, and ToolsShell
// each show a curated subset, but the label and href of every link are defined once here so the three
// navs (and their mobile menus) can never drift apart. Each surface's desktop nav and its MobileMenu
// both read the same array below.

export type NavItem = { href: string; label: string };

const NAV = {
  features: { href: "/features", label: "Features" },
  players: { href: "/players", label: "For players" },
  tools: { href: "/tools", label: "Free tools" },
  guides: { href: "/guides", label: "Guides" },
  pricing: { href: "/pricing", label: "Pricing" },
  contact: { href: "/contact", label: "Contact" },
  enter: { href: "/enter", label: "Enter" },
} as const;

// The primary conversion CTA, shown alongside every nav.
export const PILOT_CTA: NavItem = { href: "/pilot", label: "Join the pilot" };

// Per-surface subsets (unchanged from what each surface showed before; now composed from NAV).
export const LANDING_NAV: NavItem[] = [NAV.features, NAV.players, NAV.tools, NAV.pricing, NAV.enter];
export const SITE_NAV: NavItem[] = [NAV.features, NAV.players, NAV.tools, NAV.guides, NAV.pricing, NAV.contact, NAV.enter];
export const TOOLS_NAV: NavItem[] = [NAV.features, NAV.tools, NAV.pricing, NAV.contact, NAV.enter];
