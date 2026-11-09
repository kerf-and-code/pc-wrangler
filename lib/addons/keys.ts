import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// lib/addons/keys.ts (2026-11-09)
//
// Phase 6b (p131): add-on keys and webhook signatures. Server only.
//
// A key is "sxa_" and 32 url-safe characters (24 random bytes). Only its SHA-256 is stored, with the
// first 10 characters kept so the GM can tell keys apart. A webhook is signed the way Stripe signs:
// X-SixAxes-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the hook's secret>.

export const KEY_RE = /^sxa_[A-Za-z0-9_-]{32}$/;
export const SCOPES = ["read", "chat", "roll"] as const;
export type Scope = (typeof SCOPES)[number];
export const EVENTS = ["roll", "chat", "turn", "combat"] as const;
export type HookEvent = (typeof EVENTS)[number];

export function makeKey(): { token: string; prefix: string; hash: string } {
  const token = `sxa_${randomBytes(24).toString("base64url")}`;
  return { token, prefix: token.slice(0, 10), hash: hashKey(token) };
}
export const hashKey = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
export const makeSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;

export function signature(secret: string, t: number, body: string): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex")}`;
}

/** What a receiver does: checks the signature and that it is fresh (default 5 minutes). */
export function verifySignature(secret: string, header: string, body: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t), v1 = parts.v1;
  if (!Number.isFinite(t) || !v1 || Math.abs(nowSec - t) > toleranceSec) return false;
  const want = Buffer.from(signature(secret, t, body).split("v1=")[1], "hex"), got = Buffer.from(v1, "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}
