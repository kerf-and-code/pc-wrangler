// tests/notifications.test.ts (push 19)
import { describe, expect, it } from "vitest";
import { absoluteLink, digestEmail, notificationWhen, type NotificationRow } from "../lib/notifications";
import { verifyUnsubscribe, signUnsubscribe } from "../lib/email/unsubscribe";

const row = (o: Partial<NotificationRow>): NotificationRow => ({
  id: 1, kind: "rsvp", title: "Emberwatch: Bobert is going to Session 4", link: "/gm/sessions?campaign=x", data: {},
  created_at: "2026-11-10T20:00:00Z", read_at: null, ...o,
});

describe("notificationWhen", () => {
  it("prints the session time in the campaign's zone for scheduled and moved sessions", () => {
    const n = row({ kind: "session_moved", data: { scheduled_at: "2026-11-13T03:00:00Z", time_zone: "America/Los_Angeles" } });
    expect(notificationWhen(n)).toBe("Thu, Nov 12, 7:00 PM PST");
  });
  it("prints nothing for other kinds or without a time", () => {
    expect(notificationWhen(row({ kind: "rsvp", data: { scheduled_at: "2026-11-13T03:00:00Z" } }))).toBeNull();
    expect(notificationWhen(row({ kind: "session_scheduled", data: {} }))).toBeNull();
  });
});

describe("absoluteLink", () => {
  it("joins same-site paths and refuses anything else", () => {
    expect(absoluteLink("https://six.example/", "/recaps?share=AB")).toBe("https://six.example/recaps?share=AB");
    expect(absoluteLink("https://six.example", "//evil.example/x")).toBe("https://six.example/me");
    expect(absoluteLink("https://six.example", "https://evil.example")).toBe("https://six.example/me");
    expect(absoluteLink("https://six.example", null)).toBe("https://six.example/me");
  });
});

describe("digestEmail", () => {
  it("names a single item in the subject and counts several", () => {
    expect(digestEmail([row({})], "https://six.example", "https://six.example/u").subject).toBe("Six Axes: Emberwatch: Bobert is going to Session 4");
    expect(digestEmail([row({ id: 1 }), row({ id: 2 })], "https://six.example", "https://six.example/u").subject).toBe("Six Axes: 2 updates from your tables");
  });
  it("escapes titles, links every item, and caps the list at 25", () => {
    const items = Array.from({ length: 30 }, (_, i) => row({ id: i, title: i === 0 ? "<b>Tom & Jerry</b>" : `Item ${i}` }));
    const m = digestEmail(items, "https://six.example", "https://six.example/u");
    expect(m.html).toContain("&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;");
    expect(m.html).not.toContain("<b>Tom");
    expect(m.html).toContain("And 5 more.");
    expect((m.html.match(/<li /g) ?? []).length).toBe(25);
    expect(m.text).toContain("Stop the daily digest: https://six.example/u");
  });
});

describe("digest unsubscribe links", () => {
  it("accept the digest kind", () => {
    const sig = signUnsubscribe("a@b.test", "digest", "k");
    expect(verifyUnsubscribe("a@b.test", "digest", sig, "k")).toBe(true);
    expect(verifyUnsubscribe("a@b.test", "recaps", sig, "k")).toBe(false);
  });
});
