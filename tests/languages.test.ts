// tests/languages.test.ts (push 26, audit P2)
import { describe, expect, it } from "vitest";
import { campaignLanguage, tableLanguage, writeInLanguage, TABLE_LANGUAGES } from "../lib/languages";

const db = (result: { data?: unknown; error?: unknown } | "throw") => ({
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => { if (result === "throw") throw new Error("x"); return result; } }) }),
  }),
});

describe("table language", () => {
  it("knows its codes and falls back to English", () => {
    expect(tableLanguage("es").name).toBe("Spanish");
    expect(tableLanguage("ES ").code).toBe("es");
    expect(tableLanguage(null).code).toBe("en");
    expect(tableLanguage("xx").code).toBe("en");
    expect(new Set(TABLE_LANGUAGES.map((l) => l.code)).size).toBe(TABLE_LANGUAGES.length);
    expect(TABLE_LANGUAGES.every((l) => /^[a-z]{2}$/.test(l.code))).toBe(true);
  });
  it("adds a writing line only for languages other than English", () => {
    expect(writeInLanguage("en")).toBe("");
    expect(writeInLanguage(null)).toBe("");
    expect(writeInLanguage("de")).toContain("Write entirely in German");
  });
  it("reads the campaign's language and survives a missing column", async () => {
    expect(await campaignLanguage(db({ data: { audio_language: "fr" }, error: null }), "c")).toBe("fr");
    expect(await campaignLanguage(db({ data: { audio_language: null }, error: null }), "c")).toBe("en");
    expect(await campaignLanguage(db({ data: null, error: { message: "column does not exist" } }), "c")).toBe("en");
    expect(await campaignLanguage(db("throw"), "c")).toBe("en");
    expect(await campaignLanguage(db({ data: { audio_language: "fr" } }), null)).toBe("en");
  });
});
