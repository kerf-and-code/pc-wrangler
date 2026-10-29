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

export const MONSTER_SOURCES: Record<string, MonsterSource> = {
  "srd-2014": {
    key: "srd-2014", title: "System Reference Document 5.1", short: "SRD 5.1",
    publisher: "Wizards of the Coast", license: "CC BY 4.0", thirdParty: false,
  },
  "srd-2024": {
    key: "srd-2024", title: "System Reference Document 5.2", short: "SRD 5.2",
    publisher: "Wizards of the Coast", license: "CC BY 4.0", thirdParty: false,
  },
  "kc-mm24": {
    key: "kc-mm24", title: "Monster Manual (2024), Kerf and Code wording", short: "MM 2024",
    publisher: "Kerf and Code", license: "Kerf and Code", thirdParty: false,
  },
  "kc-au": {
    key: "kc-au", title: "Arcana Unleashed, Kerf and Code wording", short: "Arcana Unleashed",
    publisher: "Kerf and Code", license: "Kerf and Code", thirdParty: false,
  },
  "kc-aud": {
    key: "kc-aud", title: "Arcana Unleashed: Deadfall, Kerf and Code wording", short: "Deadfall",
    publisher: "Kerf and Code", license: "Kerf and Code", thirdParty: false,
  },
  tob: {
    key: "tob", title: "Tome of Beasts", short: "Tome of Beasts",
    publisher: "Kobold Press", license: "OGL 1.0a", thirdParty: true,
    notice: "Tome of Beasts. Copyright 2016, Open Design; Authors Chris Harris, Dan Dillon, Rodrigo Garcia Carmona, and Wolfgang Baur.",
    url: "https://koboldpress.com/tome-of-beasts/",
  },
  "tob-2023": {
    key: "tob-2023", title: "Tome of Beasts 1 (2023 Edition)", short: "Tome of Beasts 2023",
    publisher: "Kobold Press", license: "OGL 1.0a", thirdParty: true,
    notice: "Tome of Beasts. 2023 Open Design LLC. All rights reserved.",
    url: "https://koboldpress.com/kpstore/product/tome-of-beasts-1-2023-edition-hardcover/",
  },
  tob2: {
    key: "tob2", title: "Tome of Beasts 2", short: "Tome of Beasts 2",
    publisher: "Kobold Press", license: "OGL 1.0a", thirdParty: true,
    notice: "Tome of Beasts 2. Copyright 2020 Open Design LLC; Authors Wolfgang Baur, Celeste Conowitch, Darrin Drader, James Introcaso, Philip Larwood, Jeff Lee, Kelly Pawlik, Brian Suskind, Mike Welham.",
    url: "https://koboldpress.com/tome-of-beasts-2/",
  },
  tob3: {
    key: "tob3", title: "Tome of Beasts 3", short: "Tome of Beasts 3",
    publisher: "Kobold Press", license: "OGL 1.0a", thirdParty: true,
    notice: "Tome of Beasts 3. ©2022 Open Design LLC. All rights reserved.",
    url: "https://koboldpress.com/tome-of-beasts-3/",
  },
  ccdx: {
    key: "ccdx", title: "Creature Codex", short: "Creature Codex",
    publisher: "Kobold Press", license: "OGL 1.0a", thirdParty: true,
    notice: "Creature Codex. © 2018 Open Design LLC; Authors Wolfgang Baur, Dan Dillon, Richard Green, James Haeck, Chris Harris, Jeremy Hochhalter, James Introcaso, Chris Lockey, Shawn Merwin, and Jon Sawatsky.",
    url: "https://koboldpress.com/kpstore/product/creature-codex-for-5th-edition-dnd/",
  },
  "a5e-mm": {
    key: "a5e-mm", title: "Level Up: Advanced 5th Edition Monstrous Menagerie", short: "Monstrous Menagerie (A5E)",
    publisher: "EN Publishing", license: "OGL 1.0a", thirdParty: true,
    notice: "Level Up: Advanced 5th Edition Monstrous Menagerie. Copyright 2021, EN Publishing.",
    url: "https://www.levelup5e.com",
  },
  tdcs: {
    key: "tdcs", title: "Critical Role: Tal’Dorei Campaign Setting", short: "Tal’Dorei",
    publisher: "Green Ronin Publishing", license: "OGL 1.0a", thirdParty: true,
    notice: "Critical Role: Tal’Dorei Campaign Setting is ©2017 Green Ronin Publishing, LLC. All rights reserved.",
  },
  bfrd: {
    key: "bfrd", title: "Black Flag Roleplaying Reference Document", short: "Black Flag",
    publisher: "Kobold Press", license: "ORC", thirdParty: true,
    notice: "ORC NOTICE: This product is licensed under the ORC License, located at the Library of Congress at TX 9-307-067, and available online at various locations including koboldpress.com/orclicense and others. All warranties are disclaimed as set forth therein.",
    url: "https://koboldpress.com/black-flag-reference-document/",
  },
};

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
