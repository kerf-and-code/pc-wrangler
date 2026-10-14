import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";
import SystemThemeProvider from "@/components/system-theme-provider";
import SystemEffects from "@/components/system-effects";
import JsonLd from "@/components/json-ld";
import { organizationSchema, websiteSchema } from "@/lib/seo";
import Script from "next/script";
import "./globals.css";

// Google Analytics 4 measurement ID. A measurement ID is public (it ships in the page), so hard-coding
// it here is fine. Loaded only in production (below) so local dev and the build don't send hits.
const GA_ID = "G-Q8DMBRWQPM";

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
  applicationName: "Six Axes",
  creator: "Kerf and Code",
  publisher: "Kerf and Code",
  // Explicit, though index/follow is already the default. Per-page noindex (e.g. gated /gm, /me) is
  // handled by the middleware redirect, so those never reach a crawler in the first place.
  robots: { index: true, follow: true },
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

// Next 16 moves themeColor/colorScheme out of `metadata` into a `viewport` export. Matches the dark
// forge wall so the mobile browser chrome doesn't flash white.
export const viewport: Viewport = {
  themeColor: "#14110d",
  colorScheme: "dark",
};

// EVERY FONT IS SELF-HOSTED from app/fonts with next/font/local. Nothing is fetched from Google at
// build time any more.
//
// Why: since Oct 2026 Google serves some faces from "fonts.gstatic.com/l/font?k=..." addresses (a URL
// with its own query string), and Next 16.2.9's Google font loader rejects them ("next/font/google
// queries have exactly one entry"). It hit Cinzel first, then Source Sans 3 once Cinzel was moved, so
// it is not one font: any Google face can flip to that address form and fail the production build.
// Bundling all of them removes the network dependency for good and makes builds reproducible.
//
// Files are the Latin WOFF2 from Fontsource 5.3.x (@fontsource/* and @fontsource-variable/geist), the
// same weights each face requested before, with each font's license beside it (*-OFL.txt /
// *-LICENSE.txt). The CSS variables are unchanged, so lib/systems/system-theme.ts and every theme that
// reads them are untouched. adjustFontFallback picks the metric fallback by category: serif faces use
// Times New Roman, sans and mono faces keep the default (Arial), matching what the Google loader did.
//
// They are attached to <html> (below) so the theme variables in lib/systems/system-theme.ts, which the
// provider sets on <html> per active campaign, can reference them (a variable must be defined on the
// element that reads it or an ancestor). Each system's --forge-display / --forge-body / --forge-mono
// points at the right one; unthemed D&D uses Cinzel + the system serif exactly as before.
const geistSans = localFont({
  src: "./fonts/geist-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-geist-sans",
  display: "swap",
});
const cinzel = localFont({
  src: [
    { path: "./fonts/cinzel-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/cinzel-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-cinzel",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});
const cinzelDec = localFont({
  src: [{ path: "./fonts/cinzel-decorative-latin-700-normal.woff2", weight: "700", style: "normal" }],
  variable: "--font-cinzel-dec",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});
const oswald = localFont({
  src: [
    { path: "./fonts/oswald-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/oswald-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-oswald",
  display: "swap",
});
const chakra = localFont({
  src: [
    { path: "./fonts/chakra-petch-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/chakra-petch-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-chakra",
  display: "swap",
});
const marcellus = localFont({
  src: [{ path: "./fonts/marcellus-latin-400-normal.woff2", weight: "400", style: "normal" }],
  variable: "--font-marcellus",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});
const specialElite = localFont({
  src: [{ path: "./fonts/special-elite-latin-400-normal.woff2", weight: "400", style: "normal" }],
  variable: "--font-special-elite",
  display: "swap",
});
const pirata = localFont({
  src: [{ path: "./fonts/pirata-one-latin-400-normal.woff2", weight: "400", style: "normal" }],
  variable: "--font-pirata",
  display: "swap",
});
const garamond = localFont({
  src: [
    { path: "./fonts/eb-garamond-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/eb-garamond-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/eb-garamond-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/eb-garamond-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-garamond",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});
// The marketing home page's body face (palette C, Oct 2026): a plain humanist sans under EB Garamond headlines.
const sourceSans = localFont({
  src: [
    { path: "./fonts/source-sans-3-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/source-sans-3-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/source-sans-3-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-source-sans",
  display: "swap",
});
const courierPrime = localFont({
  src: [
    { path: "./fonts/courier-prime-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/courier-prime-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-courier-prime",
  display: "swap",
});
const imFell = localFont({
  src: [{ path: "./fonts/im-fell-english-latin-400-normal.woff2", weight: "400", style: "normal" }],
  variable: "--font-imfell",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});
const jetbrains = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jetbrains-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-jetbrains",
  display: "swap",
});

const fontVars = [
  geistSans.variable, cinzel.variable, cinzelDec.variable, oswald.variable, chakra.variable,
  marcellus.variable, specialElite.variable, pirata.variable, garamond.variable,
  courierPrime.variable, imFell.variable, jetbrains.variable, sourceSans.variable,
].join(" ");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={fontVars} suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        {/* Google Analytics 4. afterInteractive loads gtag once the page is interactive so it never
            blocks first paint; it fires a pageview on load and, because Next's App Router does client
            navigation, GA's SPA page_view tracking follows route changes automatically. Production only,
            so preview builds and local dev do not skew the numbers. */}
        {process.env.NODE_ENV === "production" && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
            <Script id="ga4-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
            </Script>
          </>
        )}
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
