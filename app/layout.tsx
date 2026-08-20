import type { Metadata } from "next";
import {
  Geist,
  Cinzel,
  Cinzel_Decorative,
  Oswald,
  Chakra_Petch,
  Marcellus,
  Special_Elite,
  Pirata_One,
  EB_Garamond,
  Courier_Prime,
  IM_Fell_English,
  JetBrains_Mono,
} from "next/font/google";
import { ThemeProvider } from "next-themes";
import SystemThemeProvider from "@/components/system-theme-provider";
import SystemEffects from "@/components/system-effects";
import "./globals.css";

// NEXT_PUBLIC_SITE_URL first, and it matters more than it looks.
//
// metadataBase is what every canonical tag, OpenGraph URL and relative image resolves against.
// VERCEL_URL is the DEPLOYMENT host - a per-build vercel.app address - so once a custom domain is
// pointed here, the pages would serve from six-axes.com while telling search engines the canonical
// copy lives somewhere else. That is the one SEO mistake that actively works against you: it splits
// authority between two hosts and tells Google to prefer the wrong one.
//
// VERCEL_URL stays as the fallback so preview deployments still resolve to themselves.
const defaultUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: {
    default: "Six Axes",
    template: "%s · Six Axes",
  },
  description: "Run the table. Player typing and session analytics for tabletop RPGs.",
  // The tab icon (favicon / home-screen icon): the Six Axes mark, served from /public. Next emits the
  // <link rel="icon"> tags from this. One PNG covers browser tab, bookmark and Apple touch icon.
  icons: {
    icon: "/six-axes-logo.png",
    shortcut: "/six-axes-logo.png",
    apple: "/six-axes-logo.png",
  },
  // Default link-preview card for every page that does not set its own openGraph (features, tools,
  // pricing, etc.). Pages that DO define openGraph (e.g. the home page) must repeat images, because
  // Next merges metadata shallowly and a child openGraph replaces this one wholesale.
  openGraph: {
    type: "website",
    siteName: "Six Axes",
    images: [{ url: "/six-axes-logo.png", alt: "The Six Axes mark" }],
  },
  twitter: {
    card: "summary",
    images: ["/six-axes-logo.png"],
  },
};

const geistSans = Geist({ variable: "--font-geist-sans", display: "swap", subsets: ["latin"] });

// Per-system display / body / mono faces, self-hosted by next/font and exposed as CSS variables. They
// are attached to <html> (below) so the theme variables in lib/systems/system-theme.ts, which the
// provider sets on <html> per active campaign, can reference them (a variable must be defined on the
// element that reads it or an ancestor). Each system's --forge-display / --forge-body / --forge-mono
// points at the right one; unthemed D&D uses Cinzel + the system serif exactly as before.
const cinzel = Cinzel({ variable: "--font-cinzel", weight: ["600", "700"], display: "swap", subsets: ["latin"] });
const cinzelDec = Cinzel_Decorative({ variable: "--font-cinzel-dec", weight: ["700"], display: "swap", subsets: ["latin"] });
const oswald = Oswald({ variable: "--font-oswald", weight: ["500", "600"], display: "swap", subsets: ["latin"] });
const chakra = Chakra_Petch({ variable: "--font-chakra", weight: ["500", "700"], display: "swap", subsets: ["latin"] });
const marcellus = Marcellus({ variable: "--font-marcellus", weight: ["400"], display: "swap", subsets: ["latin"] });
const specialElite = Special_Elite({ variable: "--font-special-elite", weight: ["400"], display: "swap", subsets: ["latin"] });
const pirata = Pirata_One({ variable: "--font-pirata", weight: ["400"], display: "swap", subsets: ["latin"] });
const garamond = EB_Garamond({ variable: "--font-garamond", weight: ["400", "600"], display: "swap", subsets: ["latin"] });
const courierPrime = Courier_Prime({ variable: "--font-courier-prime", weight: ["400", "700"], display: "swap", subsets: ["latin"] });
const imFell = IM_Fell_English({ variable: "--font-imfell", weight: ["400"], display: "swap", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", weight: ["400", "500"], display: "swap", subsets: ["latin"] });

const fontVars = [
  geistSans.variable, cinzel.variable, cinzelDec.variable, oswald.variable, chakra.variable,
  marcellus.variable, specialElite.variable, pirata.variable, garamond.variable,
  courierPrime.variable, imFell.variable, jetbrains.variable,
].join(" ");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={fontVars} suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          {/* Applies the active campaign's per-system theme variables directly to <html>. */}
          <SystemThemeProvider />
          {/* Per-system ambient effects (grain / scanlines / sweep / motes / pulse), keyed on data-system. */}
          <SystemEffects />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
