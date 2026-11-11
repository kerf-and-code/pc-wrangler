import { describe, it, expect } from "vitest";
import { CODEX_THEMES, codexTheme, codexThemeCss } from "@/lib/codex-themes";

describe("codex themes (push 32, P11)", () => {
  it("falls back to the original look for anything unknown", () => {
    expect(codexTheme(null).key).toBe("forge");
    expect(codexTheme("nope").key).toBe("forge");
    expect(codexThemeCss(null)).toBe("");
    expect(codexThemeCss("forge")).toBe("");
  });
  it("gives every other theme the same full set of colours in both modes", () => {
    const keys = ["--w-deep", "--w-bg", "--w-panel", "--w-panel-2", "--w-ink", "--w-ink-2", "--w-muted", "--w-accent", "--w-accent-dim", "--w-line", "--w-tag-bg"];
    for (const t of CODEX_THEMES.filter((x) => x.key !== "forge")) {
      expect(Object.keys(t.dark).sort(), t.key).toEqual([...keys].sort());
      expect(Object.keys(t.light).sort(), t.key).toEqual([...keys].sort());
    }
  });
  it("matches the database's list of keys", () => {
    expect(CODEX_THEMES.map((t) => t.key)).toEqual(["forge", "frost", "verdant", "crimson", "arcane"]);
  });
  it("writes rules that outrank the base stylesheet, and the heading face when it changes", () => {
    const css = codexThemeCss("verdant");
    expect(css).toContain('html[data-wiki="dark"]');
    expect(css).toContain('html[data-wiki="light"]');
    expect(css).toContain("--w-accent: #a7c97a;");
    expect(css).toContain("EB Garamond");
    expect(codexThemeCss("frost")).not.toContain("EB Garamond");
  });
});
