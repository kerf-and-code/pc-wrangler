# Game night runbook

Push 50 (audit round 2, T19). One page for whoever is keeping Six Axes running on a game night,
written so it works for someone other than Terry. Nothing here needs code.

## The pieces

| Piece | Where it runs | What breaks without it |
|---|---|---|
| The web app (pages, sign-in, tabletop) | Vercel, project pc-wrangler | Everything people see |
| The database and files | Supabase | Everything |
| The voice bot (Discord recording) | Fly.io, app `six-axes-sidecar` | /record and /stop in Discord |
| Scheduled jobs (reminders, transcription hand-off, webhooks, clean-up) | Vercel Cron, listed in `vercel.json` | Recordings sit at "draft", no reminders |
| Ops alerts | A private Discord channel (the `OPS_ALERT_WEBHOOK` setting on Vercel and on Fly) | You find out from players instead |

## Before the session (five minutes)

1. Open `https://pc-wrangler.vercel.app/api/cron/health`. It should say `"ok":true`. A list under
   `late` names a scheduled job that has stopped; see "Scheduled jobs" below.
2. Check the voice bot is up: `fly status -a six-axes-sidecar` should show a machine `started`.
3. Glance at the ops channel for anything since the last session.
4. The GM opens **Tonight** (`/gm/tonight`) for their campaign and starts the session there.

## During the session

**The bot does not answer /record.** It posts in the campaign's linked channel for every outcome; if
nothing appears within a minute:
- The person who ran /record must be in a voice channel. The bot says so if they are not.
- `fly logs -a six-axes-sidecar` shows what it is doing. `poll alive` lines every minute mean it is
  running.
- Restart it: `fly machine restart -a six-axes-sidecar`. Since push 50 a restart keeps what was
  already recorded: the bot rejoins, says so in the channel, and carries on. Only the last minute or
  so before the restart and the restart itself are missing.

**Do not deploy the bot during a session** unless it is broken. A deploy is a restart (see above).

**Rolls are not arriving.** Check the player's extension popup shows the campaign code, and that the
session was started (a roll only lands in a session that is open). Insight, Mechanics shows what
arrived and where it went.

**The tabletop is stuck for one person.** Reload that person's page. Everyone else is unaffected.

## After the session

1. The GM runs /stop in Discord (or the bot stops on its own, by default ten minutes after the voice channel
   empties). It posts a summary.
2. The recording becomes a transcript and then a recap on its own, through the every-minute job. If
   the GM's Sessions page still shows it waiting after half an hour, check `/api/cron/health`.
3. The GM ends the session on Tonight or Sessions. A session left open collects rolls from that
   player's other games (it stops doing so after 18 hours).

## Scheduled jobs

Each job stamps its runs in the `cron_runs` table. The every-minute job alerts the ops channel when
another job is late, and `/api/cron/health` answers 503 with the late ones.

- One job late: open Vercel, the project, **Settings**, **Cron Jobs**, which lists each job with a way to run it by hand. Its logs are
  under **Logs**, filtered by its path (`/api/cron/<name>`).
- Everything late: the scheduler itself stopped, or the latest deploy failed. Check Vercel's
  deployments first.
- To be told even when the whole app is down, point an outside uptime monitor (any free one that can
  alert on a non-200 answer) at `/api/cron/health`, checking every five minutes. Nothing inside the
  app can report its own scheduler stopping.

## When the database is the problem

`docs/backup-and-restore.md`. Do not restore anything during a session: a restore replaces the whole
database, including everything people did since the backup.

## Who can do what

| Task | Needs |
|---|---|
| Restart or read logs for the voice bot | A Fly account in the Kerf and Code organisation, and `flyctl` |
| Run a scheduled job by hand, read app logs | Access to the Vercel project |
| Run a check query | Access to the Supabase project (SQL editor) |
| Anything that changes code | Terry |
