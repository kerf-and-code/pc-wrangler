// Draw Steel titles (MCDM Draw Steel Rules Reference, via the Steel Compendium data set, used under the
// Draw Steel Creator License). A title is earned in play and gated by ECHELON (1st=levels 1-3, 2nd=4-6,
// 3rd=7-9, 4th=10); a hero can hold several over a campaign. MECHANICS ONLY: this stores each title's
// name, its echelon, and a short tag DERIVED from the mechanical shape of its effect (e.g. "grants an
// ability", "Renown", "characteristic increase") - never MCDM's prerequisite/effect prose, which the
// player reads on the title's page in the SRD. Titles whose effect is purely narrative carry "" and the
// Forge shows just the name. See lib/systems/drawsteel.ts for attribution.

export interface DSTitle {
  id: string;
  name: string;
  echelon: 1 | 2 | 3 | 4;
  effect: string;   // short derived effect tag, or "" when it does not reduce to one
}

export const DS_TITLES: DSTitle[] = [
  { id: "ancient-loremaster", name: "Ancient Loremaster", echelon: 1, effect: "choose: characteristic increase, an edge, +language" },
  { id: "battleaxe-diplomat", name: "Battleaxe Diplomat", echelon: 1, effect: "choose: an edge, skill" },
  { id: "brawler", name: "Brawler", echelon: 1, effect: "choose: an edge" },
  { id: "city-rat", name: "City Rat", echelon: 1, effect: "choose: an edge" },
  { id: "doomed", name: "Doomed", echelon: 1, effect: "" },
  { id: "dwarven-legionnaire", name: "Dwarven Legionnaire", echelon: 1, effect: "" },
  { id: "elemental-dabbler", name: "Elemental Dabbler", echelon: 1, effect: "" },
  { id: "faction-member", name: "Faction Member", echelon: 1, effect: "characteristic increase, faction" },
  { id: "local-hero", name: "Local Hero", echelon: 1, effect: "choose: Renown, Wealth, an edge, skill" },
  { id: "mage-hunter", name: "Mage Hunter", echelon: 1, effect: "" },
  { id: "marshal", name: "Marshal", echelon: 1, effect: "choose: an edge" },
  { id: "monster-bane", name: "Monster Bane", echelon: 1, effect: "choose: an edge" },
  { id: "owed-a-favor", name: "Owed a Favor", echelon: 1, effect: "an edge, skill, faction" },
  { id: "presumed-dead", name: "Presumed Dead", echelon: 1, effect: "cheat death" },
  { id: "ratcatcher", name: "Ratcatcher", echelon: 1, effect: "choose: grants an ability" },
  { id: "saved-for-a-worse-fate", name: "Saved for a Worse Fate", echelon: 1, effect: "Wealth, cheat death" },
  { id: "ship-captain", name: "Ship Captain", echelon: 1, effect: "choose: an edge, +language" },
  { id: "troupe-leading-player", name: "Troupe Leading Player", echelon: 1, effect: "choose: an edge, skill" },
  { id: "wanted-dead-or-alive", name: "Wanted Dead or Alive", echelon: 1, effect: "choose: Renown, an edge" },
  { id: "zombie-slayer", name: "Zombie Slayer", echelon: 1, effect: "choose: grants an ability" },
  { id: "arena-fighter", name: "Arena Fighter", echelon: 2, effect: "choose: grants an ability, characteristic increase, Renown" },
  { id: "awakened", name: "Awakened", echelon: 2, effect: "choose: +language" },
  { id: "battlefield-commander", name: "Battlefield Commander", echelon: 2, effect: "choose: grants an ability, Renown" },
  { id: "blood-magic", name: "Blood Magic", echelon: 2, effect: "choose: an edge" },
  { id: "corsair", name: "Corsair", echelon: 2, effect: "choose: Renown, an edge, skill" },
  { id: "faction-officer", name: "Faction Officer", echelon: 2, effect: "an edge, faction" },
  { id: "fey-friend", name: "Fey Friend", echelon: 2, effect: "choose: an edge, skill, +language" },
  { id: "giant-slayer", name: "Giant Slayer", echelon: 2, effect: "choose: grants an ability, characteristic increase, an edge, skill" },
  { id: "godsworn", name: "Godsworn", echelon: 2, effect: "choose: grants an ability" },
  { id: "heist-hero", name: "Heist Hero", echelon: 2, effect: "choose: an edge, skill, +language" },
  { id: "knight", name: "Knight", echelon: 2, effect: "choose: grants an ability, characteristic increase, Renown" },
  { id: "master-librarian", name: "Master Librarian", echelon: 2, effect: "choose: an edge, skill, +language" },
  { id: "special-agent", name: "Special Agent", echelon: 2, effect: "choose: an edge, skill" },
  { id: "sworn-hunter", name: "Sworn Hunter", echelon: 2, effect: "choose: an edge, skill" },
  { id: "undead-slain", name: "Undead Slain", echelon: 2, effect: "cheat death" },
  { id: "unstoppable", name: "Unstoppable", echelon: 2, effect: "" },
  { id: "armed-and-dangerous", name: "Armed and Dangerous", echelon: 3, effect: "" },
  { id: "back-from-the-grave", name: "Back From the Grave", echelon: 3, effect: "cheat death" },
  { id: "demon-slayer", name: "Demon Slayer", echelon: 3, effect: "choose: +language" },
  { id: "diabolist", name: "Diabolist", echelon: 3, effect: "choose: characteristic increase, +language" },
  { id: "dragon-blooded", name: "Dragon Blooded", echelon: 3, effect: "" },
  { id: "fleet-admiral", name: "Fleet Admiral", echelon: 3, effect: "choose: Wealth" },
  { id: "maestro", name: "Maestro", echelon: 3, effect: "choose: grants an ability, skill" },
  { id: "master-crafter", name: "Master Crafter", echelon: 3, effect: "choose: an edge, skill, +language" },
  { id: "noble", name: "Noble", echelon: 3, effect: "choose: Renown, Wealth, an edge" },
  { id: "planar-voyager", name: "Planar Voyager", echelon: 3, effect: "choose: an edge, skill" },
  { id: "scarred", name: "Scarred", echelon: 3, effect: "characteristic increase" },
  { id: "siege-breaker", name: "Siege Breaker", echelon: 3, effect: "choose: an edge" },
  { id: "teacher", name: "Teacher", echelon: 3, effect: "skill" },
  { id: "champion-competitor", name: "Champion Competitor", echelon: 4, effect: "choose: characteristic increase, Renown, Wealth, skill" },
  { id: "demigod", name: "Demigod", echelon: 4, effect: "choose: characteristic increase, Renown" },
  { id: "enlightened", name: "Enlightened", echelon: 4, effect: "choose: characteristic increase, skill" },
  { id: "forsaken", name: "Forsaken", echelon: 4, effect: "choose: characteristic increase" },
  { id: "monarch", name: "Monarch", echelon: 4, effect: "choose: characteristic increase, Renown, Wealth" },
  { id: "peace-bringer", name: "Peace Bringer", echelon: 4, effect: "choose: characteristic increase, skill" },
  { id: "reborn", name: "Reborn", echelon: 4, effect: "choose: characteristic increase, skill" },
  { id: "theoretical-warrior", name: "Theoretical Warrior", echelon: 4, effect: "grants an ability, characteristic increase" },
  { id: "tireless", name: "Tireless", echelon: 4, effect: "choose: characteristic increase" },
  { id: "unchained", name: "Unchained", echelon: 4, effect: "choose: characteristic increase" },
];

// Titles available at or below a given echelon, grouped for the picker.
export function titlesUpToEchelon(echelon: number): DSTitle[] {
  return DS_TITLES.filter((t) => t.echelon <= echelon)
    .sort((a, b) => a.echelon - b.echelon || a.name.localeCompare(b.name));
}

export const titleById = (id: string): DSTitle | undefined => DS_TITLES.find((t) => t.id === id);
