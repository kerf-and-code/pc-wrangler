// lib/worldmap/gen/names.ts
// Seeded, deterministic fantasy place-name generator. Same world seed + hex index always yields the
// same name, so a regenerated or re-shared world reads identically. Names are biome-flavored: coastal
// settlements lean to ports and havens, mountains to holds and crags, swamps to mires. Pure.

import { hashSeed, mulberry32 } from "./rng";

const ROOTS = [
  "Dusk", "Thorn", "Black", "Grey", "Oak", "Stone", "Iron", "Frost", "Wolf", "Raven", "Ash", "Elder",
  "Bram", "Fair", "Green", "Red", "White", "Wind", "Storm", "Bright", "Deep", "High", "Hollow", "Mist",
  "Moor", "Bel", "Har", "Cald", "Dun", "Gild", "Marl", "Ald", "Cor", "Dre", "Gorm", "Hal", "Kel",
  "Lorn", "Mor", "Nor", "Perr", "Rill", "Sel", "Tor", "Vael", "Wend", "Bry", "Fenn",
];

const SUF_GENERAL = ["ford", "ton", "bury", "field", "hollow", "gate", "stead", "wick", "mere", "dale", "ham", "bourne", "worth", "ley", "by", "thorpe", "combe", "wold"];
const SUF_COAST = ["port", "haven", "harbor", "bay", "strand", "cove", "wharf", "mouth"];
const SUF_MOUNTAIN = ["crag", "peak", "hold", "fell", "spire", "crest", "ridge", "cairn"];
const SUF_SWAMP = ["mire", "marsh", "fen", "bog", "moor", "murk", "slough"];
const SUF_DESERT = ["waste", "dune", "reach", "scar", "hollow", "barrow"];
const SUF_FOREST = ["wood", "grove", "thicket", "glade", "hollow", "shaw", "holt", "copse"];

function sufFor(biome: number): string[] {
  if (biome === 18 || biome === 19) return SUF_COAST;
  if (biome === 20 || biome === 11 || biome === 12) return SUF_MOUNTAIN;
  if (biome === 13 || biome === 14) return SUF_SWAMP;
  if (biome === 8 || biome === 9) return SUF_DESERT;
  if (biome === 3 || biome === 4 || biome === 5 || biome === 6 || biome === 25 || biome === 27) return SUF_FOREST;
  return SUF_GENERAL;
}

function pick<T>(rnd: () => number, arr: readonly T[]): T { return arr[Math.floor(rnd() * arr.length)]; }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function settlementName(seed: string | number, index: number, biome: number): string {
  const rnd = mulberry32(hashSeed(`${seed}:settle:${index}`));
  const root = pick(rnd, ROOTS);
  const pool = rnd() < 0.55 ? sufFor(biome) : SUF_GENERAL;
  let suf = pick(rnd, pool);
  if (root[root.length - 1].toLowerCase() === suf[0].toLowerCase()) suf = suf.slice(1); // avoid Moor+moor
  return cap(root) + suf;
}

const D_ADJ = ["Sunken", "Shattered", "Forgotten", "Weeping", "Hollow", "Gloom", "Ashen", "Broken", "Buried", "Cursed", "Silent", "Blighted", "Fallen", "Ruined", "Lost", "Grim", "Dread", "Wretched", "Sundered", "Withered"];
const D_PLACE = ["Barrow", "Vault", "Crypt", "Hold", "Keep", "Warren", "Delve", "Spire", "Tomb", "Halls", "Deep", "Sanctum", "Catacomb", "Lair", "Undercroft", "Redoubt", "Reliquary", "Bastion"];
const D_TAIL = ["moor", "fell", "mere", "vale", "reach", "gloom"];

export function dungeonName(seed: string | number, index: number): string {
  const rnd = mulberry32(hashSeed(`${seed}:dungeon:${index}`));
  const r = rnd();
  if (r < 0.5) return `The ${pick(rnd, D_ADJ)} ${pick(rnd, D_PLACE)}`;
  if (r < 0.8) return `${cap(pick(rnd, ROOTS))}${pick(rnd, SUF_FOREST)} ${pick(rnd, D_PLACE)}`;
  return `${pick(rnd, D_PLACE)} of ${cap(pick(rnd, ROOTS))}${pick(rnd, D_TAIL)}`;
}

const CAVE_ADJ = ["Gloom", "Whisper", "Echo", "Shadow", "Drip", "Bramble", "Hollow", "Dusk", "Grim", "Moss"];

export function caveName(seed: string | number, index: number): string {
  const rnd = mulberry32(hashSeed(`${seed}:cave:${index}`));
  if (rnd() < 0.5) return `${pick(rnd, CAVE_ADJ)}hollow Cave`;
  return `The ${pick(rnd, CAVE_ADJ)} Cave`;
}

// Exported for later use: rivers need a name column on map_features; regions are GM-authored today.
const WATERWORD = ["water", "run", "brook", "wash", "flow", "mere", "bourne", "rill", "race", "burn"];
export function riverName(seed: string | number, index: number): string {
  const rnd = mulberry32(hashSeed(`${seed}:river:${index}`));
  return `the ${cap(pick(rnd, ROOTS))}${pick(rnd, WATERWORD)}`;
}

const REGIONWORD = ["Reach", "Marches", "Vale", "Wilds", "Expanse", "Hinterland", "Downs", "Weald", "Moors", "Wastes", "Fells", "Heath"];
export function regionName(seed: string | number, index: number): string {
  const rnd = mulberry32(hashSeed(`${seed}:region:${index}`));
  return `the ${cap(pick(rnd, ROOTS))}${pick(rnd, SUF_FOREST)} ${pick(rnd, REGIONWORD)}`;
}
