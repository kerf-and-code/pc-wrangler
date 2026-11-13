// lib/docs-files.ts (push 54, 2026-11-12)
//
// The six Six Axes documents, built by scripts/build-docs (npm run docs) into public/docs as a Word file
// and a PDF each. The GM Help page (/gm/help) lists all six; the player Help page (/me/help) lists the two
// written for players. /docs is open to logged-out visitors (lib/supabase/proxy.ts), so a guest player
// and a GM forwarding a link both reach the files.
//
// Add a document here and in scripts/build-docs/build.mjs together: the slug is the file name.

export type DocFile = { slug: string; title: string; blurb: string; forPlayers: boolean };

export const DOC_FILES: DocFile[] = [
  {
    slug: "six-axes-gm-onboarding", forPlayers: false,
    title: "GM Onboarding",
    blurb: "From an empty account to your first recorded, reviewed session. About twenty minutes. Start here.",
  },
  {
    slug: "six-axes-first-two-sessions", forPlayers: false,
    title: "Your First Two Sessions",
    blurb: "What happens, in order, on the first two nights. Keep it open on a second screen.",
  },
  {
    slug: "six-axes-gm-quick-card", forPlayers: false,
    title: "GM Quick Card",
    blurb: "Everything for game night on one page.",
  },
  {
    slug: "six-axes-owners-manual", forPlayers: false,
    title: "The Owner's Manual",
    blurb: "Every page: where it is, what it does, how to use it and why it is there.",
  },
  {
    slug: "six-axes-player-guide", forPlayers: true,
    title: "Player Guide",
    blurb: "Claiming a character, getting rolls to the table, the tabletop, and your data. Send it to your players.",
  },
  {
    slug: "six-axes-player-quick-card", forPlayers: true,
    title: "Player Quick Card",
    blurb: "The player's setup and the table, on one page.",
  },
];

export const docHref = (slug: string, ext: "pdf" | "docx") => `/docs/${slug}.${ext}`;
