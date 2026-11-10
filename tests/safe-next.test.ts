import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/safe-next";

// Audit B10: sign-in and email-confirm links only ever send people to a path on this site.
describe("safeNext", () => {
  it("keeps paths on this site", () => {
    expect(safeNext("/gm", "/x")).toBe("/gm");
    expect(safeNext("/me?claimed=1", "/x")).toBe("/me?claimed=1");
    expect(safeNext("/play?share=abc#top", "/x")).toBe("/play?share=abc#top");
  });
  it("falls back for anything that could leave the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "@evil.example/x", ".evil.example", "evil.example",
      "javascript:alert(1)", "/ok\nLocation: https://evil.example", "", null, undefined]) {
      expect([bad, safeNext(bad as string | null | undefined, "/gm")]).toEqual([bad, "/gm"]);
    }
  });
  it("leaves the origin + next joins on this host", () => {
    const origin = "https://six-axes.example";
    for (const raw of ["@evil.example", ".evil.example", "/fine"]) {
      expect(new URL(`${origin}${safeNext(raw, "/gm")}`).host).toBe("six-axes.example");
    }
  });
});
