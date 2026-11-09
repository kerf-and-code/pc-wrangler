// tests/max-flow.test.ts: the guided cut's max-flow solver against a plain Edmonds-Karp, on random
// graphs, plus the min-cut it reports (the cut's capacity must equal the flow).
import { describe, expect, it } from "vitest";
import { MaxFlow } from "@/lib/tabletop/guided-cut";

function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; }

function edmondsKarp(n: number, cap: number[][]): number {
  const N = n + 2, s = n, t = n + 1, c = cap.map((r) => r.slice());
  let flow = 0;
  for (;;) {
    const prev = new Array(N).fill(-1); prev[s] = s; const q = [s];
    while (q.length && prev[t] < 0) { const u = q.shift()!; for (let v = 0; v < N; v++) if (prev[v] < 0 && c[u][v] > 0) { prev[v] = u; q.push(v); } }
    if (prev[t] < 0) return flow;
    let b = Infinity; for (let v = t; v !== s; v = prev[v]) b = Math.min(b, c[prev[v]][v]);
    for (let v = t; v !== s; v = prev[v]) { c[prev[v]][v] -= b; c[v][prev[v]] += b; }
    flow += b;
  }
}

describe("MaxFlow", () => {
  it("matches Edmonds-Karp and gives a cut equal to the flow on 3,000 random graphs", () => {
    const r = rng(42);
    let bad = 0;
    for (let trial = 0; trial < 3000; trial++) {
      const n = 2 + Math.floor(r() * 14), N = n + 2;
      const cap = Array.from({ length: N }, () => new Array(N).fill(0));
      const g = new MaxFlow(n, n * n);
      for (let i = 0; i < n; i++) {
        const cs = r() < 0.4 ? Math.floor(r() * 20) : 0, ct = r() < 0.4 ? Math.floor(r() * 20) : 0;
        g.addTerminal(i, cs, ct); cap[n][i] += cs; cap[i][n + 1] += ct;
      }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (r() < 0.35) {
        const a = Math.floor(r() * 15), b = Math.floor(r() * 15);
        g.addEdge(i, j, a, b); cap[i][j] += a; cap[j][i] += b;
      }
      const f1 = g.maxflow(), f2 = edmondsKarp(n, cap);
      let cut = 0; const S = (v: number) => v === n || (v < n && g.isSource(v));
      for (let u = 0; u < N; u++) for (let v = 0; v < N; v++) if (S(u) && !S(v) && v !== n) cut += cap[u][v];
      if (f1 !== f2 || cut !== f2) bad++;
    }
    expect(bad).toBe(0);
  });
});
