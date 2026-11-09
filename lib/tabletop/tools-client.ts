// lib/tabletop/tools-client.ts (2026-11-08)
//
// Audit A5: the page's side of lib/tabletop/tools.worker.ts. The guided cut and GIF encoding run in a
// Web Worker so a big cut or a 768 px GIF no longer freezes the page. When a worker cannot start (an old
// browser, a blocked script, a bundler that did not emit it) or dies mid-job, the same code runs on the
// page instead, exactly as before this change, so nothing is ever lost, only slower.

import { guidedCut, type CutResult } from "./guided-cut";
import { GifEncoder } from "./gif";

/** Thrown when the worker failed, so the caller can start over on the page. */
export class WorkerFailed extends Error {}

type Pending = { ok: (v: unknown) => void; bad: (e: Error) => void };
let worker: Worker | null | undefined;        // undefined: not tried yet; null: not available
let seq = 0;
const waiting = new Map<number, Pending>();

function giveUp(w: Worker) {
  worker = null;
  for (const p of waiting.values()) p.bad(new WorkerFailed("The background worker stopped."));
  waiting.clear();
  try { w.terminate(); } catch { /* already gone */ }
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  try {
    const w = new Worker(new URL("./tools.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const p = waiting.get(e.data.id); if (!p) return;
      waiting.delete(e.data.id);
      if (e.data.error !== undefined) p.bad(new Error(e.data.error)); else p.ok(e.data.result);
    };
    w.onerror = (e) => { e.preventDefault(); giveUp(w); };
    w.onmessageerror = () => giveUp(w);
    worker = w;
  } catch { worker = null; }
  return worker;
}

function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const w = getWorker();
  if (!w) return Promise.reject(new WorkerFailed("No background worker."));
  const id = ++seq;
  return new Promise<T>((ok, bad) => {
    waiting.set(id, { ok: ok as (v: unknown) => void, bad });
    try { w.postMessage({ ...msg, id }, transfer); } catch (e) { waiting.delete(id); bad(new WorkerFailed((e as Error).message)); }
  });
}

/** The guided cut, off the main thread when possible. The inputs are copied, never taken. */
export async function cutInBackground(rgba: Uint8ClampedArray, w: number, h: number, keep: Uint8Array, drop: Uint8Array): Promise<CutResult | null> {
  try {
    const a = rgba.slice(), k = keep.slice(), d = drop.slice();
    return await call<CutResult | null>({ kind: "cut", rgba: a, w, h, keep: k, drop: d }, [a.buffer, k.buffer, d.buffer]);
  } catch (e) {
    if (!(e instanceof WorkerFailed)) throw e;
    return guidedCut(rgba, w, h, keep, drop);
  }
}

/**
 * One GIF being encoded, in the worker or on the page. Same steps as GifEncoder: sample a few frames,
 * build the palette, add every frame, finish. A WorkerFailed from any step means: start again with
 * `inPage: true`. Frames handed in are given to the worker (do not reuse them afterwards).
 */
export class GifJob {
  private constructor(private readonly job: number, private readonly local: GifEncoder | null) {}

  static async start(w: number, h: number, transparent: boolean, inPage = false): Promise<GifJob> {
    if (!inPage && getWorker()) {
      const job = await call<number>({ kind: "gif-start", w, h, transparent });
      return new GifJob(job, null);
    }
    return new GifJob(0, new GifEncoder(w, h, { transparent }));
  }

  async sample(rgba: Uint8ClampedArray): Promise<void> {
    if (this.local) { this.local.addPaletteSample(rgba); return; }
    await call({ kind: "gif-sample", job: this.job, rgba }, [rgba.buffer]);
  }

  async palette(): Promise<void> {
    if (this.local) { this.local.buildPalette(); return; }
    await call({ kind: "gif-palette", job: this.job });
  }

  async frame(rgba: Uint8ClampedArray, delayMs: number): Promise<void> {
    if (this.local) { this.local.addFrame(rgba, delayMs); return; }
    await call({ kind: "gif-frame", job: this.job, rgba, delay: delayMs }, [rgba.buffer]);
  }

  async finish(): Promise<Uint8Array> {
    if (this.local) return this.local.finish();
    return await call<Uint8Array>({ kind: "gif-finish", job: this.job });
  }
}
