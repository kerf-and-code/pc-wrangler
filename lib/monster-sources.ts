// Where each monster in lib/srd/monsters-*.json comes from, keyed on its `source_key`.
//
// The monster files mix three kinds of record:
//   srd-*   Wizards of the Coast System Reference Documents (CC BY 4.0).
//   kc-*    Kerf and Code entries: book statistics with our own wording (Arcana Unleashed, the 2024
//           Monster Manual). Not open content; the wording is ours.
//   others  Third-party bestiaries pulled from Open5e (fetch_srd.py): Kobold Press, EN Publishing and
//           Green Ronin books released as Open Game Content (OGL 1.0a) or under the ORC License.
//
// The third-party ones are what this file exists for. The OGL requires that distributed Open Game
// Content be clearly identified (Section 8) and that each source's copyright notice be carried in
// Section 15. The per-monster label below does the first; `notice` feeds the /licenses page for the
// second. The notice strings are the copyright lines Open5e publishes for each document
// (api.open5e.com/v1/documents), copied exactly; titles, publishers and licenses come from the same API.

import monsterSourcesData from "./srd/monster-sources.json";

export type MonsterLicense = "CC BY 4.0" | "OGL 1.0a" | "ORC" | "Kerf and Code";

export interface MonsterSource {
  key: string;            // source_key as it appears in the data
  title: string;          // full book title
  short: string;          // compact label for list chips
  publisher: string;
  license: MonsterLicense;
  thirdParty: boolean;    // true for the Open5e bestiaries (needs the OGL / ORC notices)
  notice?: string;        // the source's copyright notice, verbatim, for OGL Section 15 / ORC
  url?: string;
}

// The table itself is lib/srd/monster-sources.json, so scripts/build-compendium-index.mjs (plain
// node, no TypeScript loader) reads the same data the app does.
export const MONSTER_SOURCES: Record<string, MonsterSource> = monsterSourcesData as Record<string, MonsterSource>;

export function monsterSource(key: string | null | undefined): MonsterSource | undefined {
  return key ? MONSTER_SOURCES[key] : undefined;
}

// Compact label for a list chip; falls back to the raw key so an unmapped source still shows.
export function monsterSourceLabel(key: string | null | undefined): string {
  if (!key) return "";
  return MONSTER_SOURCES[key]?.short ?? key;
}

// Hover text: full title, publisher and license.
export function monsterSourceTitle(key: string | null | undefined): string {
  const s = monsterSource(key);
  if (!s) return key ?? "";
  return `${s.title} · ${s.publisher} · ${s.license}`;
}

export function isThirdPartyMonster(key: string | null | undefined): boolean {
  return Boolean(key && MONSTER_SOURCES[key]?.thirdParty);
}

// The OGL sources, in a stable order, for the Section 15 list on /licenses.
export const OGL_MONSTER_SOURCES: MonsterSource[] =
  Object.values(MONSTER_SOURCES).filter((s) => s.license === "OGL 1.0a");
