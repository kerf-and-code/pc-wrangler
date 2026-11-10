"use client";

// components/sentry-client.tsx (push 10, audit T1)
//
// Browser error reporting with @sentry/react (already a dependency, never started until now). Off unless
// NEXT_PUBLIC_SENTRY_DSN is set. Errors only: no performance tracing, no session replay, no personal data.
// Before anything leaves the browser, addresses are scrubbed of share codes, invite codes and query
// strings (a share code opens a table, so it is treated like a password), and click and network
// breadcrumbs are dropped.

import { useEffect } from "react";
import * as Sentry from "@sentry/react";

let started = false;

// /x/<code>, /join/<code>, /claim/<code>, /record?share=..., /c/<slug> stay recognisable as a kind of page
// but lose the part that identifies a table or a person.
export function scrubUrl(u: string | undefined): string | undefined {
  if (!u) return u;
  try {
    const url = new URL(u, "https://six-axes.invalid");
    const path = url.pathname
      .replace(/^\/(x|join|claim|table|journal|recaps|schedule)\/[^/]+/, "/$1/[code]")
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/[id]");
    return (url.host === "six-axes.invalid" ? "" : url.origin) + path;
  } catch {
    return undefined;
  }
}

export function ensureSentry(): void {
  if (started || typeof window === "undefined") return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  started = true;
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeBreadcrumb(b) {
      // Navigation, fetch and click trails carry addresses and screen text; keep console lines only.
      return b.category === "console" ? b : null;
    },
    beforeSend(event) {
      if (event.request) {
        event.request.url = scrubUrl(event.request.url);
        delete event.request.query_string;
        delete event.request.cookies;
        delete event.request.headers;
      }
      if (event.transaction) event.transaction = scrubUrl(event.transaction);
      delete event.user;
      return event;
    },
  });
}

export default function SentryClient() {
  useEffect(() => { ensureSentry(); }, []);
  return null;
}
