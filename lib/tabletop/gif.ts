// lib/tabletop/gif.ts (2026-11-08)
//
// A small animated GIF encoder for the token maker, written here so the free tools carry no extra
// dependency. One global palette for every frame (median cut over a 15-bit colour histogram sampled
// from the frames), LZW compression, a looping animation, and optional transparency.
//
// GIF transparency is all or nothing per pixel: a pixel is either a palette colour or clear. Pixels at
// least half opaque keep their colour; the rest become clear. Soft edges therefore look slightly crisp;
// choosing a solid background instead keeps them smooth.
//
// Usage: const enc = new GifEncoder(w, h, { transparent: true }); enc.addPaletteSample(rgba) for a few
// frames; enc.buildPalette(); enc.addFrame(rgba, delayMs) for every frame; enc.finish() -> Uint8Array.

const TRANSPARENT = 255;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

class ByteOut {
  private buf = new Uint8Array(1 << 16);
  len = 0;
  private grow(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2; while (size < this.len + n) size *= 2;
    const nb = new Uint8Array(size); nb.set(this.buf.subarray(0, this.len)); this.buf = nb;
  }
  byte(b: number) { this.grow(1); this.buf[this.len++] = b & 255; }
  word(w: number) { this.byte(w); this.byte(w >> 8); }
  bytes(a: ArrayLike<number>) { this.grow(a.length); for (let i = 0; i < a.length; i++) this.buf[this.len++] = a[i]; }
  str(s: string) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  done() { return this.buf.slice(0, this.len); }
}

type Box = { bins: number[]; count: number };

export class GifEncoder {
  private out = new ByteOut();
  private hist = new Uint32Array(32768);
  private palette: number[][] = [];
  private lookup = new Uint8Array(32768);
  private started = false;
  private readonly transparent: boolean;
  private readonly matte: [number, number, number];
  // LZW tables, reused for every frame: a slot per (prefix code, next byte), stamped by generation so a
  // reset costs nothing.
  private codes = new Uint16Array(4096 * 256);
  private stamps = new Uint32Array(4096 * 256);
  private gen = 1;

  constructor(readonly w: number, readonly h: number, opts: { transparent?: boolean; matte?: string } = {}) {
    this.transparent = opts.transparent !== false;
    const m = /^#?([0-9a-f]{6})$/i.exec(opts.matte ?? "#15120f");
    const n = m ? parseInt(m[1], 16) : 0x15120f;
    this.matte = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** The colour a pixel is drawn in: its own when opaque enough, or blended onto the matte. */
  private px(rgba: Uint8ClampedArray, i: number, dither = 0): number {
    const a = rgba[i + 3];
    let r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    if (this.transparent) { if (a < 128) return -1; }
    else { const k = a / 255; r = r * k + this.matte[0] * (1 - k); g = g * k + this.matte[1] * (1 - k); b = b * k + this.matte[2] * (1 - k); }
    if (dither) { r = Math.max(0, Math.min(255, r + dither)); g = Math.max(0, Math.min(255, g + dither)); b = Math.max(0, Math.min(255, b + dither)); }
    return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  }

  addPaletteSample(rgba: Uint8ClampedArray) {
    for (let i = 0; i < rgba.length; i += 8) { const c = this.px(rgba, i); if (c >= 0) this.hist[c]++; }
  }

  /** Median cut to 255 colours (256 without transparency), and a lookup for every 15-bit colour. */
  buildPalette() {
    const max = this.transparent ? 255 : 256;
    const all: number[] = [];
    for (let c = 0; c < 32768; c++) if (this.hist[c]) all.push(c);
    if (!all.length) all.push(0);
    const ch = (c: number, k: number) => (k === 0 ? c >> 10 : k === 1 ? (c >> 5) & 31 : c & 31);
    let boxes: Box[] = [{ bins: all, count: all.reduce((s, c) => s + this.hist[c], 0) }];
    while (boxes.length < max) {
      let bi = -1, best = 0, axis = 0;
      boxes.forEach((b, i) => {
        if (b.bins.length < 2) return;
        for (let k = 0; k < 3; k++) {
          let lo = 31, hi = 0; for (const c of b.bins) { const v = ch(c, k); if (v < lo) lo = v; if (v > hi) hi = v; }
          const score = (hi - lo) * Math.sqrt(b.count);
          if (score > best) { best = score; bi = i; axis = k; }
        }
      });
      if (bi < 0) break;
      const b = boxes[bi];
      b.bins.sort((x, y) => ch(x, axis) - ch(y, axis));
      // split at the median count, but never leave either half empty (an empty half wasted a palette
      // slot and produced a broken colour, which is how whole colour families went missing)
      let acc = 0, cut = 0;
      for (; cut < b.bins.length - 1; cut++) { acc += this.hist[b.bins[cut]]; if (acc >= b.count / 2) break; }
      cut = Math.min(cut, b.bins.length - 2);
      const left = b.bins.slice(0, cut + 1), right = b.bins.slice(cut + 1);
      const cnt = (a: number[]) => a.reduce((s, c) => s + this.hist[c], 0);
      boxes = [...boxes.slice(0, bi), { bins: left, count: cnt(left) }, { bins: right, count: cnt(right) }, ...boxes.slice(bi + 1)];
    }
    this.palette = boxes.map((b) => {
      let r = 0, g = 0, bl = 0, n = 0;
      for (const c of b.bins) { const k = this.hist[c] || 1; r += ((c >> 10) << 3 | 4) * k; g += ((((c >> 5) & 31) << 3) | 4) * k; bl += (((c & 31) << 3) | 4) * k; n += k; }
      return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
    });
    for (let c = 0; c < 32768; c++) {
      const r = ((c >> 10) << 3) | 4, g = (((c >> 5) & 31) << 3) | 4, b = ((c & 31) << 3) | 4;
      let bi = 0, bd = Infinity;
      for (let i = 0; i < this.palette.length; i++) { const p = this.palette[i], d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < bd) { bd = d; bi = i; } }
      this.lookup[c] = bi;
    }
  }

  private header() {
    const o = this.out;
    o.str("GIF89a"); o.word(this.w); o.word(this.h);
    o.byte(0xf7); o.byte(0); o.byte(0);                  // global colour table of 256, background 0
    for (let i = 0; i < 256; i++) { const p = this.palette[i] ?? [0, 0, 0]; o.byte(p[0]); o.byte(p[1]); o.byte(p[2]); }
    o.bytes([0x21, 0xff, 0x0b]); o.str("NETSCAPE2.0"); o.bytes([0x03, 0x01, 0x00, 0x00, 0x00]); // loop forever
    this.started = true;
  }

  addFrame(rgba: Uint8ClampedArray, delayMs: number) {
    if (!this.palette.length) this.buildPalette();
    if (!this.started) this.header();
    const o = this.out, n = this.w * this.h, idx = new Uint8Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (this.transparent && rgba[i + 3] < 128) { idx[p] = TRANSPARENT; continue; }
      // a light 4 by 4 ordered dither: smooth gradients without the crawling noise error diffusion
      // gives an animation
      const x = p % this.w, y = (p - x) / this.w, d = (BAYER[(y & 3) * 4 + (x & 3)] - 7.5) * 0.9;
      const c = this.px(rgba, i, d);
      idx[p] = this.lookup[c];
    }
    // graphic control: restore to background between frames so clear pixels stay clear
    o.bytes([0x21, 0xf9, 0x04, ((this.transparent ? 2 : 1) << 2) | (this.transparent ? 1 : 0)]);
    o.word(Math.max(2, Math.round(delayMs / 10))); o.byte(this.transparent ? TRANSPARENT : 0); o.byte(0);
    o.byte(0x2c); o.word(0); o.word(0); o.word(this.w); o.word(this.h); o.byte(0);
    this.lzw(idx);
  }

  private lzw(idx: Uint8Array) {
    const o = this.out, MIN = 8, CLEAR = 256, EOI = 257;
    o.byte(MIN);
    const block = new Uint8Array(255); let bl = 0;
    let acc = 0, bits = 0, size = MIN + 1, next = EOI + 1;
    const flush = () => { if (bl) { o.byte(bl); o.bytes(block.subarray(0, bl)); bl = 0; } };
    const emit = (code: number) => {
      acc |= code << bits; bits += size;
      while (bits >= 8) { block[bl++] = acc & 255; if (bl === 255) flush(); acc >>>= 8; bits -= 8; }
    };
    const reset = () => { this.gen++; next = EOI + 1; size = MIN + 1; };
    emit(CLEAR); reset();
    let prefix = idx[0];
    for (let p = 1; p < idx.length; p++) {
      const k = idx[p], slot = prefix * 256 + k;
      if (this.stamps[slot] === this.gen) { prefix = this.codes[slot]; continue; }
      emit(prefix);
      if (next < 4096) {
        this.codes[slot] = next; this.stamps[slot] = this.gen;
        if (next === 1 << size && size < 12) size++;
        next++;
      } else { emit(CLEAR); reset(); }
      prefix = k;
    }
    emit(prefix); emit(EOI);
    if (bits > 0) { block[bl++] = acc & 255; if (bl === 255) flush(); }
    flush(); o.byte(0);
  }

  finish(): Uint8Array {
    if (!this.started) { if (!this.palette.length) this.buildPalette(); this.header(); }
    this.out.byte(0x3b);
    return this.out.done();
  }
}
