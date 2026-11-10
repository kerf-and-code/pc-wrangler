// lib/sentry-server.ts (push 10, audit T1)
//
// Server-side error reporting to Sentry, with no SDK: one HTTP POST of a Sentry "envelope" to the
// project's ingest address. That keeps the server bundle and the build exactly as they were, and means
// nothing new to install. The browser side uses the @sentry/react package that was already a dependency
// (components/sentry-client.tsx).
//
// Off unless SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN) is set. Never throws, waits at most 3 seconds, and
// sends no personal data: no cookies, headers, IP or request body, and addresses are reduced to the route
// pattern (/x/[code], never the code itself), because share codes are as good as a password to a table.

type Level = "error" | "warning" | "info";

type Dsn = { key: string; host: string; project: string; raw: string };

function parseDsn(): Dsn | null {
  const raw = (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || "").trim();
  const m = /^https:\/\/([^@/]+)@([^/]+)\/(\d+)$/.exec(raw);
  return m ? { key: m[1], host: m[2], project: m[3], raw } : null;
}

function eventId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// "    at fn (/var/task/.next/server/app/x.js:12:34)" -> a Sentry frame. Newest call last, as Sentry wants.
function framesOf(stack: string | undefined) {
  if (!stack) return undefined;
  const frames = stack.split("\n").slice(1, 40).map((line) => {
    const m = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
    return m ? { function: m[1] || "?", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]), in_app: !m[2].includes("node_modules") } : null;
  }).filter((f): f is NonNullable<typeof f> => f !== null);
  return frames.length ? { frames: frames.reverse() } : undefined;
}

async function send(event: Record<string, unknown>): Promise<void> {
  const dsn = parseDsn();
  if (!dsn) return;
  const id = eventId();
  const body = [
    JSON.stringify({ event_id: id, dsn: dsn.raw, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify({
      event_id: id,
      timestamp: Date.now() / 1000,
      platform: "node",
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      server_name: "six-axes",
      ...event,
    }),
  ].join("\n");
  try {
    await fetch(`https://${dsn.host}/api/${dsn.project}/envelope/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=six-axes-server/1.0`,
      },
      body,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // reporting must never break the thing it reports on
  }
}

/** An exception, with where it happened (a route pattern, never a filled-in address). */
export async function reportError(err: unknown, where: { route?: string; kind?: string; source?: string } = {}): Promise<void> {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "non-error thrown");
  await send({
    level: "error",
    exception: { values: [{ type: e.name || "Error", value: e.message.slice(0, 2000), stacktrace: framesOf(e.stack) }] },
    transaction: where.route,
    tags: { route: where.route ?? "unknown", kind: where.kind ?? "server", source: where.source ?? "next" },
  });
}

/** A message, used by opsAlert so every alert also lands in Sentry. */
export async function reportMessage(source: string, message: string, level: Level = "warning", extra?: string): Promise<void> {
  await send({
    level,
    message: { formatted: `${source}: ${message}`.slice(0, 2000) },
    tags: { source },
    extra: extra ? { detail: extra.slice(0, 4000) } : undefined,
  });
}
