// tests/gif.test.ts: the GIF encoder's output decoded again with a small reader written here, so a
// broken palette (the posterising bug fixed in bc92b35), bad LZW codes or lost transparency show up.
import { describe, expect, it } from "vitest";
import { GifEncoder } from "@/lib/tabletop/gif";

type Decoded = { w: number; h: number; palette: number[][]; loops: boolean; frames: { delay: number; transparent: number | null; idx: Uint8Array }[] };

function readGif(b: Uint8Array): Decoded {
  let p = 0;
  const u8 = () => b[p++], u16 = () => { const v = b[p] | (b[p + 1] << 8); p += 2; return v; };
  const sig = String.fromCharCode(...b.subarray(0, 6)); p = 6;
  if (sig !== "GIF89a") throw new Error("not a GIF89a");
  const w = u16(), h = u16(), flags = u8(); u8(); u8();
  const palette: number[][] = [];
  if (flags & 0x80) for (let i = 0; i < 2 << (flags & 7); i++) palette.push([u8(), u8(), u8()]);
  const out: Decoded = { w, h, palette, loops: false, frames: [] };
  let delay = 0, transparent: number | null = null;
  const subBlocks = () => { const parts: number[] = []; for (let n = u8(); n; n = u8()) { for (let i = 0; i < n; i++) parts.push(b[p + i]); p += n; } return parts; };
  for (;;) {
    const t = u8();
    if (t === 0x3b) return out;
    if (t === 0x21) {
      const label = u8();
      if (label === 0xf9) { u8(); const f = u8(); delay = u16(); const ti = u8(); transparent = f & 1 ? ti : null; u8(); }
      else { const data = subBlocks(); if (label === 0xff && String.fromCharCode(...data.slice(0, 11)) === "NETSCAPE2.0") out.loops = true; }
      continue;
    }
    if (t !== 0x2c) throw new Error(`unexpected block ${t}`);
    u16(); u16(); const fw = u16(), fh = u16(); u8();
    const min = u8(), data = subBlocks();
    // LZW decode
    const clear = 1 << min, eoi = clear + 1, idx = new Uint8Array(fw * fh);
    let size = min + 1, dict: number[][] = [], o = 0, prev: number[] | null = null, bit = 0;
    const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = []; size = min + 1; prev = null; };
    reset();
    for (;;) {
      let code = 0; for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      if (code === clear) { reset(); continue; }
      if (code === eoi) break;
      let entry: number[];
      if (code < dict.length) entry = dict[code];
      else if (prev && code === dict.length) entry = [...prev, prev[0]];
      else throw new Error("bad LZW code");
      for (const v of entry) idx[o++] = v;
      if (prev && dict.length < 4096) { dict.push([...prev, entry[0]]); if (dict.length === 1 << size && size < 12) size++; }
      prev = entry;
    }
    if (o !== fw * fh) throw new Error(`frame has ${o} pixels, wanted ${fw * fh}`);
    out.frames.push({ delay, transparent, idx });
  }
}

function gradientFrame(w: number, h: number, shift: number, holes: boolean): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    a[i] = (x * 4 + shift) & 255; a[i + 1] = y * 4; a[i + 2] = 255 - x * 2; a[i + 3] = holes && (x + y) % 9 === 0 ? 0 : 255;
  }
  return a;
}

describe("GifEncoder", () => {
  it("writes a looping GIF whose frames decode to the colours that went in", () => {
    const w = 64, h = 48, frames = [0, 10, 20, 30].map((s) => gradientFrame(w, h, s, true));
    const enc = new GifEncoder(w, h, { transparent: true });
    frames.forEach((f) => enc.addPaletteSample(f));
    enc.buildPalette();
    frames.forEach((f) => enc.addFrame(f, 50));
    const g = readGif(enc.finish());
    expect([g.w, g.h, g.loops, g.frames.length]).toEqual([w, h, true, 4]);
    let worst = 0;
    g.frames.forEach((fr, k) => {
      expect(fr.delay).toBe(5);
      expect(fr.transparent).toBe(255);
      for (let p = 0; p < w * h; p++) {
        const src = frames[k], i = p * 4;
        if (src[i + 3] < 128) { expect(fr.idx[p]).toBe(255); continue; }
        expect(fr.idx[p]).not.toBe(255);
        const c = g.palette[fr.idx[p]];
        worst = Math.max(worst, Math.abs(c[0] - src[i]), Math.abs(c[1] - src[i + 1]), Math.abs(c[2] - src[i + 2]));
      }
    });
    // 255 colours for a smooth gradient: every pixel lands close to its own colour (posterising, the
    // old bug, put whole colour families 100+ away)
    expect(worst).toBeLessThan(40);
  });

  it("keeps every colour family when one colour covers most of the picture", () => {
    // the shape of the bug fixed in bc92b35: one colour (here white, last on every axis) holding most
    // of the pixels left median-cut boxes empty, so whole colour families came out wrong
    const w = 80, h = 80, f = gradientFrame(w, h, 0, false);
    for (let p = 0; p < w * h; p++) if (p % 10 < 7) f.set([255, 255, 255, 255], p * 4);
    const enc = new GifEncoder(w, h, { transparent: false });
    enc.addPaletteSample(f); enc.buildPalette(); enc.addFrame(f, 40);
    const g = readGif(enc.finish());
    let worst = 0;
    for (let p = 0; p < w * h; p++) {
      const c = g.palette[g.frames[0].idx[p]], i = p * 4;
      worst = Math.max(worst, Math.abs(c[0] - f[i]), Math.abs(c[1] - f[i + 1]), Math.abs(c[2] - f[i + 2]));
    }
    expect(worst).toBeLessThan(40);
  });

  it("uses the palette, not a handful of colours, for a colourful picture", () => {
    const w = 64, h = 64, f = gradientFrame(w, h, 0, false);
    const enc = new GifEncoder(w, h, { transparent: false });
    enc.addPaletteSample(f); enc.buildPalette(); enc.addFrame(f, 40);
    const g = readGif(enc.finish());
    expect(new Set(g.frames[0].idx).size).toBeGreaterThan(150);
  });
});
