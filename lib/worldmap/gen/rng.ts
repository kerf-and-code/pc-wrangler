// lib/worldmap/gen/rng.ts
// Seeded, splittable RNG (blueprint F13): one master seed, a derived stream per pass, so tweaking a
// downstream parameter never disturbs upstream output and "regenerate settlements, keep terrain" is
// cheap. splitmix32 mixes, mulberry32 is the stream, fnv1a hashes pass names / string seeds.

export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashSeed(seed: string | number): number {
  return typeof seed === "number" ? seed >>> 0 : fnv1a(seed);
}

export function splitmix32(a: number): number {
  a = (a + 0x9e3779b9) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
  return (t ^ (t >>> 15)) >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t + (Math.imul(t ^ (t >>> 7), t | 61) >>> 0)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// passSeed = splitmix32(master ^ fnv1a(passName)); the stream is deterministic and independent.
export function passStream(master: number, passName: string): () => number {
  return mulberry32(splitmix32((master ^ fnv1a(passName)) >>> 0));
}
