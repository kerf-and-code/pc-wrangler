// tests/fetch-all.test.ts (push 46): every page is read, and a short page ends it
import { describe, expect, it } from "vitest";
import { fetchAll, PAGE } from "@/lib/fetch-all";

const table = Array.from({ length: 2345 }, (_, i) => i);
const page = (from: number, to: number) => Promise.resolve({ data: table.slice(from, to + 1), error: null });

describe("fetchAll", () => {
  it("reads past the 1,000-row cap", async () => {
    const r = await fetchAll(page);
    expect(r.data.length).toBe(2345);
    expect(r.complete).toBe(true);
  });
  it("stops at the page limit and says it is incomplete", async () => {
    const r = await fetchAll(page, 2);
    expect(r.data.length).toBe(2 * PAGE);
    expect(r.complete).toBe(false);
  });
  it("returns what it had when a page fails", async () => {
    let n = 0;
    const r = await fetchAll((f, t) => Promise.resolve(n++ ? { data: null, error: { message: "boom" } } : { data: table.slice(f, t + 1), error: null }));
    expect(r.data.length).toBe(PAGE);
    expect(r.error).toBe("boom");
  });
});
