// lib/tools/magic-item-price.ts
//
// Our OWN magic-item pricing, derived transparently. NOT a copy of anyone's price table. The only
// external inputs are the 2024 DMG's rarity price BANDS (which are facts, a short published table) and a
// self-authored heuristic in the spirit of the community "price by usefulness" approach: consumables are
// worth about half a permanent item of the same rarity, and where an item sits inside its band depends on
// how strong it is. No third-party per-item values are used or shipped.
//
// This is a planning estimate, not a market law. Tables vary wildly; the tool says so.

export type Rarity = "common" | "uncommon" | "rare" | "very rare" | "legendary" | "artifact";

export const RARITIES: Rarity[] = ["common", "uncommon", "rare", "very rare", "legendary", "artifact"];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  "very rare": "Very Rare",
  legendary: "Legendary",
  artifact: "Artifact",
};

// 2024 DMG suggested price ranges by rarity, in gp. Legendary is open-ended (50,001+); we cap the top at
// 200,000 so the "how strong" slider has a sane upper end to interpolate toward. Artifacts are not sold.
export const BANDS: Record<Rarity, [number, number] | null> = {
  common: [50, 100],
  uncommon: [101, 500],
  rare: [501, 5000],
  "very rare": [5001, 50000],
  legendary: [50001, 200000],
  artifact: null,
};

// How strong the item is FOR its rarity, which sets where in the band it lands.
export type Power = "minor" | "typical" | "major";
export const POWERS: Power[] = ["minor", "typical", "major"];
export const POWER_LABEL: Record<Power, string> = { minor: "Minor", typical: "Typical", major: "Major" };
const POWER_T: Record<Power, number> = { minor: 0.2, typical: 0.5, major: 0.8 };

// Consumables (potions, scrolls, ammunition, one-shot items) are worth markedly less than a permanent
// item of the same rarity, because you get one use. Half is the widely used rule of thumb.
const CONSUMABLE_FACTOR = 0.5;

export interface PriceInput {
  rarity: Rarity;
  consumable: boolean;
  power: Power;
}

export interface PriceResult {
  priceable: boolean;
  price: number | null;        // gp, null for artifacts
  low: number | null;          // low end for this configuration
  high: number | null;         // high end for this configuration
  band: [number, number] | null; // the raw DMG band
  rationale: string[];
}

// Geometric interpolation across a band. The bands span orders of magnitude (501..5,000), so a linear
// midpoint would sit far too high; the geometric point reads as a sensible "typical" value.
function geoLerp(min: number, max: number, t: number): number {
  return min * Math.pow(max / min, t);
}

export function roundNice(n: number): number {
  if (n <= 0) return 0;
  let step: number;
  if (n < 100) step = 5;
  else if (n < 1000) step = 10;
  else if (n < 10000) step = 50;
  else if (n < 100000) step = 500;
  else step = 1000;
  return Math.round(n / step) * step;
}

export function priceMagicItem({ rarity, consumable, power }: PriceInput): PriceResult {
  const band = BANDS[rarity];
  if (!band) {
    return {
      priceable: false,
      price: null,
      low: null,
      high: null,
      band: null,
      rationale: ["Artifacts are unique and not for sale at any price."],
    };
  }
  const [min, max] = band;
  const factor = consumable ? CONSUMABLE_FACTOR : 1;
  const price = roundNice(geoLerp(min, max, POWER_T[power]) * factor);
  const low = roundNice(min * factor);
  const high = roundNice(max * factor);

  const rationale: string[] = [];
  rationale.push(`${RARITY_LABEL[rarity]} band: ${fmtGp(min)} to ${fmtGp(max)} (2024 DMG).`);
  rationale.push(
    power === "typical"
      ? "Placed mid-band for a typical item of this rarity."
      : power === "minor"
      ? "Placed low in the band for a weaker item of this rarity."
      : "Placed high in the band for a standout item of this rarity.",
  );
  if (consumable) rationale.push("Consumable, so about half a permanent item of the same rarity.");

  return { priceable: true, price, low, high, band, rationale };
}

export function fmtGp(n: number): string {
  return `${n.toLocaleString("en-US")} gp`;
}
