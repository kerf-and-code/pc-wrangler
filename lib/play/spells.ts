// lib/play/spells.ts (2026-11-07)
//
// Phase 5b: what a spell does when cast from the play sheet, read from the spell data of either
// edition. Pure functions, no React.
//
// The 2014 records carry structured damage (by slot level, or by character level for cantrips) and
// the attack type; the 2024 records carry only the description. Neither carries the saving throw, so
// for both the save, half damage, healing and the 2024 damage, upcasting and cantrip scaling are read
// from the text, which follows a fixed house style in both books ("makes a Dexterity saving throw,
// taking 8d6 Fire damage on a failed save or half as much damage on a successful one", "The damage
// increases by 1d6 for each spell slot level above 3"). Anything the text does not say plainly is
// left out rather than guessed: the sheet then shows the spell with its description and no roll.

export type SpellRecord = {
  name: string; level: number; school?: string; casting_time?: string; range?: string; components?: string;
  duration?: string; ritual?: boolean; concentration?: boolean; description?: string;
  attack_type?: string | null;
  damage?: { damage_type?: { name?: string } | null; damage_at_slot_level?: Record<string, string>; damage_at_character_level?: Record<string, string> } | null;
};

export type SpellCost = "action" | "bonus" | "reaction" | "other";
export type SpellRoll = {
  attack: "melee" | "ranged" | null;
  save: "str" | "dex" | "con" | "int" | "wis" | "cha" | null;
  half: boolean;
  damage: string | null;           // dice notation at the chosen level, with any modifier added
  damageType: string | null;
  healing: string | null;          // dice notation for healing spells
  count: number;                   // separate attacks or darts from one casting (beams, rays, darts)
  unit: string | null;             // "beam", "ray", "dart" when count can be more than one
};

const ABIL: Record<string, SpellRoll["save"]> = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };

export function spellCost(castingTime: string | undefined): SpellCost {
  const t = (castingTime ?? "").toLowerCase();
  if (/bonus action/.test(t)) return "bonus";
  if (/reaction/.test(t)) return "reaction";
  if (/^\s*(1\s+)?action\b/.test(t)) return "action";
  return "other";
}

// "8d6" plus n more dice of the same size; "3d4 + 3" keeps its modifier.
export function addDice(notation: string, extra: number): string {
  if (!extra) return notation;
  return notation.replace(/^(\d+)d(\d+)/, (_m, c: string, s: string) => `${Number(c) + extra}d${s}`);
}
export function multiplyDice(notation: string, k: number): string {
  if (k <= 1) return notation;
  return notation.replace(/^(\d+)d(\d+)/, (_m, c: string, s: string) => `${Number(c) * k}d${s}`);
}
const tidy = (n: string) => n.replace(/\s+/g, "").replace(/\+-/g, "-");
const cantripTier = (charLevel: number) => (charLevel >= 17 ? 4 : charLevel >= 11 ? 3 : charLevel >= 5 ? 2 : 1);

export function readSpell(sp: SpellRecord, opts: { slot: number; charLevel: number; castMod: number }): SpellRoll {
  const text = (sp.description ?? "").replace(/\s+/g, " ");
  const low = text.toLowerCase();
  const out: SpellRoll = { attack: null, save: null, half: false, damage: null, damageType: null, healing: null, count: 1, unit: null };
  // the source text sometimes breaks a word with a stray space ("Dex terity"), so the ability names
  // are matched with every space taken out
  const squashed = low.replace(/[^a-z0-9]/g, "");

  // the attack: the 2014 field, else "make a melee/ranged spell attack"
  const at = (sp.attack_type ?? "").toLowerCase();
  if (at === "melee" || at === "ranged") out.attack = at;
  else { const m = /make an? (melee|ranged) spell attack/.exec(low); if (m) out.attack = m[1] as "melee" | "ranged"; }

  // the save: the first "<Ability> saving throw"
  const sv = /(strength|dexterity|constitution|intelligence|wisdom|charisma)savingthrow/.exec(squashed);
  if (sv) out.save = ABIL[sv[1]];
  out.half = /half as much damage|half damage/.test(low);

  // the damage: the 2014 tables, else the first "XdY <type> damage" in the text
  const lv = Math.max(sp.level, opts.slot);
  const bySlot = sp.damage?.damage_at_slot_level, byChar = sp.damage?.damage_at_character_level;
  if (sp.level > 0 && bySlot && Object.keys(bySlot).length) {
    out.damage = bySlot[String(lv)] ?? bySlot[String(Math.max(...Object.keys(bySlot).map(Number).filter((k) => k <= lv)))] ?? null;
  } else if (sp.level === 0 && byChar && Object.keys(byChar).length) {
    const k = Math.max(...Object.keys(byChar).map(Number).filter((x) => x <= opts.charLevel), Number(Object.keys(byChar)[0]));
    out.damage = byChar[String(k)] ?? null;
  }
  if (sp.damage?.damage_type?.name) out.damageType = sp.damage.damage_type.name;
  const dm = /(\d+d\d+(?:\s*\+\s*\d+)?)\s+([a-z]+)\s+damage/i.exec(text);
  const fromTable = !!out.damage;
  // beams (Eldritch Blast) come in more numbers at levels 5, 11 and 17, each its own attack
  const beams = /\bbeams?\b/i.test(text) && /(two|second) beams?/i.test(text);
  if (beams) { out.count = cantripTier(opts.charLevel); out.unit = "beam"; }
  if (!out.damage && dm) {
    out.damage = dm[1];
    if (sp.level === 0 && !beams && /cantrip upgrade|damage increases by/i.test(text)) out.damage = multiplyDice(out.damage, cantripTier(opts.charLevel));
    if (sp.level > 0 && lv > sp.level) {
      const up = /increases by (\d+)d(\d+) for each (?:spell )?slot level above (\d+)/i.exec(text);
      if (up) out.damage = addDice(out.damage, Number(up[1]) * (lv - Math.max(sp.level, Number(up[3]))));
    }
  }
  // rays and darts: "You hurl three fiery rays", "You create three glowing darts", one more per slot
  // level. A 2014 table that grows with the slot already totals them (Magic Missile 3d4+3, 4d4+4);
  // one that stays the same at every slot is per ray (Scorching Ray 2d6), so the count applies.
  const many = /\b(two|three|four|five) (?:[a-z]+ )?(rays|darts)\b/i.exec(text);
  const flatTable = !!bySlot && new Set(Object.values(bySlot)).size === 1;
  if ((!fromTable || flatTable) && many) {
    const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
    out.count = words[many[1].toLowerCase()] ?? 1; out.unit = many[2].toLowerCase().replace(/s$/, "");
    const more = /(?:one )?(?:additional|more) (?:ray|dart) for each (?:spell )?slot level above (\d+)/i.exec(text);
    if (more && lv > Number(more[1])) out.count += lv - Number(more[1]);
  }
  if (!out.damageType && dm) out.damageType = dm[2][0].toUpperCase() + dm[2].slice(1).toLowerCase();
  // the 2014 tables write the modifier as MOD
  if (out.damage && /\bMOD\b/.test(out.damage)) out.damage = out.damage.replace(/\+?\s*MOD\b/, `${opts.castMod >= 0 ? "+" : ""}${opts.castMod}`);
  else if (out.damage && /(plus|\+) your spellcasting ability modifier[^.]*damage|damage[^.]*(plus|\+) your spellcasting ability modifier/i.test(text)) {
    out.damage = `${out.damage}${opts.castMod >= 0 ? "+" : ""}${opts.castMod}`;
  }

  // healing: "regains (a number of) Hit Points equal to 2d8 plus your spellcasting ability modifier"
  const hm = /regains? (?:a number of )?hit points equal to (\d+d\d+)( plus your spellcasting ability modifier| \+ your spellcasting ability modifier)?/i.exec(text);
  if (hm) {
    let h = hm[1];
    if (sp.level > 0 && lv > sp.level) {
      const up = /healing increases by (\d+)d(\d+) for each (?:spell )?slot level above (\d+)/i.exec(text);
      if (up) h = addDice(h, Number(up[1]) * (lv - Math.max(sp.level, Number(up[3]))));
    }
    out.healing = hm[2] ? `${h}${opts.castMod >= 0 ? "+" : ""}${opts.castMod}` : h;
    if (!dm) { out.damage = null; out.damageType = null; }
  }
  if (out.damage) out.damage = tidy(out.damage);
  if (out.healing) out.healing = tidy(out.healing);
  return out;
}

// Can this spell be cast with a higher slot to more effect? (The text or the 2014 table says so.)
export function upcasts(sp: SpellRecord): boolean {
  if (sp.level === 0) return false;
  if (sp.damage?.damage_at_slot_level && Object.keys(sp.damage.damage_at_slot_level).length > 1) return true;
  return /higher[- ]level spell slot|at higher levels|for each (spell )?slot level above/i.test(sp.description ?? "");
}

export const ORD = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
