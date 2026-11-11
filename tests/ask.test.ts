import { describe, it, expect } from "vitest";
import {
  extractTerms, wantsRecent, numberSources, sourceLabel, buildAskPrompt, citedNumbers, answerPieces, tidyAnswer, clock,
} from "@/lib/ask";

describe("extractTerms", () => {
  it("drops stopwords and short words, trims plurals, keeps order", () => {
    expect(extractTerms("What did the party promise the harbourmasters at Saltmere?")).toEqual(["promise", "harbourmaster", "saltmere"]);
  });
  it("handles possessives, cities and duplicates", () => {
    expect(extractTerms("Quill's ledger, the cities, Quill again")).toEqual(["quill", "ledger", "cit"]);
  });
  it("keeps words in other scripts and numbered things", () => {
    expect(extractTerms("Wo ist der Drache Glühwurm?")).toEqual(["ist", "der", "drache", "glühwurm"]);
    expect(extractTerms("room 12 of vault b7")).toEqual(["room", "vault", "b7"]);
  });
  it("caps at 12 terms and 40 characters", () => {
    const many = Array.from({ length: 20 }, (_, i) => `word${String.fromCharCode(97 + i)}x`).join(" ");
    expect(extractTerms(many)).toHaveLength(12);
    expect(extractTerms("a".repeat(60))[0]).toHaveLength(40);
  });
  it("returns nothing for a question of only stopwords", () => {
    expect(extractTerms("What happened last session?")).toEqual([]);
  });
});

describe("wantsRecent", () => {
  it("spots questions about the latest sessions", () => {
    expect(wantsRecent("What happened last session?")).toBe(true);
    expect(wantsRecent("catch me up")).toBe(true);
    expect(wantsRecent("Who is Quill?")).toBe(false);
  });
});

const rows = [
  { kind: "transcript", id: "t1", title: "Mira", snippet: "Mira: We promise to pay double.", session_id: "s3", session_number: 3, track_id: "tr", t_seconds: "3725.0" },
  { kind: "entry", id: "e1", title: "Saltmere", snippet: "A fishing town.", session_id: null, session_number: null, track_id: null, t_seconds: null },
  { kind: "bogus", id: "x" },
  { kind: "recap", id: "s4", title: "Session 4", snippet: "A storm.", session_id: "s4", session_number: 4, track_id: null, t_seconds: null },
];

describe("sources", () => {
  it("numbers good rows from 1 and drops bad ones", () => {
    const s = numberSources(rows);
    expect(s.map((x) => [x.n, x.kind])).toEqual([[1, "transcript"], [2, "entry"], [3, "recap"]]);
    expect(s[0].t_seconds).toBe(3725);
  });
  it("labels each kind", () => {
    const s = numberSources(rows);
    expect(sourceLabel(s[0])).toBe("Transcript, session 3 at 1:02:05, near Mira");
    expect(sourceLabel(s[1])).toBe("Codex: Saltmere");
    expect(sourceLabel(s[2])).toBe("Recap of session 4");
    expect(clock(65)).toBe("1:05");
  });
  it("builds a prompt with numbered excerpts and the question last", () => {
    const p = buildAskPrompt("  What was promised? ", numberSources(rows), "Emberwatch");
    expect(p.startsWith("Campaign: Emberwatch")).toBe(true);
    expect(p).toContain("[1] Transcript, session 3");
    expect(p).toContain("[3] Recap of session 4\nA storm.");
    expect(p.endsWith("Question: What was promised?")).toBe(true);
  });
});

describe("citations", () => {
  const answer = "They promised double pay [1], at Saltmere [2, 9][1]. A storm followed [3].";
  it("lists cited sources once, in order, ignoring numbers past the end", () => {
    expect(citedNumbers(answer, 3)).toEqual([1, 2, 3]);
    expect(citedNumbers("No sources here [0] [7]", 3)).toEqual([]);
  });
  it("splits an answer into text and citations", () => {
    expect(answerPieces(answer, 3)).toEqual([
      { text: "They promised double pay " }, { cite: 1 }, { text: ", at Saltmere " }, { cite: 2 }, { cite: 1 },
      { text: ". A storm followed " }, { cite: 3 }, { text: "." },
    ]);
    expect(answerPieces("Out of range [8] stays as text", 3)).toEqual([{ text: "Out of range [8] stays as text" }]);
  });
  it("removes em and en dashes", () => {
    const em = String.fromCharCode(0x2014), en = String.fromCharCode(0x2013);
    expect(tidyAnswer(`Quill ${em} the harbourmaster ${en} wants coin. `)).toBe("Quill, the harbourmaster, wants coin.");
  });
});
