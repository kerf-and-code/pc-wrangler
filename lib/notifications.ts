import { formatSessionTime } from "@/lib/email/time";

// lib/notifications.ts (2026-11-10, push 19)
//
// Shared pieces for the bell (components/notification-bell.tsx) and the daily digest
// (app/api/cron/notification-digest). The rows are written by database triggers (p150); the title is
// already a full sentence, so this only adds the session time where there is one and builds the email.

export type NotificationKind =
  | "session_scheduled" | "session_moved" | "session_cancelled" | "recap_sent"
  | "rsvp" | "player_joined" | "review_ready" | "processing_failed"
  | "cogm_joined" | "cogm_left" | "cogm_removed";

export type NotificationRow = {
  id: number;
  kind: NotificationKind;
  title: string;
  link: string | null;
  data: { scheduled_at?: string | null; time_zone?: string | null; [k: string]: unknown } | null;
  created_at: string;
  read_at?: string | null;
};

/** Kinds that carry a session time worth printing next to the title. */
const TIMED: NotificationKind[] = ["session_scheduled", "session_moved"];

/** The session time for a notification, in the campaign's time zone, or null. */
export function notificationWhen(n: Pick<NotificationRow, "kind" | "data">): string | null {
  if (!TIMED.includes(n.kind)) return null;
  const at = n.data?.scheduled_at;
  if (!at || typeof at !== "string") return null;
  return formatSessionTime(at, n.data?.time_zone ?? null);
}

/** A link from a row, made absolute for email. Only same-site paths are ever stored (p150 checks it). */
export function absoluteLink(origin: string, link: string | null): string {
  const base = origin.replace(/\/$/, "");
  return link && link.startsWith("/") && !link.startsWith("//") ? `${base}${link}` : `${base}/me`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** The digest email: one line per notification, newest first, at most 25 (the rest are counted). */
export function digestEmail(items: NotificationRow[], origin: string, unsubscribe: string): { subject: string; html: string; text: string } {
  const shown = items.slice(0, 25);
  const more = items.length - shown.length;
  const subject = items.length === 1 ? `Six Axes: ${items[0].title}` : `Six Axes: ${items.length} updates from your tables`;
  const rows = shown.map((n) => {
    const when = notificationWhen(n);
    return `<li style="margin:0 0 12px;line-height:1.55;"><a href="${esc(absoluteLink(origin, n.link))}" style="color:#1c1a22;text-decoration:underline;">${esc(n.title)}</a>${when ? `<br/><span style="color:#6b6577;font-size:13px;">${esc(when)}</span>` : ""}</li>`;
  }).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;padding:24px;font-family:Georgia,serif;">
  <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e3dbc9;border-radius:12px;padding:28px 30px;">
    <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9a7b2e;margin-bottom:6px;">Your daily digest</div>
    <div style="font-size:20px;font-weight:700;color:#1c1a22;margin-bottom:16px;">What happened at your tables</div>
    <ul style="margin:0;padding:0 0 0 18px;color:#23202b;">${rows}</ul>
    ${more > 0 ? `<p style="margin:6px 0 0;color:#6b6577;">And ${more} more.</p>` : ""}
    <p style="margin:18px 0 0;"><a href="${esc(origin.replace(/\/$/, ""))}/me" style="display:inline-block;background:#9a7b2e;color:#fffdf8;text-decoration:none;padding:10px 16px;border-radius:8px;font-family:Arial,sans-serif;font-size:14px;">Open Six Axes</a></p>
  </div>
  <div style="max-width:560px;margin:14px auto 0;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#8a8597;line-height:1.5;">
    You turned on the daily digest in your Six Axes settings. Items you already read in the app are left out.<br/>
    <a href="${esc(unsubscribe)}" style="color:#8a8597;">Stop the daily digest</a>
  </div>
</body></html>`;
  const text = [
    "What happened at your tables:",
    "",
    ...shown.map((n) => { const when = notificationWhen(n); return `- ${n.title}${when ? ` (${when})` : ""}\n  ${absoluteLink(origin, n.link)}`; }),
    ...(more > 0 ? [`And ${more} more.`] : []),
    "",
    `Stop the daily digest: ${unsubscribe}`,
  ].join("\n");
  return { subject, html, text };
}
