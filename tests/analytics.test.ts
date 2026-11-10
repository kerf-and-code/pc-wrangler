import { describe, expect, it } from "vitest";
import { bareUrl, isTrackable } from "@/lib/analytics-paths";

// Audit T3: analytics never counts a player, share-code or sign-in page.
describe("isTrackable", () => {
  it("skips private pages", () => {
    for (const p of ["/play", "/me", "/me/sheet", "/recaps", "/x/ab12", "/auth/callback", "/tabletop/abc", "/world", "/claim"]) expect([p, isTrackable(p)]).toEqual([p, false]);
  });
  it("counts public and GM pages", () => {
    for (const p of ["/", "/features", "/pricing", "/tools/map-render", "/c/emberwatch", "/gm", "/gm/sessions", "/players", "/worldbuilding-guide"]) expect([p, isTrackable(p)]).toEqual([p, true]);
  });
});

describe("bareUrl", () => {
  it("drops the query and hash", () => {
    expect(bareUrl("https://sixaxes.app/play?share=ABC123#x")).toBe("https://sixaxes.app/play");
    expect(bareUrl("")).toBe("");
  });
});
