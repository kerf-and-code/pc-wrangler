// tests/discord-activity.test.ts (2026-11-11, push 34, audit P7: the Discord Activity)
import { describe, expect, it } from "vitest";
import { signSession, verifySession, forWatcher, feedForWatcher, combatForWatcher, isUuid } from "@/lib/discord/activity";
import { mergeMessages, sinceOf, proxiedUrl, diceNotation, rollLine, type FeedMessage } from "@/lib/discord/activity-view";

const SECRET = "test-secret";
const NOW = Date.parse("2026-11-11T12:00:00Z");

describe("activity session", () => {
  it("round-trips a signed session", () => {
    const t = signSession({ d: "123456789", g: "987654321", n: "Mira" }, NOW, SECRET);
    expect(verifySession(t, NOW + 1000, SECRET)).toMatchObject({ d: "123456789", g: "987654321", n: "Mira" });
  });
  it("rejects a tampered body, a wrong secret, and an expired session", () => {
    const t = signSession({ d: "1", g: "2", n: "A" }, NOW, SECRET);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ d: "999", g: "2", n: "A", exp: 9e9 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, NOW, SECRET)).toBeNull();
    expect(verifySession(`${body}.${sig}`, NOW, "other")).toBeNull();
    expect(verifySession(t, NOW + 13 * 3600 * 1000, SECRET)).toBeNull();
    expect(verifySession("", NOW, SECRET)).toBeNull();
    expect(verifySession("nodot", NOW, SECRET)).toBeNull();
  });
  it("refuses to sign without a secret", () => {
    expect(() => signSession({ d: "1", g: "2", n: "" }, NOW, "")).toThrow();
  });
  it("checks uuids", () => {
    expect(isUuid("6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f")).toBe(true);
    expect(isUuid("x")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("what a watcher sees", () => {
  it("takes ownership off tokens", () => {
    const s = forWatcher({ tokens: [{ id: "a", mine: true, controlled_by: ["u"] }] });
    expect(s?.tokens?.[0]).toMatchObject({ mine: false, controlled_by: [] });
    expect(forWatcher(null)).toBeNull();
  });
  it("drops whispers and hidden rolls", () => {
    const f = feedForWatcher({ messages: [{ whisper_to: null }, { whisper_to: [] }, { whisper_to: ["x"] }, { gm_only: true }] });
    expect(f?.messages).toHaveLength(2);
  });
  it("strips the borrowed player's personal turn details", () => {
    const c = combatForWatcher({ order: [{ id: "1", mine: true, ac: 15, econ: {}, pendingSaves: [], speed: 30, hp: 10 }] });
    const e = c?.order?.[0] ?? {};
    expect(e.mine).toBe(false);
    expect(e).not.toHaveProperty("ac");
    expect(e).not.toHaveProperty("econ");
    expect(e).not.toHaveProperty("speed");
    expect(e.hp).toBe(10);
  });
});

const msg = (id: string, at: string, extra: Partial<FeedMessage> = {}): FeedMessage => ({ id, created_at: at, kind: "chat", as_name: "Mira", body: "hi", roll: null, ...extra });

describe("activity view helpers", () => {
  it("merges the feed without repeats, oldest first, capped", () => {
    const a = [msg("1", "2026-11-11T10:00:00Z"), msg("2", "2026-11-11T10:01:00Z")];
    const out = mergeMessages(a, [msg("2", "2026-11-11T10:01:00Z"), msg("0", "2026-11-11T09:00:00Z")]);
    expect(out.map((m) => m.id)).toEqual(["0", "1", "2"]);
    expect(mergeMessages(a, [msg("3", "2026-11-11T11:00:00Z")], 2).map((m) => m.id)).toEqual(["2", "3"]);
    expect(mergeMessages(a, null)).toBe(a);
    expect(sinceOf(out)).toBe("2026-11-11T10:01:00Z");
    expect(sinceOf([])).toBe("");
  });
  it("maps Supabase pictures through /sb inside Discord", () => {
    const sb = "https://abc.supabase.co";
    expect(proxiedUrl("https://abc.supabase.co/storage/v1/object/public/t/a.png?x=1", sb, true)).toBe("/sb/storage/v1/object/public/t/a.png?x=1");
    expect(proxiedUrl("https://elsewhere.com/a.png", sb, true)).toBeNull();
    expect(proxiedUrl("https://elsewhere.com/a.png", sb, false)).toBe("https://elsewhere.com/a.png");
    expect(proxiedUrl("/icons/a.png", sb, true)).toBe("/icons/a.png");
    expect(proxiedUrl(null, sb, true)).toBeNull();
  });
  it("writes dice notation", () => {
    expect(diceNotation(20)).toBe("1d20");
    expect(diceNotation(20, 1, 3, "adv")).toBe("2d20kh1+3");
    expect(diceNotation(20, 1, -1, "dis")).toBe("2d20kl1-1");
    expect(diceNotation(6, 2, 0, "adv")).toBe("2d6");
    expect(diceNotation(8, 99)).toBe("20d8");
  });
  it("words a roll for the log", () => {
    expect(rollLine(msg("1", "t", { kind: "roll", roll: { label: "Initiative", notation: "1d20+3", total: 17 } }))).toBe("Mira: Initiative 17 (1d20+3)");
    expect(rollLine(msg("1", "t"))).toBe("Mira: hi");
  });
});
