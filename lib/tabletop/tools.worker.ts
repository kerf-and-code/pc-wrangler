// lib/tabletop/tools.worker.ts (2026-11-08)
//
// Audit A5: the token maker's two heavy jobs, run off the page's main thread so the page keeps
// responding: the guided cut (lib/tabletop/guided-cut.ts) and GIF encoding (lib/tabletop/gif.ts). The
// page still draws the GIF's frames (that needs its canvas and pictures) and posts each one here.
// Started and spoken to only through lib/tabletop/tools-client.ts, which falls back to running the same
// code on the page when a worker cannot start.
//
// Messages carry an id; every reply carries the same id and either `result` or `error`.

import { guidedCut } from "./guided-cut";
import { GifEncoder } from "./gif";

type In =
  | { id: number; kind: "cut"; rgba: Uint8ClampedArray; w: number; h: number; keep: Uint8Array; drop: Uint8Array }
  | { id: number; kind: "gif-start"; w: number; h: number; transparent: boolean }
  | { id: number; kind: "gif-sample"; job: number; rgba: Uint8ClampedArray }
  | { id: number; kind: "gif-palette"; job: number }
  | { id: number; kind: "gif-frame"; job: number; rgba: Uint8ClampedArray; delay: number }
  | { id: number; kind: "gif-finish"; job: number };

// typed loosely so this file builds alongside the DOM types the rest of the app uses
const scope = self as unknown as {
  postMessage: (m: unknown, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent<In>) => void) | null;
};

const jobs = new Map<number, GifEncoder>();
let nextJob = 1;

function encoder(job: number): GifEncoder {
  const e = jobs.get(job);
  if (!e) throw new Error("That GIF was not started.");
  return e;
}

scope.onmessage = (e) => {
  const m = e.data;
  try {
    switch (m.kind) {
      case "cut": {
        const r = guidedCut(m.rgba, m.w, m.h, m.keep, m.drop);
        scope.postMessage({ id: m.id, result: r }, r ? [r.mask.buffer] : []);
        return;
      }
      case "gif-start": {
        const job = nextJob++;
        jobs.set(job, new GifEncoder(m.w, m.h, { transparent: m.transparent }));
        scope.postMessage({ id: m.id, result: job });
        return;
      }
      case "gif-sample": encoder(m.job).addPaletteSample(m.rgba); scope.postMessage({ id: m.id, result: true }); return;
      case "gif-palette": encoder(m.job).buildPalette(); scope.postMessage({ id: m.id, result: true }); return;
      case "gif-frame": encoder(m.job).addFrame(m.rgba, m.delay); scope.postMessage({ id: m.id, result: true }); return;
      case "gif-finish": {
        const bytes = encoder(m.job).finish();
        jobs.delete(m.job);
        scope.postMessage({ id: m.id, result: bytes }, [bytes.buffer]);
        return;
      }
    }
  } catch (err) {
    scope.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
