// lib/ops-alert.ts (2026-11-09)
//
// Audit T1: a failure nobody sees is how sessions were lost before (see the advance-jobs header). Server
// jobs call opsAlert when something goes wrong. It always logs, and when OPS_ALERT_WEBHOOK is set (a
// Discord webhook URL for a private channel only you read) it posts there too. It never throws and
// waits at most 4 seconds, so an alert can never break the job that sends it. Keep player names, emails
// and transcript text out of messages: ids and counts only.
//
// Push 10 (audit T1): every alert also goes to Sentry when SENTRY_DSN is set (lib/sentry-server.ts), so
// the dashboard holds the history the Discord channel scrolls away.

import { reportMessage } from "@/lib/sentry-server";

export async function opsAlert(source: string, message: string, detail?: unknown): Promise<void> {
  const extra = detail === undefined ? "" : typeof detail === "string" ? detail : JSON.stringify(detail);
  console.error(`[ops-alert] ${source}: ${message}${extra ? ` ${extra}` : ""}`);
  await reportMessage(source, message, "warning", extra || undefined);
  const hook = process.env.OPS_ALERT_WEBHOOK;
  if (!hook || !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(hook)) return;
  const env = process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown";
  const body = `**${source}** (${env}): ${message}${extra ? `\n\`\`\`\n${extra.slice(0, 1500)}\n\`\`\`` : ""}`;
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: body.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(4000),
    });
  } catch (e) {
    console.error("[ops-alert] could not post the alert:", e instanceof Error ? e.message : e);
  }
}
