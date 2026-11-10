import type { Instrumentation } from "next";

// instrumentation.ts (push 10, audit T1)
//
// Next.js calls onRequestError for every uncaught error on the server: route handlers, server
// components, server actions, the proxy. It goes to Sentry (lib/sentry-server.ts) when a DSN is set,
// with the route PATTERN only (/x/[code], never the code), and nothing about the person or request.

export const onRequestError: Instrumentation.onRequestError = async (err, _request, context) => {
  const { reportError } = await import("@/lib/sentry-server");
  await reportError(err, { route: context.routePath, kind: context.routeType, source: "next" });
};
