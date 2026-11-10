import { describe, expect, it } from "vitest";
import { extract } from "@/lib/backfill/extract";
import type { NormalizedImport, SourceNote } from "@/lib/backfill/types";

// Audit T4: one import makes a bounded number of model calls.
const note = (i: number): SourceNote => ({
  id: `n${i}`, title: `Note ${i}`, kind: "unknown", kindConfidence: "guessed", text: `Prose note number ${i}, long enough to be worth sending to the model.`,
  links: [], tags: [], frontmatter: {},
});
const bundle = (notes: number, sessions: number): NormalizedImport => ({
  format: "plaintext",
  notes: Array.from({ length: notes }, (_, i) => note(i)),
  sessions: Array.from({ length: sessions }, (_, i) => ({ index: i + 1, label: `Session ${i + 1}`, text: `Session text ${i + 1}, long enough to be worth sending to the model too.`, noteIds: [] })),
  warnings: [],
  stats: { noteCount: notes, linkCount: 0, sessionCount: sessions, structuralKindCount: 0 },
});

describe("import model-call cap", () => {
  it("stops at the cap, warns, and falls back for recaps", async () => {
    let calls = 0;
    const complete = async () => { calls++; return "[]"; };
    const r = await extract(bundle(4, 3), { complete, maxModelCalls: 5 });
    expect(calls).toBe(5);                      // 4 notes + 1 recap
    expect(r.recaps).toHaveLength(3);           // every session still gets a recap
    expect(r.recaps[2].recap).toMatch(/^Session text 3,/);
    expect(r.warnings.some((w) => w.includes("2 session(s)"))).toBe(true);
  });
  it("does not count notes too short to send", async () => {
    let calls = 0;
    const b = bundle(3, 0);
    b.notes[0].text = "short";
    await extract(b, { complete: async () => { calls++; return "[]"; }, maxModelCalls: 2 });
    expect(calls).toBe(2);
  });
  it("skips notes past the cap", async () => {
    let calls = 0;
    const r = await extract(bundle(7, 0), { complete: async () => { calls++; return "[]"; }, maxModelCalls: 3 });
    expect(calls).toBe(3);
    expect(r.warnings.some((w) => w.includes("4 unstructured note(s)"))).toBe(true);
  });
});
