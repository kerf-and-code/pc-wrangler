// tests/sound.test.ts: where the table's music is (lib/tabletop/sound.ts), which keeps every browser
// on the same moment of the track.
import { describe, expect, it } from "vitest";
import { clock, clockOffset, musicPosition, nameFromFile, normAudio, toInput, type MusicState } from "@/lib/tabletop/sound";

const m = (over: Partial<MusicState> = {}): MusicState => ({
  soundId: "s1", name: "Tavern", url: "https://x/y.mp3", duration: 100, playing: true, offset: 10, loop: true, volume: 0.7, at: 1_000_000, ...over,
});

describe("musicPosition", () => {
  it("counts on from the offset while playing", () => {
    expect(musicPosition(m(), 1_000_000 + 5_000)).toBeCloseTo(15, 6);
  });
  it("stays put while paused", () => {
    expect(musicPosition(m({ playing: false }), 9_999_999)).toBe(10);
  });
  it("wraps a looping track at its length", () => {
    expect(musicPosition(m(), 1_000_000 + 95_000)).toBeCloseTo(5, 6);
  });
  it("ends a track that does not loop", () => {
    expect(musicPosition(m({ loop: false }), 1_000_000 + 95_000)).toBeNull();
    expect(musicPosition(m({ loop: false }), 1_000_000 + 85_000)).toBeCloseTo(95, 6);
  });
  it("prefers the length the browser measured", () => {
    expect(musicPosition(m(), 1_000_000 + 95_000, 50)).toBeCloseTo(5, 6);
  });
  it("never runs backwards when a clock is behind the save", () => {
    expect(musicPosition(m(), 1_000_000 - 3_000)).toBe(10);
  });
});

describe("clockOffset", () => {
  it("takes the server reading from the middle of the round trip", () => {
    // sent at 1000, answered at 1200 by this clock; the server said 5100 (its clock is 4000 ahead)
    expect(clockOffset(1000, 5100, 1200)).toBe(4000);
  });
});

describe("normAudio", () => {
  it("reads a stored state and drops anything without a safe address", () => {
    const s = normAudio({ music: { soundId: "a", url: "https://h/a.mp3", playing: true, volume: 4 }, ambient: [{ soundId: "b", url: "javascript:x" }, { soundId: "c", url: "https://h/c.ogg" }] });
    expect(s.music?.volume).toBe(1);
    expect(s.ambient.map((a) => a.soundId)).toEqual(["c"]);
    expect(normAudio(null)).toEqual({ music: null, ambient: [] });
  });
  it("round-trips to the GM's request by id", () => {
    expect(toInput(normAudio({ music: m(), ambient: [{ soundId: "r", url: "https://h/r.ogg", volume: 0.3 }] }))).toEqual({
      music: { soundId: "s1", playing: true, offset: 10, loop: true, volume: 0.7 }, ambient: [{ soundId: "r", volume: 0.3 }],
    });
  });
});

describe("small helpers", () => {
  it("names a sound from its file", () => expect(nameFromFile("tavern_night-loop.mp3")).toBe("Tavern night loop"));
  it("formats times", () => { expect(clock(187)).toBe("3:07"); expect(clock(3765)).toBe("1:02:45"); expect(clock(null)).toBe(""); });
});
