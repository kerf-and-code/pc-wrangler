# Six Axes (pc-wrangler)

Six Axes is a tabletop RPG campaign tool by Kerf and Code: session recording and transcription, a
campaign codex and wiki, character builders for several game systems, a shared tabletop, and
play-style analytics (the six axes). This repository holds the web app and the services around it.

## What is where

| Folder | What it is |
| --- | --- |
| `app/` | The Next.js app (App Router). `app/gm/*` are the GM pages, `app/me/*` a player's own pages, share-link player pages (`/recaps`, `/lore`, `/map`, `/chat`, `/vibe`, `/schedule`, `/record`) sit at the top level, `app/api/*` the server routes. |
| `components/` | Shared React components. `components/ui-forge/` is the shared kit (Modal, PageHeader, States, Field, Button); new pages should use it. |
| `lib/` | Rules engines, game-system modules (`lib/systems/`), Supabase clients, theme tokens (`lib/theme.ts`, `lib/forge-theme.ts`) and helpers such as `lib/format.ts`, `lib/confirm.ts` and `lib/friendly-error.ts`. |
| `supabase/migrations/` | Hand-run SQL migrations. Read `supabase/migrations/README.md` before writing or running one. |
| `supabase/checks/` | Read-only SQL checks that go with the migrations. |
| `sidecar/` | The Discord voice-recording bot (Python, py-cord), deployed to Fly.io as `six-axes-sidecar`. |
| `six-axes-capture-extension/` | The Chrome extension that sends D&D Beyond rolls (with Beyond20) to a campaign. |
| `public/foundry/` | The Foundry VTT module. |
| `wrangler-disposition/`, `wrangler-worker/` | The offline R and Stan disposition model and its container. |
| `scripts/` | Build and data scripts (compendium indexes, the guide export). |
| `docs/` | Product docs, including `six-axes-guide.md`, generated from `lib/help-content.mjs`. |
| `tests/` | Vitest tests (`npm test`). |

## Stack

- Next.js 16 with React, TypeScript and `cacheComponents` (pages that read the address need a Suspense boundary).
- Supabase: Postgres with row-level security, auth, storage and realtime.
- Vercel for the web app and its scheduled jobs (`vercel.json`): session reminders, audio retention,
  campaign purge, job advancement and add-on delivery.
- Fly.io for the recording sidecar (`sidecar/fly.toml`).
- Sentry for error reporting, off unless `SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN` is set.

## Working on it

```
npm install
npm run dev
npm test
npm run build
```

Secrets live in `.env.local`, which is never committed. There is one Supabase project and it is
production, so migrations are written to be safe to run twice and are run by hand; the ledger in
`public._migrations` records which have run.

## Conventions

- No em or en dashes in code, copy or docs.
- Dates and times go through `lib/format.ts`; confirms go through `askConfirm` (`lib/confirm.ts`);
  errors shown to people go through `friendlyError` (`lib/friendly-error.ts`).
- Colours come from the theme tokens (`C` in `lib/forge-theme.ts`), not hex literals, so per-system
  theming reaches them. Canvas drawing is the exception, since canvas cannot read CSS variables.
