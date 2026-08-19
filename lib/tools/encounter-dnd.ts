// lib/tools/encounter-dnd.ts
//
// D&D 5e encounter math for the free, no-login tool. The constants below are copied VERBATIM from the
// in-app builder (app/gm/encounters/page.tsx) so the public tool and the product give identical numbers.
// They are the published DMG values; the only judgement encoded is the same one the in-app tool makes:
// the 2024 method has NO encounter multiplier (ten wolves count as ten wolves), and the 2014 method
// applies the party-size-adjusted multiplier ladder.
//
// If the in-app constants ever change, change them here too; a shared import would be cleaner but would
// mean refactoring the 4,000-line builder, which is a separate job.

// 2024 DMG, XP Budget per Character. [Low, Moderate, High]
export const BUDGET_2024: Record<number, [number, number, number]> = {
  1: [50, 75, 100], 2: [100, 150, 200], 3: [150, 225, 400], 4: [250, 375, 500],
  5: [500, 750, 1100], 6: [600, 1000, 1400], 7: [750, 1300, 1700], 8: [1000, 1700, 2100],
  9: [1300, 2000, 2600], 10: [1600, 2300, 3100], 11: [1900, 2900, 4100], 12: [2200, 3700, 4700],
  13: [2600, 4200, 5400], 14: [2900, 4900, 6200], 15: [3300, 5400, 7800], 16: [3800, 6100, 9800],
  17: [4500, 7200, 11700], 18: [5000, 8700, 14200], 19: [5500, 10700, 17200], 20: [6400, 13200, 22000],
};

// 2014 DMG, XP Thresholds by Character Level. [Easy, Medium, Hard, Deadly]
export const THRESH_2014: Record<number, [number, number, number, number]> = {
  1: [25, 50, 75, 100], 2: [50, 100, 150, 200], 3: [75, 150, 225, 400], 4: [125, 250, 375, 500],
  5: [250, 500, 750, 1100], 6: [300, 600, 900, 1400], 7: [350, 750, 1100, 1700], 8: [450, 900, 1400, 2100],
  9: [550, 1100, 1600, 2400], 10: [600, 1200, 1900, 2800], 11: [800, 1600, 2400, 3600], 12: [1000, 2000, 3000, 4500],
  13: [1100, 2200, 3400, 5100], 14: [1250, 2500, 3800, 5700], 15: [1400, 2800, 4300, 6400], 16: [1600, 3200, 4800, 7200],
  17: [2000, 3900, 5900, 8800], 18: [2100, 4200, 6300, 9500], 19: [2400, 4900, 7300, 10900], 20: [2800, 5700, 8500, 12700],
};

const MULT_LADDER = [0.5, 1, 1.5, 2, 2.5, 3, 4];

function multiplierIndex(monsterCount: number): number {
  if (monsterCount <= 1) return 1;
  if (monsterCount === 2) return 2;
  if (monsterCount <= 6) return 3;
  if (monsterCount <= 10) return 4;
  if (monsterCount <= 14) return 5;
  return 6;
}

export function multiplier2014(monsterCount: number, partySize: number): number {
  let i = multiplierIndex(monsterCount);
  if (partySize > 0 && partySize < 3) i += 1;
  if (partySize > 5) i -= 1;
  return MULT_LADDER[Math.max(0, Math.min(MULT_LADDER.length - 1, i))];
}

// Published SRD CR to XP table. Keys are CR strings so the fractional CRs read naturally in a dropdown.
export const CR_XP: Record<string, number> = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100,
  "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300, "7": 2900, "8": 3900,
  "9": 5000, "10": 5900, "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000,
  "16": 15000, "17": 18000, "18": 20000, "19": 22000, "20": 25000, "21": 33000, "22": 41000,
  "23": 50000, "24": 62000, "25": 75000, "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000,
};

export const CR_LIST = Object.keys(CR_XP);

export type DndMethod = "2024" | "2014";
export type DndFoe = { cr: string; count: number };

export type DndVerdict = {
  method: DndMethod;
  tiers: number[];          // budget/threshold tiers, party-summed
  labels: string[];         // tier labels, aligned to tiers
  foeXpRaw: number;         // raw sum of CR XP times count
  foeXp: number;            // 2014: raw times multiplier; 2024: same as raw
  multiplier: number;       // 1 for 2024
  band: string;             // "Trivial" below the first tier, else the highest tier met
  bandIndex: number;        // -1 when below the first tier
};

// Party is a list of levels (one per PC). Foes are CR + count rows. Mirrors the in-app compute.
export function computeDnd(levels: number[], foes: DndFoe[], method: DndMethod): DndVerdict {
  const validLevels = levels.filter((l) => l >= 1 && l <= 20);
  const partySize = validLevels.length;
  const monsterCount = foes.reduce((n, f) => n + Math.max(0, f.count), 0);
  const foeXpRaw = foes.reduce((sum, f) => sum + (CR_XP[f.cr] ?? 0) * Math.max(0, f.count), 0);

  if (method === "2024") {
    const tiers = [0, 1, 2].map((i) => validLevels.reduce((s, l) => s + BUDGET_2024[l][i], 0));
    const labels = ["Low", "Moderate", "High"];
    const { band, bandIndex } = classify(foeXpRaw, tiers, labels);
    return { method, tiers, labels, foeXpRaw, foeXp: foeXpRaw, multiplier: 1, band, bandIndex };
  }

  const mult = multiplier2014(monsterCount, partySize);
  const foeXp = Math.round(foeXpRaw * mult);
  const tiers = [0, 1, 2, 3].map((i) => validLevels.reduce((s, l) => s + THRESH_2014[l][i], 0));
  const labels = ["Easy", "Medium", "Hard", "Deadly"];
  const { band, bandIndex } = classify(foeXp, tiers, labels);
  return { method, tiers, labels, foeXpRaw, foeXp, multiplier: mult, band, bandIndex };
}

function classify(xp: number, tiers: number[], labels: string[]): { band: string; bandIndex: number } {
  if (xp <= 0 || tiers.length === 0 || xp < tiers[0]) return { band: "Trivial", bandIndex: -1 };
  let idx = 0;
  for (let i = 0; i < tiers.length; i++) if (xp >= tiers[i]) idx = i;
  return { band: labels[idx], bandIndex: idx };
}
