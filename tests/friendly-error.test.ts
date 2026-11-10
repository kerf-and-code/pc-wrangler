// tests/friendly-error.test.ts (push 12, audits U6 and U7)
import { describe, expect, it, vi } from "vitest";
import { friendlyError, notReady } from "../lib/friendly-error";

vi.spyOn(console, "warn").mockImplementation(() => {});

describe("friendlyError", () => {
  it("turns database text into a sentence with a next step", () => {
    expect(friendlyError({ code: "42501", message: "permission denied for table campaigns" })).toBe("You do not have permission to do that here.");
    expect(friendlyError({ code: "23505", message: 'duplicate key value violates unique constraint "x_key"' })).toBe("That already exists. Try a different name.");
    expect(friendlyError(new TypeError("Failed to fetch"))).toBe("Check your connection and try again.");
    expect(friendlyError({ message: "JWT expired", code: "PGRST301" })).toBe("Your sign-in has expired. Sign in again, then retry.");
    expect(friendlyError({ code: "42P01", message: 'relation "public.tabletop_pins" does not exist' })).toBe("This part of Six Axes is not available yet.");
  });

  it("passes through short messages written for people", () => {
    expect(friendlyError({ message: "you have no character in that campaign" })).toBe("You have no character in that campaign.");
    expect(friendlyError({ message: "Not signed in." })).toBe("Not signed in.");
  });

  it("never shows table or column names", () => {
    const out = friendlyError({ message: "null value in column campaign_id of relation sessions" });
    expect(out).not.toMatch(/campaign_id|relation|column/);
  });

  it("leads with the action when given", () => {
    expect(friendlyError(new Error("Failed to fetch"), "show it")).toBe("Could not show it. Check your connection and try again.");
  });
});

describe("notReady", () => {
  it("names the feature, not the migration", () => {
    expect(notReady("Sound", "p124")).toBe("Sound is not available yet.");
    expect(notReady("Roll tables", "p123")).toBe("Roll tables are not available yet.");
    expect(notReady("Roll tables", "p123")).not.toMatch(/p123/);
  });
});
