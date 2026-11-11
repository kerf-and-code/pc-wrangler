// tests/calendar-usage.test.ts (push 16, audits F8 and T22)
import { describe, expect, it } from "vitest";
import { sessionIcs } from "../lib/calendar";
import { anthropicTokens, geminiTokens } from "../lib/usage";

describe("sessionIcs", () => {
  const ics = sessionIcs({ id: "abc", title: "Emberwatch: session 4, the vault", start: "2026-11-12T03:00:00Z", url: "https://example.com/me/campaigns" });

  it("is one well-formed event with CRLF line endings", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(1);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it("starts at the session time, in UTC, and lasts three hours", () => {
    expect(ics).toContain("DTSTART:20261112T030000Z");
    expect(ics).toContain("DTEND:20261112T060000Z");
    expect(ics).toContain("UID:abc@six-axes");
  });

  it("escapes commas in the title", () => {
    expect(ics).toContain("SUMMARY:Emberwatch: session 4\\, the vault");
  });
});

describe("usage token readers", () => {
  it("reads Anthropic usage", () => {
    expect(anthropicTokens({ usage: { input_tokens: 1200, output_tokens: 340 } })).toEqual({ inputTokens: 1200, outputTokens: 340 });
    expect(anthropicTokens({})).toEqual({ inputTokens: null, outputTokens: null });
    expect(anthropicTokens(null)).toEqual({ inputTokens: null, outputTokens: null });
  });

  it("reads Gemini usage", () => {
    expect(geminiTokens({ usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 1290 } })).toEqual({ inputTokens: 900, outputTokens: 1290 });
    expect(geminiTokens({ usageMetadata: { promptTokenCount: "x" } })).toEqual({ inputTokens: null, outputTokens: null });
  });
});
