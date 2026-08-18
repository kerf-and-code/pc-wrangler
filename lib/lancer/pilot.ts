// Lancer pilot progression: TALENTS (ranked I to III) and LICENSES (frame license lines, ranked I to
// III). Parallel split to the loadout files: this is the types + budget rules; pilot-data.ts holds the
// talent list, and the license list is derived from the frames (each non-GMS frame is a license line).
//
// LICENSING: talent/frame identity is used under the Lancer Third Party License (see lib/systems/lancer.ts).
// Only MECHANICS ship (which talents/licenses are taken and at what rank), never Massif Press's rank or
// effect prose.
//
// Advancement (Lancer Core Rulebook, Personal Advancement): a pilot starts at LL0 with 3 talent points
// and 0 license ranks, and each level gains one of each. So talent points available = 3 + level, license
// ranks available = level. A single talent or license caps at rank 3. (Core bonuses arrive every third
// level; those are a separate layer, not tracked here.)

export const MAX_TALENT_RANK = 3;
export const MAX_LICENSE_RANK = 3;

export interface LancerTalent {
  id: string;
  name: string;
}

// A license line the pilot can rank up: derived from a licensed (non-GMS) frame.
export interface LancerLicense {
  id: string;        // the frame id the license is named for
  name: string;
  manufacturer: string;
}

// rank maps: id -> rank (1..3). A missing key or 0 means "not taken".
export type RankMap = Record<string, number>;

export function talentPointsAvailable(level: number): number {
  return 3 + Math.max(0, Math.min(12, Math.round(level) || 0));
}
export function licenseRanksAvailable(level: number): number {
  return Math.max(0, Math.min(12, Math.round(level) || 0));
}

export function ranksSpent(map: RankMap): number {
  return Object.values(map).reduce((n, r) => n + Math.max(0, r || 0), 0);
}

export function clampRank(rank: number, max: number): number {
  return Math.max(1, Math.min(max, Math.round(rank) || 1));
}

// Immutable helpers for editing a rank map.
export function setRank(map: RankMap, id: string, rank: number, max: number): RankMap {
  return { ...map, [id]: clampRank(rank, max) };
}
export function removeRank(map: RankMap, id: string): RankMap {
  const next = { ...map };
  delete next[id];
  return next;
}
