import type { ToolCopyProps } from "@/components/tools/tool-copy";

// lib/tools/tool-copy-content.ts
//
// The crawlable landing-page copy for each free tool, keyed by slug. Kept separate from the page files
// so the pages stay thin and the copy lives in one place. Written to match the site's voice: concrete,
// second-person, specific about systems, no marketing filler. Rendered by <ToolCopy> below each widget.

export const TOOL_COPY: Record<string, ToolCopyProps> = {
  "encounter-balancer": {
    heading: "How the encounter balancer works",
    intro: [
      "Encounter math is different in every system, and the published guidelines rarely match what actually happens at the table. This tool does the real per-system arithmetic: enter your party and the monsters, and it tells you where the fight lands — trivial, easy, hard, or deadly — before anyone rolls initiative.",
      "It runs the same calculations Six Axes uses in-app, so the numbers are the ones the system's own design points to, not a rough rule of thumb.",
    ],
    steps: [
      "Pick your system — D&D 5e (2014 or 2024), Pathfinder 2e, Draw Steel, or Daggerheart.",
      "Add your party: how many characters, and their levels.",
      "Add the monsters or threats in the encounter.",
      "Read the difficulty band, and adjust the fight until it lands where you want it.",
    ],
    systemsHeading: "Why per-system math matters",
    systems: [
      "5e 2014 and 2024 use different XP budgets and multipliers; Pathfinder 2e uses a level-based threat budget; Draw Steel and Daggerheart don't use XP at all. A generic 'CR calculator' quietly assumes 5e and gets the others wrong. This applies each system's own model, so a Moderate fight reads as Moderate in the system you're actually running.",
    ],
    faq: [
      { q: "Is the encounter balancer free?", a: "Yes — free, no login, and nothing is saved. Use it as much as you like." },
      { q: "Which systems does it support?", a: "D&D 5e (2014 and 2024), Pathfinder 2e, Draw Steel, and Daggerheart, each with its own difficulty math." },
      { q: "Does it account for party size and level?", a: "Yes. Both change the thresholds, which is exactly where the published quick-rules tend to mislead you." },
    ],
    related: [
      { href: "/tools/party-coverage", label: "Party coverage check" },
      { href: "/tools/pacing", label: "Session pacing" },
      { href: "/tools/dice-roller", label: "Dice roller" },
    ],
  },

  "dice-roller": {
    heading: "A dice roller that speaks every system",
    intro: [
      "Most online dice rollers just give you a number. This one knows the rules: advantage and disadvantage in 5e, degrees of success in Pathfinder 2e and Call of Cthulhu, power-roll tiers in Draw Steel, Hope and Fear in Daggerheart, and d10 dice pools. Pick the mode and it reads the roll the way your system does.",
      "It's provably fair — the randomness is transparent — and nothing is stored.",
    ],
    steps: [
      "Choose your system or roll mode.",
      "Set the dice and any modifiers — advantage, a target number, pool size.",
      "Roll, and read the result already interpreted for your system.",
    ],
    faq: [
      { q: "Is it actually fair?", a: "Yes — it's a provably-fair roller, and you can roll as much as you like. Nothing is saved." },
      { q: "Which systems does it handle?", a: "D&D 5e, Pathfinder 2e, Call of Cthulhu, Draw Steel, Daggerheart, and generic d10 pools, each with its own success rules." },
      { q: "Do I need an account?", a: "No. No login, nothing stored." },
    ],
    related: [
      { href: "/tools/encounter-balancer", label: "Encounter balancer" },
      { href: "/tools/magic-item-price", label: "Magic item prices" },
    ],
  },

  "magic-item-price": {
    heading: "What a magic item is worth in D&D 5e (2024)",
    intro: [
      "The 2024 Dungeon Master's Guide gives price bands by rarity, but leaves the judgment call to you. This does both halves: price any item by rarity and whether it's permanent or consumable, or search 400+ named 2024 items and see each one's estimate with the reasoning shown.",
      "Use it to set a fair shop price, build a treasure hoard, or sanity-check what a player wants to sell.",
    ],
    steps: [
      "Price by rarity: choose the rarity and permanent-vs-consumable to get the band.",
      "Or use the finder: type an item name and see its estimated value.",
      "Read the reasoning, then adjust for your world's economy.",
    ],
    systemsHeading: "Based on the 2024 DMG bands",
    systems: [
      "The estimates follow the 2024 rarity pricing, not the older 2014 tables, so they line up with the current books. Treat a number as a defensible starting point, not a fixed price — your world's economy is yours to set.",
    ],
    faq: [
      { q: "Is this for 5e 2014 or 2024?", a: "The 2024 rules. The rarity bands changed between editions; this uses the current ones." },
      { q: "How many items can I search?", a: "Over 400 named 2024 items, each with an estimate and the reasoning behind it." },
      { q: "Is it free?", a: "Yes — free, no login, nothing saved." },
    ],
    related: [
      { href: "/tools/encounter-balancer", label: "Encounter balancer" },
      { href: "/tools/dice-roller", label: "Dice roller" },
    ],
  },

  "map-generator": {
    heading: "Generate a fantasy world map from a seed",
    intro: [
      "A whole world in your browser: continents and coastlines, climate and rivers, biomes, settlements, and the roads between them — generated from a seed, so the same seed always makes the same map. When you like one, download the PNG.",
      "It's the same generator that draws worlds inside Six Axes, so what you make here is real cartography, not placeholder noise.",
    ],
    steps: [
      "Enter a seed, or start from a random one.",
      "Generate, and regenerate until the coastline and continents feel right.",
      "Download the PNG to drop into your notes, VTT, or session prep.",
    ],
    faq: [
      { q: "Is the map generator free?", a: "Yes — free, no login, and you can download the result." },
      { q: "Can I get the same map again?", a: "Yes. The same seed always produces the same world, so note the seed if you want to return to it." },
      { q: "What's on the map?", a: "Continents, climate, rivers, biomes, settlements, and roads — a full hex world, not just terrain." },
    ],
    related: [
      { href: "/tools/session-zero", label: "Session zero checklist" },
      { href: "/tools/encounter-balancer", label: "Encounter balancer" },
    ],
  },

  "pacing": {
    heading: "Will tonight's session fit the clock?",
    intro: [
      "Two questions every GM guesses at: does tonight's plan fit the hours you actually have, and how many sessions will this arc really take? This answers both — add your encounters and scenes and it estimates the runtime with system-aware combat timing; sketch your arc and it estimates the session count.",
      "It's the difference between planning three hours of content for a three-hour session and finding out at hour four.",
    ],
    steps: [
      "For tonight: add the scenes and fights you've planned, and read the estimated runtime.",
      "For the arc: enter the beats or milestones, and read how many sessions they'll take.",
      "Adjust the plan until it fits the time you actually have.",
    ],
    faq: [
      { q: "How does it estimate combat length?", a: "With system-aware timing — a 5e fight and a Pathfinder 2e fight of the same size don't take the same real time, and the estimate reflects that." },
      { q: "Is it free?", a: "Yes — free, no login, nothing saved." },
    ],
    related: [
      { href: "/tools/encounter-balancer", label: "Encounter balancer" },
      { href: "/tools/session-zero", label: "Session zero checklist" },
    ],
  },

  "party-coverage": {
    heading: "Find the gaps in your party",
    intro: [
      "Every party has holes, and you usually find them mid-fight: no one can heal, nobody holds the front line, no one can talk past a guard. Enter your party's classes and this shows the gaps before session one — healing, defense, damage, control, and the face role.",
      "Useful for players building a balanced group, and for GMs deciding how hard to lean on a missing role.",
    ],
    steps: [
      "Pick your system.",
      "Add each character's class, and their role where it matters.",
      "Read the coverage: what's solid, and where the holes are.",
    ],
    systemsHeading: "Across five systems",
    systems: [
      "Works for D&D 5e, Pathfinder 2e, Draw Steel, Daggerheart, and Call of Cthulhu. Each has its own idea of what a 'role' is, so the check maps classes to roles per system rather than assuming a 5e-shaped party.",
    ],
    faq: [
      { q: "What counts as a gap?", a: "No healer, no front-line defender, no controller, no face — the roles whose absence changes how you have to run the game." },
      { q: "Is it free?", a: "Yes — free, no login, nothing saved." },
    ],
    related: [
      { href: "/tools/player-quiz", label: "Player-type quiz" },
      { href: "/tools/encounter-balancer", label: "Encounter balancer" },
    ],
  },

  "player-quiz": {
    heading: "What kind of tabletop player are you?",
    intro: [
      "Twenty-four quick questions read how you play across six axes — Voice, Tactics, Arcana, Rapport, Exploration, and Nerve — and hand you a disposition chart at the end. It's the same six-axis model Six Axes uses to read a whole table; here it's pointed at just you.",
      "Good for a new group getting to know each other, or for a player curious what actually pulls them to the table.",
    ],
    steps: [
      "Answer twenty-four short questions — no right answers, just honest ones.",
      "Get your read across the six axes.",
      "See your tavern disposition chart, and compare it with the rest of your table.",
    ],
    faq: [
      { q: "How long does it take?", a: "A few minutes — twenty-four questions, and nothing is saved." },
      { q: "What are the six axes?", a: "Voice, Tactics, Arcana, Rapport, Exploration, and Nerve — six ways of engaging with a game, measured together rather than sorting you into one 'type'." },
      { q: "Do I need an account?", a: "No login, and nothing is stored." },
    ],
    related: [
      { href: "/tools/party-coverage", label: "Party coverage check" },
      { href: "/tools/session-zero", label: "Session zero checklist" },
    ],
  },

  "session-zero": {
    heading: "Run a session zero worth having",
    intro: [
      "A good session zero prevents most of the problems a campaign hits in month three: mismatched tone, unspoken lines and veils, safety tools nobody agreed on, expectations no one said out loud. This guided checklist walks your table through every topic and builds a downloadable charter everyone can hold each other to.",
      "It works for any system — session zero is about the table, not the rules.",
    ],
    steps: [
      "Walk the checklist: tone, content lines and veils, safety tools, characters, scheduling, and table expectations.",
      "Capture the table's answers as you go.",
      "Download the charter — a shared agreement you can point back at when something drifts.",
    ],
    faq: [
      { q: "What does a session zero cover?", a: "Tone and genre, content boundaries (lines and veils), safety tools, character hooks, scheduling, and how the table wants to handle conflict and spotlight." },
      { q: "What is the charter?", a: "A downloadable summary of what your table agreed to — the thing you point back at when expectations slip." },
      { q: "Is it free?", a: "Yes — free, no login, nothing saved." },
    ],
    related: [
      { href: "/tools/player-quiz", label: "Player-type quiz" },
      { href: "/tools/party-coverage", label: "Party coverage check" },
    ],
  },
};
