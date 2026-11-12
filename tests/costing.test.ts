// tests/costing.test.ts (push 46): cost estimates at the settled rates
import { describe, expect, it } from "vitest";
import { COSTING, dollars, estimateCost } from "@/lib/costing";

describe("estimateCost", () => {
  it("costs an online session as the model does", () => {
    // 16 raw speaker-hours, 13% kept, Groq per minute, plus the per-session LLM and overhead
    const e = estimateCost({ speakerMinutes: 16 * 60, roomSessions: 0, sessions: 1 });
    expect(e.transcription).toBeCloseTo(960 * 0.13 * 0.000667, 6);
    expect(e.total).toBeCloseTo(e.transcription + COSTING.llmPerSession + COSTING.overheadPerSession, 6);
    expect(e.perSession).toBeCloseTo(e.total, 6);
  });
  it("adds Replicate per in-person session", () => {
    expect(estimateCost({ speakerMinutes: 0, roomSessions: 2, sessions: 2 }).room).toBeCloseTo(0.4, 6);
  });
  it("is zero, with no per-session figure, for nothing used", () => {
    const e = estimateCost({ speakerMinutes: 0, roomSessions: 0, sessions: 0 });
    expect(e.total).toBe(0);
    expect(e.perSession).toBeNull();
  });
  it("writes small amounts plainly", () => {
    expect(dollars(0.001)).toBe("under $0.01");
    expect(dollars(1.234)).toBe("$1.23");
  });
});
