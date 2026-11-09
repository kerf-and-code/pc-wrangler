import { describe, expect, it } from "vitest";
import { KEY_RE, hashKey, makeKey, makeSecret, signature, verifySignature } from "@/lib/addons/keys";
import { hookUrlProblem, privateIp } from "@/lib/addons/safe-url";

// Phase 6b: add-on keys, webhook signatures, and where webhooks may go.
describe("keys", () => {
  it("makes keys of the right shape, storing only a hash", () => {
    const k = makeKey();
    expect(k.token).toMatch(KEY_RE);
    expect(k.prefix).toBe(k.token.slice(0, 10));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.hash).toBe(hashKey(k.token));
    expect(makeKey().token).not.toBe(k.token);
    expect(makeSecret().length).toBeGreaterThanOrEqual(32);
  });
});

describe("signatures", () => {
  const secret = "whsec_test", body = JSON.stringify({ id: "dlv_1", type: "ping" }), t = 1_800_000_000;
  it("verifies its own signature and nothing else", () => {
    const h = signature(secret, t, body);
    expect(h).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifySignature(secret, h, body, t + 10)).toBe(true);
    expect(verifySignature("whsec_other", h, body, t + 10)).toBe(false);
    expect(verifySignature(secret, h, body + " ", t + 10)).toBe(false);
    expect(verifySignature(secret, h, body, t + 301)).toBe(false);
    expect(verifySignature(secret, "t=x,v1=00", body, t)).toBe(false);
  });
});

describe("where webhooks may go", () => {
  it("knows private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
      "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1"]) expect([ip, privateIp(ip)]).toEqual([ip, true]);
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect([ip, privateIp(ip)]).toEqual([ip, false]);
  });
  it("accepts public https addresses only", () => {
    expect(hookUrlProblem("https://discord.com/api/webhooks/1/abc")).toBeNull();
    expect(hookUrlProblem("https://example.com:443/x")).toBeNull();
    expect(hookUrlProblem("http://example.com/x")).toMatch(/https/);
    expect(hookUrlProblem("https://example.com:8443/x")).toMatch(/port/);
    expect(hookUrlProblem("https://user:pw@example.com/")).toMatch(/password/);
    expect(hookUrlProblem("https://localhost/x")).toMatch(/private/);
    expect(hookUrlProblem("https://printer.local/x")).toMatch(/private/);
    expect(hookUrlProblem("https://intranet/x")).toMatch(/private/);
    expect(hookUrlProblem("https://127.0.0.1/x")).toMatch(/private/);
    expect(hookUrlProblem("https://[::1]/x")).toMatch(/private/);
    expect(hookUrlProblem("https://169.254.169.254/latest")).toMatch(/private/);
    expect(hookUrlProblem("not a url")).toMatch(/not a web address/);
  });
});
