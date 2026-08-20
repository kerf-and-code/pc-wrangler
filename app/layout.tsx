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
import JsonLd from "@/components/json-ld";
import { organizationSchema, websiteSchema } from "@/lib/seo";
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
  // Favicon and social image come from Next's FILE conventions, not from here: app/icon.png +
  // app/favicon.ico are the tab icon, and app/opengraph-image.png + app/twitter-image.png are the
  // 1200x630 link-preview banner. Declaring icons/og images in metadata as well would double the tags
  // and (for the icon) point a heavyweight PNG at the tab, so this block only carries the text bits and
  // the large-image card type. Every page inherits this unless it sets its own openGraph.
  openGraph: {
    type: "website",
    siteName: "Six Axes",
  },
  twitter: {
    card: "summary_large_image",
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
        {/* Sitewide entity graph: Organization + WebSite. Product/FAQ/breadcrumb schema is added
            per-page (home, /faq, /tools/*). */}
        <JsonLd data={[organizationSchema(), websiteSchema()]} />
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
