// tests/confirm.test.ts (push 13, audit L-U1)
import { afterEach, describe, expect, it, vi } from "vitest";
import { askConfirm, defaultConfirmLabel, isDangerous, registerConfirmHost } from "../lib/confirm";

describe("defaultConfirmLabel", () => {
  it("names the action from the question's first word", () => {
    expect(defaultConfirmLabel("Delete this note? Nobody else has a copy.")).toBe("Delete");
    expect(defaultConfirmLabel("Remove this track? The audio file is deleted.")).toBe("Remove");
    expect(defaultConfirmLabel('End "Goblin ambush"? Players stop seeing it.')).toBe("End");
    expect(defaultConfirmLabel("Six Axes is still finishing this recording.")).toBe("Continue");
  });
});

describe("isDangerous", () => {
  it("marks destructive questions, not routine ones", () => {
    expect(isDangerous("Delete this thread? This can't be undone.")).toBe(true);
    expect(isDangerous("Regenerate the session link?")).toBe(true);
    expect(isDangerous("Reopen Session 4 and make it live again?")).toBe(false);
    expect(isDangerous("Bind this inventory to Bobert?")).toBe(false);
  });
});

describe("askConfirm", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("goes through the mounted host and resolves with its answer", async () => {
    vi.stubGlobal("window", { confirm: () => { throw new Error("native confirm must not be used"); } });
    const off = registerConfirmHost((req) => {
      expect(req.confirmLabel).toBe("Delete");
      expect(req.danger).toBe(true);
      req.resolve(true);
    });
    await expect(askConfirm("Delete this note?")).resolves.toBe(true);
    off();
  });

  it("falls back to the browser dialog when no host is mounted, never silently approving", async () => {
    const native = vi.fn(() => false);
    vi.stubGlobal("window", { confirm: native });
    await expect(askConfirm("Delete this note?")).resolves.toBe(false);
    expect(native).toHaveBeenCalledWith("Delete this note?");
  });
});
