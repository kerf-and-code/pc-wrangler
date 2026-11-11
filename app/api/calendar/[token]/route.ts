import { createClient } from "@supabase/supabase-js";

// app/api/calendar/[token]/route.ts (push 16, audit F8)
//
// GET /api/calendar/<token>.ics: a private calendar feed of every scheduled session in the campaigns
// this account plays in or runs. Calendar apps (Google, Apple, Outlook) subscribe to it and refresh it
// on their own, so it is public and cookie-free; the random token in the address is the only key,
// checked by calendar_feed() (p147) and replaced from Your campaigns. Sessions have no length in the
// app, so each event is given three hours.

// No `export const dynamic`: this project runs with cacheComponents on, which rejects it. A GET handler
// that reads its params and the network is dynamic already.

const SESSION_HOURS = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { session_id: string; campaign_id: string; campaign_name: string; session_number: number | null; scheduled_at: string; status: string; is_gm: boolean };

// RFC 5545: escape \ ; , and newlines in text, and fold lines longer than 75 octets.
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");
  if (!UUID.test(token)) return new Response("Not found", { status: 404 });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("calendar_feed", { p_token: token });
  if (error) return new Response("Could not read the calendar", { status: 500 });

  const origin = new URL(req.url).origin;
  const now = stamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kerf and Code//Six Axes//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Six Axes sessions",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const r of (data as Row[] | null) ?? []) {
    const start = new Date(r.scheduled_at);
    const end = new Date(start.getTime() + SESSION_HOURS * 3600 * 1000);
    const title = `${r.campaign_name}${r.session_number != null ? `: session ${r.session_number}` : ""}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.session_id}@six-axes`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      fold(`SUMMARY:${esc(title)}`),
      fold(`DESCRIPTION:${esc(r.is_gm ? "You are running this session." : "Your table on Six Axes.")}`),
      fold(`URL:${origin}/me/campaigns`),
      "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="six-axes.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
}
