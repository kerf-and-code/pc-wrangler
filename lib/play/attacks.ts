// lib/play/attacks.ts (2026-11-07)
//
// Phase 5b: the attack rows on the play sheet, built from the character's weapons and the derived
// sheet. Pure functions, no React.
//
//   * ability: a finesse weapon uses the better of Strength and Dexterity; a ranged weapon Dexterity;
//     anything else (thrown weapons included) Strength;
//   * proficiency: read from the class's weapon proficiencies text ("Simple weapons and Martial
//     weapons that have the Finesse or Light property", "hand crossbows, longswords"). When the class
//     data carries no such text the weapon counts as proficient, and the row says it was assumed;
//   * a +1, +2 or +3 weapon (the Forge's gear "mod") adds to the attack and the damage;
//   * range, versatile damage and mastery come from the item data of either edition (2014 records
//     carry numbers and a two-handed damage; 2024 records carry them in the property text).

export type WeaponRecord = {
  name: string; category?: string; weapon_category?: string | null; weapon_range?: string | null;
  damage?: { dice: string; type: string } | null; two_handed_damage?: { dice: string; type: string } | null;
  range?: { normal?: number; long?: number } | null; properties?: string[] | null; mastery?: string | null;
};
export type AbilityMods = { str: number; dex: number; con: number; int: number; wis: number; cha: number };

export type AttackRow = {
  key: string; name: string; source: "weapon" | "unarmed";
  toHit: number; damage: string; damageType: string; versatile: string | null;
  range: string; properties: string[]; mastery: string | null;
  ability: "str" | "dex"; proficient: boolean; assumed: boolean; melee: boolean;
};

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const withMod = (dice: string, mod: number) => (mod ? `${dice}${sign(mod)}` : dice);

export function isWeapon(r: WeaponRecord | undefined | null): r is WeaponRecord {
  return !!r && !!r.damage && (r.category === "Weapon" || !!r.weapon_category);
}

// Does the class's weapon proficiency text cover this weapon? null when there is no text to read.
export function weaponProficient(text: string | null | undefined, w: WeaponRecord): boolean | null {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;
  const cat = (w.weapon_category ?? "").toLowerCase();
  const props = (w.properties ?? []).map((p) => p.toLowerCase());
  // "Simple weapons", "Simple and Martial weapons", "Simple weapons and Martial weapons that have..."
  if (cat === "simple" && /\bsimple\b/.test(t) && /weapons/.test(t)) return true;
  if (cat === "martial" && /\bmartial\b/.test(t) && /weapons/.test(t)) {
    const q = /martial weapons that have the ([a-z ,]+?) property/.exec(t);
    if (!q) return true;
    const wanted = q[1].split(/,| or | and /).map((x) => x.trim()).filter(Boolean);
    if (wanted.some((x) => props.some((p) => p.startsWith(x)))) return true;
  }
  // a list of named weapons: "hand crossbows, longswords, rapiers"
  const n = w.name.toLowerCase();
  const plural = n.endsWith("s") ? n : `${n}s`;
  return t.includes(plural) || t.includes(n);
}

export function weaponRange(w: WeaponRecord): string {
  if (w.range?.normal) return w.range.long ? `${w.range.normal}/${w.range.long} ft` : `${w.range.normal} ft`;
  const p = (w.properties ?? []).join(" ");
  const m = /range (\d+)\/(\d+)/i.exec(p);
  if (m) return (w.weapon_range ?? "").toLowerCase() === "melee" ? `5 ft or ${m[1]}/${m[2]} ft` : `${m[1]}/${m[2]} ft`;
  return (w.properties ?? []).some((x) => /reach/i.test(x)) ? "10 ft" : "5 ft";
}

export function versatileDice(w: WeaponRecord): string | null {
  if (w.two_handed_damage?.dice) return w.two_handed_damage.dice;
  for (const p of w.properties ?? []) { const m = /versatile\s*\((\d*d\d+)\)/i.exec(p); if (m) return m[1]; }
  return null;
}

export function weaponAttack(w: WeaponRecord, mods: AbilityMods, prof: number, profText: string | null | undefined, magic = 0, key = w.name): AttackRow {
  const props = w.properties ?? [];
  const finesse = props.some((p) => /^finesse/i.test(p));
  const ranged = (w.weapon_range ?? "").toLowerCase() === "ranged";
  const ability: "str" | "dex" = ranged ? "dex" : finesse && mods.dex > mods.str ? "dex" : "str";
  const known = weaponProficient(profText, w);
  const proficient = known ?? true;
  const am = mods[ability];
  const vers = versatileDice(w);
  return {
    key, name: magic ? `${w.name} +${magic}` : w.name, source: "weapon",
    toHit: am + (proficient ? prof : 0) + magic,
    damage: withMod(w.damage!.dice, am + magic), damageType: w.damage!.type,
    versatile: vers ? withMod(vers, am + magic) : null,
    range: weaponRange(w), properties: props.map((p) => p.replace(/\s*\(.*\)$/, "")), mastery: w.mastery ?? null,
    ability, proficient, assumed: known === null, melee: !ranged,
  };
}

// Unarmed strike: 1 + Strength bludgeoning, or the Martial Arts die with the better of STR and DEX.
export function unarmedAttack(mods: AbilityMods, prof: number, martialArtsDie: number): AttackRow {
  const ability: "str" | "dex" = martialArtsDie && mods.dex > mods.str ? "dex" : "str";
  const am = mods[ability];
  const dmg = martialArtsDie ? withMod(`1d${martialArtsDie}`, am) : `${Math.max(1, 1 + am)}`;
  return {
    key: "unarmed", name: "Unarmed Strike", source: "unarmed", toHit: am + prof, damage: dmg, damageType: "Bludgeoning",
    versatile: null, range: "5 ft", properties: [], mastery: null, ability, proficient: true, assumed: false, melee: true,
  };
}

// Pull the "Weapon Proficiencies" row out of a class's core traits markdown table.
export function weaponProfText(coreTraits: string | null | undefined): string | null {
  for (const line of (coreTraits ?? "").split(/\r?\n/)) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length >= 4 && /^weapon proficienc/i.test(cells[1])) return cells[2];
  }
  return null;
}
