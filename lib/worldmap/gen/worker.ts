// lib/worldmap/gen/worker.ts
// The generation Web Worker: runs the whole pipeline off the main thread so a 250x250 world never
// freezes the page, posting per-pass progress as it goes and the finished Fields when done. The panel
// instantiates it with new Worker(new URL("./worker.ts", import.meta.url)).

import { generateTerrain } from "./pipeline";
import type { GenConfig } from "./types";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ config: GenConfig }>) => void) | null;
  postMessage: (message: unknown) => void;
};

ctx.onmessage = (e) => {
  try {
    const fields = generateTerrain(e.data.config, (p) => ctx.postMessage({ type: "progress", ...p }));
    ctx.postMessage({ type: "done", fields });
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

export {};
