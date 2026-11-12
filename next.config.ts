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
// frame_id in the query (proxy.ts sends it to /activity), so only the root or /activity with frame_id
// may be framed, and only by Discord (push 41: no other path, whatever its query). Every other response keeps SECURITY_HEADERS. The page's own scripts, styles and
// API calls carry no frame_id, which is fine: only the document's headers decide framing.
const DISCORD_FRAME_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com https://discordapp.com https://*.discordapp.com; base-uri 'self'; object-src 'none'" },
  ...SECURITY_HEADERS.filter((h) => h.key !== "Content-Security-Policy" && h.key !== "X-Frame-Options"),
];

const FRAME_ID = [{ type: "query" as const, key: "frame_id" }];
export const FRAME_RULES = [
  // every path except the two Activity addresses: never framed by another site
  { source: "/:path((?!activity$).+)", headers: SECURITY_HEADERS },
  // the root and /activity: framed by Discord only when Discord's frame_id is there
  { source: "/", missing: FRAME_ID, headers: SECURITY_HEADERS },
  { source: "/activity", missing: FRAME_ID, headers: SECURITY_HEADERS },
  { source: "/", has: FRAME_ID, headers: DISCORD_FRAME_HEADERS },
  { source: "/activity", has: FRAME_ID, headers: DISCORD_FRAME_HEADERS },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Next 16.4 (push 34.5) asks every Cache Components app to choose. false keeps prefetching as it has
  // been on 16.2; turning it on changes what a link prefetches and is its own tested change.
  partialPrefetching: false,
  // Audit round 2, B12 (push 41): the Discord rule used to apply to every path with a frame_id, so any
  // page (a GM page included) could be framed by any Discord app by adding ?frame_id=. Now only the two
  // addresses the Activity actually loads (the root, which proxy.ts rewrites, and /activity) may be
  // framed, and every other path keeps SECURITY_HEADERS whatever its query. The rules are exported as
  // FRAME_RULES so tests/frame-headers.test.ts can check them.
  async headers() {
    return FRAME_RULES;
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
