// lib/class-menus.ts
//
// Menus a character picks from AT THE MOMENT OF USE, not at build time.
//
// WHY THESE ARE NOT CLASS_CHOICES
//   A rogue does not choose Poison as *their* Cunning Strike. They choose it on the hit, and a
//   different one on the next hit. Recording it as a build decision would put a permanent answer
//   where the rules ask a fresh question every turn - and the sheet would then be confidently wrong
//   about a character who used Trip last round.
//
// WHY THEY ARE NOT CLASS_ACTIONS EITHER
//   Those spend from a tracked pool and get a button that decrements it. These cost Sneak Attack
//   dice FORGONE, or nothing at all. Forgone damage is not a resource the tracker holds, and a
//   button that pretended to spend one would be inventing a pool.
//
// SO THEY ARE REFERENCE. The Roll tab shows them because that is where a player is sitting when the
// question comes up: what can I do with this hit. Nothing is stored, nothing is spent, and the list
// is the whole feature.

export type ClassMenu = {
  className: string;
  subclass?: string;
  level: number;
  name: string;
  /** One line on when the menu applies, above the options. */
  when: string;
  options: { name: string; summary: string; cost?: string }[];
};

export const CLASS_MENUS: ClassMenu[] = [
  {
    className: "Rogue", level: 5, name: "Cunning Strike",
    when: "On a Sneak Attack hit, forgo dice to add an effect. The target's save DC is your Rogue save DC.",
    options: [
      { name: "Poison", cost: "1d6", summary: "CON save or Poisoned for 1 minute, repeating at the end of each turn" },
      { name: "Trip", cost: "1d6", summary: "DEX save or knocked Prone, if the target is Large or smaller" },
      { name: "Withdraw", cost: "1d6", summary: "Move up to half your Speed without provoking Opportunity Attacks" },
    ],
  },
  {
    className: "Rogue", level: 14, name: "Devious Strikes",
    when: "More Cunning Strike options, on the same terms.",
    options: [
      { name: "Daze", cost: "2d6", summary: "CON save or the target gets only a move or one action next turn, not both" },
      { name: "Knock Out", cost: "6d6", summary: "CON save or Unconscious for 1 minute, ending if it takes damage" },
      { name: "Obscure", cost: "3d6", summary: "DEX save or Blinded until the end of its next turn" },
    ],
  },
  {
    className: "Monk", subclass: "Warrior of the Open Hand", level: 3, name: "Open Hand Technique",
    when: "On a Flurry of Blows hit, one of these on each of the two strikes.",
    options: [
      { name: "Addle", summary: "The target cannot take Reactions until the start of your next turn" },
      { name: "Push", summary: "STR save or pushed up to 15 feet away" },
      { name: "Topple", summary: "DEX save or knocked Prone" },
    ],
  },
  {
    className: "Monk", level: 6, name: "Empowered Strikes",
    when: "Whenever you deal damage with an Unarmed Strike.",
    options: [
      { name: "Force", summary: "Deal Force damage instead" },
      { name: "Normal", summary: "Keep the weapon's usual damage type" },
    ],
  },
  {
    className: "Monk", level: 10, name: "Self-Restoration",
    when: "At the end of each of your turns, end one condition on yourself.",
    options: [
      { name: "Charmed", summary: "Ends on you" },
      { name: "Frightened", summary: "Ends on you" },
      { name: "Poisoned", summary: "Ends on you" },
    ],
  },
];

/** The menus this character has reached, subclass-gated the same way choices are. */
export function menusFor(className: string, subclass: string, level: number): ClassMenu[] {
  return CLASS_MENUS
    .filter((m) => m.className === className && m.level <= level)
    .filter((m) => !m.subclass || m.subclass === subclass)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}
