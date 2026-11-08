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
//
// Phase 5i.1 (Terry, 2026-11-08, from an imported paladin): class features that change an attack are
// applied by applyAttackFeatures: the Archery and Dueling fighting styles, and the paladin's extra
// radiant die on melee hits (Radiant Strikes in 2024, Improved Divine Smite in 2014). Extra dice of
// another damage type ride in `bonus`, shown beside the weapon's own damage and rolled with it
// (fullDamage). A magic weapon whose record has no damage of its own (Cinnabar Rapier) attacks as its
// base weapon (baseWeaponFor).

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
  /** Extra damage dice of their own type (Radiant Strikes' 1d8 radiant), rolled with the attack's damage. */
  bonus?: { dice: string; type: string; label: string }[];
  /** What changed this row (Dueling +2 damage, Archery +2 to hit), shown under it. */
  notes?: string[];
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

// The damage an attack rolls: the weapon's own dice plus every bonus die (one roll, one total).
export function fullDamage(a: AttackRow): string {
  return [a.damage, ...(a.bonus ?? []).map((b) => b.dice)].join("+");
}
// The damage as the sheet shows it: "1d8+5 piercing + 1d8 radiant".
export function damageText(a: AttackRow, dice: string = a.damage): string {
  return [`${dice} ${a.damageType.toLowerCase()}`, ...(a.bonus ?? []).map((b) => `${b.dice} ${b.type.toLowerCase()}`)].join(" + ");
}

// Add a flat amount to a damage expression's modifier: "1d8+3" + 2 -> "1d8+5", "1d6" + 2 -> "1d6+2".
export function addToDamage(dice: string, n: number): string {
  if (!n) return dice;
  const m = /^(.*?)([+-]\d+)$/.exec(dice);
  const base = m ? m[1] : dice, mod = (m ? Number(m[2]) : 0) + n;
  return mod ? `${base}${sign(mod)}` : base;
}

export type AttackFeatureInputs = {
  /** Fighting Style feats the character has (Dueling, Archery...). */
  fightingStyles: string[];
  paladinLevel: number;
  ruleset: "2014" | "2024";
};

// Apply the class features that change attack rows. Pure: returns new rows.
export function applyAttackFeatures(rows: AttackRow[], f: AttackFeatureInputs): AttackRow[] {
  const styles = new Set(f.fightingStyles.map((x) => x.toLowerCase()));
  return rows.map((r0) => {
    const r: AttackRow = { ...r0, bonus: [...(r0.bonus ?? [])], notes: [...(r0.notes ?? [])] };
    const twoHanded = r.properties.some((p) => /^two-handed/i.test(p));
    // Archery: +2 to attack rolls with ranged weapons
    if (styles.has("archery") && r.source === "weapon" && !r.melee) { r.toHit += 2; r.notes!.push("Archery +2 to hit"); }
    // Dueling: +2 damage with a one-handed melee weapon (the sheet cannot see your other hand)
    if (styles.has("dueling") && r.source === "weapon" && r.melee && !twoHanded) {
      r.damage = addToDamage(r.damage, 2);
      r.notes!.push("Dueling +2 damage, holding it in one hand and no other weapon");
    }
    // the paladin's radiant die on every melee hit
    if (f.paladinLevel >= 11 && r.melee && (r.source === "weapon" || (f.ruleset === "2024" && r.source === "unarmed"))) {
      r.bonus!.push({ dice: "1d8", type: "Radiant", label: f.ruleset === "2024" ? "Radiant Strikes" : "Improved Divine Smite" });
    }
    if (!r.bonus!.length) delete r.bonus;
    if (!r.notes!.length) delete r.notes;
    return r;
  });
}

// A magic weapon whose own record carries no damage (Cinnabar Rapier, a "+1 Longsword" written out)
// attacks as its base weapon: named in the record's attunement note, or the longest weapon name that
// ends the item's name. Returns that weapon's record under the magic item's name, or null.
export function baseWeaponFor(rec: { name: string; category?: string; attunement_note?: string | null } | undefined, weapons: WeaponRecord[]): WeaponRecord | null {
  if (!rec || (rec.category ?? "").toLowerCase() !== "weapon") return null;
  const byName = new Map(weapons.filter(isWeapon).map((w) => [w.name.toLowerCase(), w]));
  const note = (rec.attunement_note ?? "").toLowerCase().trim();
  let base = note ? byName.get(note) ?? null : null;
  if (!base) {
    const n = rec.name.toLowerCase();
    for (const [k, w] of byName) if ((n.endsWith(` ${k}`) || n.startsWith(`${k},`)) && (!base || k.length > base.name.length)) base = w;
  }
  return base ? { ...base, name: rec.name } : null;
}
