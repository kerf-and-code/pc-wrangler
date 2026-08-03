import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
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
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
