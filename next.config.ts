import type { NextConfig } from "next";

// Security headers on every response (audit L-T2, push 7).
//
// frame-ancestors 'self' and X-Frame-Options stop other sites from framing Six Axes, so a GM cannot be
// tricked into clicking a hidden button (clickjacking). Nothing frames the app from another origin
// today: the Foundry module and the capture extension talk to the API, they do not embed pages.
// base-uri and object-src close two old injection routes without touching scripts or styles.
//
// A full script and connect policy is deliberately NOT enforced here: Next.js inline scripts would need
// per-request nonces, which conflicts with cacheComponents, and a wrong policy would break every page.
// That is a separate, tested change.
//
// microphone stays allowed for this site (recording and the voice compendium use it); camera and
// location are never used, so they are turned off.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

// The Discord Activity (push 34, audit P7) is the one page another site frames: Discord shows it in an
// iframe on <app id>.discordsays.com and forwards the requests here. Discord's first load carries a
// frame_id in the query (proxy.ts sends it to /activity), so only a request with frame_id may be framed,
// and only by Discord. Every other response keeps SECURITY_HEADERS. The page's own scripts, styles and
// API calls carry no frame_id, which is fine: only the document's headers decide framing.
const DISCORD_FRAME_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com https://discordapp.com https://*.discordapp.com; base-uri 'self'; object-src 'none'" },
  ...SECURITY_HEADERS.filter((h) => h.key !== "Content-Security-Policy" && h.key !== "X-Frame-Options"),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  async headers() {
    return [
      { source: "/:path*", missing: [{ type: "query", key: "frame_id" }], headers: SECURITY_HEADERS },
      { source: "/:path*", has: [{ type: "query", key: "frame_id" }], headers: DISCORD_FRAME_HEADERS },
    ];
  },
  async redirects() {
    return [
      // the free background remover was retired (2026-11-08); the token maker does the same job for
      // tokens, so old links and search results land there instead of a 404 (audit A9)
      { source: "/tools/background-remover", destination: "/tools/token-maker", permanent: true },
    ];
  },
};

export default nextConfig;
