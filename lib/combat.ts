// lib/combat.ts
//
// The combat runner's model: saved encounters, live combatants, and reading attacks out of a D&D
// stat block so the GM can roll them with one click. Pure functions, no React, no Supabase.
//
// STORAGE (supabase/migrations/p101-encounters-combats.sql)
//   encounters.foes    EncounterFoe[]  what the GM built, with a pointer to each foe's stat block
//   combats.combatants Combatant[]     the fight, IN TURN ORDER; combats.turn indexes into it
//
// A monster combatant carries a SNAPSHOT of its stat block (`block`), taken when the fight starts.
// The runner then never needs the monster library again, and editing a stat block mid-campaign does
// not rewrite a fight already in progress.

import type { StatBlockDoc, NamedEntry } from "@/lib/stat-blocks";

/** A foe as saved on an encounter. origin says where its stat block lives. */
export type EncounterFoe = {
  name: string;
  cr: string;
  count: number;
  origin: "mine" | "srd" | "custom";
  statBlockId?: string | null;  // origin "mine": stat_blocks.id
  sourceKey?: string | null;    // origin "srd": the monster file's source_key (srd-2024, tob2, kc-mm24, ...)
  edition?: string | null;      // origin "srd": which library list it was picked from (2014 / 2024 / both)
};

export type Combatant = {
  id: string;
  kind: "pc" | "monster";
  name: string;
  characterId?: string | null;  // PCs: characters.id
  initiative: number | null;
  initBonus: number;
  hp: number | null;
  maxHp: number | null;
  tempHp: number;
  ac: number | null;
  conditions: string[];
  hidden: boolean;              // monsters not yet revealed to players (the player view leaves them out)
  defeated: boolean;
  block?: StatBlockDoc | null;  // monsters: stat block snapshot
  note?: string;
  // Action economy (phase 4c, p112). The database resets econ when this combatant's turn begins.
  econ?: Econ | null;
  speed?: number | null;        // walking speed in feet; null = not tracked
  attacksPerAction?: number;    // attacks one Attack action makes (Extra Attack); 1 when missing
};

/** What this combatant has spent of its turn. Missing means a fresh turn. */
export type EconSpend = { cost: "action" | "attack" | "bonus" | "reaction" | "move"; what: string; at: number; locked?: boolean };
export type Econ = {
  action: boolean; bonus: boolean; reaction: boolean;   // true once used
  moved: number; dash: number;                           // feet moved this turn, feet added by Dash
  attacks: number;                                       // attacks left from an Attack action already taken
  log?: EconSpend[];
};

// The fifteen conditions (identical names in 2014 and 2024) plus Concentrating, which a GM tracks on
// casters constantly even though it is not a condition.
export const CONDITIONS = [
  "Blinded", "Charmed", "Deafened", "Exhaustion", "Frightened", "Grappled", "Incapacitated", "Invisible",
  "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious", "Concentrating",
];

export const abilityMod = (score: number | null | undefined): number =>
  typeof score === "number" && Number.isFinite(score) ? Math.floor((score - 10) / 2) : 0;

/** Initiative bonus: the stat block's own initiative if it lists one (2024 blocks do), else DEX mod. */
export function initBonusOf(block: StatBlockDoc | null | undefined): number {
  if (!block) return 0;
  if (typeof block.initiative === "number" && Number.isFinite(block.initiative)) return block.initiative;
  return abilityMod(block.dex);
}

let seq = 0;
export const combatantId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Turn order: highest initiative first; ties broken by initiative bonus, then PCs before monsters,
 *  then name. Combatants with no initiative yet sort last, in the order they were added. */
export function sortForTurns(cs: Combatant[]): Combatant[] {
  return cs
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ai = a.c.initiative, bi = b.c.initiative;
      if (ai == null && bi == null) return a.i - b.i;
      if (ai == null) return 1;
      if (bi == null) return -1;
      if (bi !== ai) return bi - ai;
      if (b.c.initBonus !== a.c.initBonus) return b.c.initBonus - a.c.initBonus;
      if (a.c.kind !== b.c.kind) return a.c.kind === "pc" ? -1 : 1;
      return a.c.name.localeCompare(b.c.name);
    })
    .map((x) => x.c);
}

/** Monster combatants for one foe line: "Goblin 1", "Goblin 2"... when there is more than one. */
export function monsterCombatants(name: string, count: number, block: StatBlockDoc | null): Combatant[] {
  const n = Math.max(1, Math.floor(count) || 1);
  return Array.from({ length: n }, (_, i) => ({
    id: combatantId(),
    kind: "monster" as const,
    name: n > 1 ? `${name} ${i + 1}` : name,
    initiative: null,
    initBonus: initBonusOf(block),
    hp: block?.hp ?? null,
    maxHp: block?.hp ?? null,
    tempHp: 0,
    ac: block?.ac ?? null,
    conditions: [],
    hidden: false,
    defeated: false,
    block: block ?? null,
  }));
}

export function pcCombatant(c: { id: string; name: string }): Combatant {
  return {
    id: combatantId(), kind: "pc", name: c.name, characterId: c.id,
    initiative: null, initBonus: 0, hp: null, maxHp: null, tempHp: 0, ac: null,
    conditions: [], hidden: false, defeated: false,
  };
}

/** Damage first eats temporary HP, then HP (floored at 0). Healing raises HP up to max. */
export function applyDamage(c: Combatant, amount: number): Combatant {
  const dmg = Math.max(0, Math.floor(amount));
  const fromTemp = Math.min(c.tempHp, dmg);
  const rest = dmg - fromTemp;
  const hp = c.hp == null ? null : Math.max(0, c.hp - rest);
  return { ...c, tempHp: c.tempHp - fromTemp, hp, defeated: c.kind === "monster" && hp === 0 ? true : c.defeated };
}
export function applyHealing(c: Combatant, amount: number): Combatant {
  const heal = Math.max(0, Math.floor(amount));
  if (c.hp == null) return c;
  const hp = c.maxHp == null ? c.hp + heal : Math.min(c.maxHp, c.hp + heal);
  return { ...c, hp, defeated: hp > 0 ? false : c.defeated };
}

// ---- reading attacks out of a stat block -----------------------------------------------------------
// Three phrasings appear in the data, and all are handled:
//   2014:          "Melee Weapon Attack: +3 to hit, reach 5 ft. ... Hit: 4 (1d6 + 1) piercing damage."
//   2024 SRD:      "Melee Attack Roll: +4, reach 5 ft. 5 (1d6 + 2) Slashing damage"
//   2024 books:    "Melee attack, +10, reach 10 ft.; 19 (3d8 + 6) Slashing"
// and saves as "DC 13 Strength saving throw" or "Dexterity Saving Throw: DC 21".

const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];

export type ParsedAction = {
  name: string;
  desc: string;
  toHit: number | null;
  damage: { dice: string; type: string }[];
  save: { dc: number; ability: string | null } | null;
};

/** Normalize "1d6 + 2" / "2d8 \u2212 1" to the roller's notation ("1d6+2"). */
const diceNotation = (s: string) => s.replace(/\s+/g, "").replace(/[\u2212\u2013]/g, "-");

export function parseAction(entry: NamedEntry): ParsedAction {
  const desc = String(entry.desc ?? "");
  const hit = desc.match(/\+(\d+)\s*to hit/i) || desc.match(/attack(?:\s+roll)?\s*[:,]\s*\+(\d+)/i);
  const damage: { dice: string; type: string }[] = [];
  const re = /\d+\s*\(\s*(\d+d\d+(?:\s*[+\-\u2212\u2013]\s*\d+)?)\s*\)\s*([A-Za-z]+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(desc))) {
    const t = (m[2] || "").toLowerCase();
    damage.push({ dice: diceNotation(m[1]), type: DAMAGE_TYPES.includes(t) ? t : "" });
  }
  let save: ParsedAction["save"] = null;
  const dc = desc.match(/DC\s*(\d+)/);
  if (dc) {
    // Full names or the 3-letter abbreviations ("DC 16 Dex save"); a grapple's "escape DC 15" has no
    // ability on purpose and stays null.
    const ab = ABILITIES.find((a) => new RegExp(`\\b(${a}|${a.slice(0, 3)})\\s+(saving throw|save)`, "i").test(desc)) ?? null;
    save = { dc: Number(dc[1]), ability: ab };
  }
  return { name: entry.name, desc, toHit: hit ? Number(hit[1]) : null, damage, save };
}

/** Every rollable action group of a stat block, in the order a GM looks for them. */
export function blockActions(block: StatBlockDoc | null | undefined): { group: string; actions: ParsedAction[] }[] {
  if (!block) return [];
  const groups: [string, NamedEntry[] | undefined][] = [
    ["Actions", block.actions], ["Bonus actions", block.bonus_actions], ["Reactions", block.reactions],
    ["Legendary actions", block.legendary_actions], ["Traits", block.special_abilities],
  ];
  return groups
    .map(([group, list]) => ({ group, actions: (list ?? []).filter((e) => e && e.name).map(parseAction) }))
    .filter((g) => g.actions.length > 0);
}

/** Resolve a saved foe to a stat block snapshot from the GM's own blocks or the monster library. */
export function resolveFoeBlock(
  foe: EncounterFoe,
  ownBlocks: { id: string; block: unknown; system?: string | null }[],
  libraryFor: (edition: string) => Record<string, unknown>[],
  fromMonster: (m: Record<string, unknown>) => StatBlockDoc,
): StatBlockDoc | null {
  if (foe.origin === "mine" && foe.statBlockId) {
    const row = ownBlocks.find((b) => b.id === foe.statBlockId);
    return row && (!row.system || row.system === "dnd5e") ? (row.block as StatBlockDoc) : null;
  }
  if (foe.origin === "srd") {
    const list = libraryFor(foe.edition || "both");
    const m = list.find((x) => x.name === foe.name && (!foe.sourceKey || x.source_key === foe.sourceKey))
      ?? list.find((x) => x.name === foe.name);
    return m ? fromMonster(m) : null;
  }
  return null;
}
