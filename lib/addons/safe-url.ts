import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// lib/addons/safe-url.ts (2026-11-09)
//
// Phase 6b (p131): where the server may send a webhook. Only https on the normal port, to a name or
// address on the public internet: never this machine, a private network, link-local addresses (cloud
// metadata lives at 169.254.169.254), or anything that resolves to one. Checked when a hook is saved
// and again before every send, since what a name points at can change. A name that is switched to a
// private address between the check and the send could still slip through once; the requests carry
// no credentials and their replies are thrown away, which keeps that window harmless.

const BAD_SUFFIX = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];

/** Whether an IP address is somewhere a webhook must never go. */
export function privateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s) ?? /^::(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return privateIp(mapped[1]);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(s)) {
      const [hi, lo] = s.slice(7).split(":").map((h) => parseInt(h, 16));
      return privateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("100::") || s.startsWith("2001:db8");
  }
  return true;
}

/** Why this address cannot take webhooks, or null when it looks fine (without looking the name up). */
export function hookUrlProblem(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return "That is not a web address."; }
  if (u.protocol !== "https:") return "Webhooks go to https addresses only.";
  if (u.username || u.password) return "Leave the user name and password out of the address.";
  if (u.port && u.port !== "443") return "Webhooks go to the normal https port (443).";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return "That address has no host.";
  if (raw.length > 500) return "That address is too long.";
  if (isIP(host)) return privateIp(host) ? "That address is on a private network." : null;
  if (host === "localhost" || BAD_SUFFIX.some((s) => host.endsWith(s)) || !host.includes(".")) return "That address is on a private network.";
  return null;
}

/** hookUrlProblem, then the name looked up: every address it gives must be public. */
export async function hookUrlUnsafe(raw: string): Promise<string | null> {
  const p = hookUrlProblem(raw);
  if (p) return p;
  const host = new URL(raw.trim()).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return null;
  try {
    const all = await lookup(host, { all: true, verbatim: true });
    if (!all.length) return "That address does not exist.";
    if (all.some((a) => privateIp(a.address))) return "That address points at a private network.";
    return null;
  } catch {
    return "That address could not be found.";
  }
}
