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
      "Encounter math is different in every system, and the published guidelines rarely match what actually happens at the table. This tool does the real per-system arithmetic: enter your party and the monsters, and it tells you where the fight lands (trivial, easy, hard, or deadly) before anyone rolls initiative.",
      "It runs the same calculations Six Axes uses in-app, so the numbers are the ones the system's own design points to, not a rough rule of thumb.",
    ],
    steps: [
      "Pick your system: D&D 5e (2014 or 2024), Pathfinder 2e, Draw Steel, or Daggerheart.",
      "Add your party: how many characters, and their levels.",
      "Add the monsters or threats in the encounter.",
      "Read the difficulty band, and adjust the fight until it lands where you want it.",
    ],
    systemsHeading: "Why per-system math matters",
    systems: [
      "5e 2014 and 2024 use different XP budgets and multipliers; Pathfinder 2e uses a level-based threat budget; Draw Steel and Daggerheart don't use XP at all. A generic 'CR calculator' quietly assumes 5e and gets the others wrong. This applies each system's own model, so a Moderate fight reads as Moderate in the system you're actually running.",
    ],
    faq: [
      { q: "Is the encounter balancer free?", a: "Yes. It is free, needs no login, and saves nothing. Use it as much as you like." },
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
      "It is provably fair: the randomness is transparent, and nothing is stored.",
    ],
    steps: [
      "Choose your system or roll mode.",
      "Set the dice and any modifiers (advantage, a target number, a pool size).",
      "Roll, and read the result already interpreted for your system.",
    ],
    faq: [
      { q: "Is it actually fair?", a: "Yes. It is a provably fair roller, and you can roll as much as you like. Nothing is saved." },
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
      "The estimates follow the 2024 rarity pricing, not the older 2014 tables, so they line up with the current books. Treat a number as a defensible starting point, not a fixed price: your world's economy is yours to set.",
    ],
    faq: [
      { q: "Is this for 5e 2014 or 2024?", a: "The 2024 rules. The rarity bands changed between editions; this uses the current ones." },
      { q: "How many items can I search?", a: "Over 400 named 2024 items, each with an estimate and the reasoning behind it." },
      { q: "Is it free?", a: "Yes. It is free, needs no login, and saves nothing." },
    ],
    related: [
      { href: "/tools/encounter-balancer", label: "Encounter balancer" },
      { href: "/tools/dice-roller", label: "Dice roller" },
    ],
  },

  "map-generator": {
    heading: "Generate a fantasy world map from a seed",
    intro: [
      "A whole world in your browser: continents and coastlines, climate and rivers, biomes, settlements, and the roads between them, all generated from a seed, so the same seed always makes the same map. When you like one, download the PNG.",
      "It's the same generator that draws worlds inside Six Axes, so what you make here is real cartography, not placeholder noise.",
    ],
    steps: [
      "Enter a seed, or start from a random one.",
      "Generate, and regenerate until the coastline and continents feel right.",
      "Download the PNG to drop into your notes, VTT, or session prep.",
    ],
    faq: [
      { q: "Is the map generator free?", a: "Yes. It is free, needs no login, and you can download the result." },
      { q: "Can I get the same map again?", a: "Yes. The same seed always produces the same world, so note the seed if you want to return to it." },
      { q: "What's on the map?", a: "Continents, climate, rivers, biomes, settlements, and roads: a full hex world, not just terrain." },
    ],
    related: [
      { href: "/tools/session-zero", label: "Session zero checklist" },
      { href: "/tools/encounter-balancer", label: "Encounter balancer" },
    ],
  },

  "pacing": {
    heading: "Will tonight's session fit the clock?",
    intro: [
      "Two questions every GM guesses at: does tonight's plan fit the hours you actually have, and how many sessions will this arc really take? This answers both. Add your encounters and scenes and it estimates the runtime with system-aware combat timing; sketch your arc and it estimates the session count.",
      "It's the difference between planning three hours of content for a three-hour session and finding out at hour four.",
    ],
    steps: [
      "For tonight: add the scenes and fights you've planned, and read the estimated runtime.",
      "For the arc: enter the beats or milestones, and read how many sessions they'll take.",
      "Adjust the plan until it fits the time you actually have.",
    ],
    faq: [
      { q: "How does it estimate combat length?", a: "With system-aware timing. A 5e fight and a Pathfinder 2e fight of the same size don't take the same real time, and the estimate reflects that." },
      { q: "Is it free?", a: "Yes. It is free, needs no login, and saves nothing." },
    ],
    related: [
      { href: "/tools/encounter-balancer", label: "Encounter balancer" },
      { href: "/tools/session-zero", label: "Session zero checklist" },
    ],
  },

  "party-coverage": {
    heading: "Find the gaps in your party",
    intro: [
      "Every party has holes, and you usually find them mid-fight: no one can heal, nobody holds the front line, no one can talk past a guard. Enter your party's classes and this shows the gaps before session one: healing, defense, damage, control, and the face role.",
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
      { q: "What counts as a gap?", a: "No healer, no front-line defender, no controller, no face: the roles whose absence changes how you have to run the game." },
      { q: "Is it free?", a: "Yes. It is free, needs no login, and saves nothing." },
    ],
    related: [
      { href: "/tools/player-quiz", label: "Player-type quiz" },
      { href: "/tools/encounter-balancer", label: "Encounter balancer" },
    ],
  },

  "player-quiz": {
    heading: "What kind of tabletop player are you?",
    intro: [
      "Twenty-four quick questions read how you play across six axes (Voice, Tactics, Arcana, Rapport, Exploration, and Nerve) and hand you a disposition chart at the end. It's the same six-axis model Six Axes uses to read a whole table; here it's pointed at just you.",
      "Good for a new group getting to know each other, or for a player curious what actually pulls them to the table.",
    ],
    steps: [
      "Answer twenty-four short questions. There are no right answers, just honest ones.",
      "Get your read across the six axes.",
      "See your tavern disposition chart, and compare it with the rest of your table.",
    ],
    faq: [
      { q: "How long does it take?", a: "A few minutes: twenty-four questions, and nothing is saved." },
      { q: "What are the six axes?", a: "Voice, Tactics, Arcana, Rapport, Exploration, and Nerve: six ways of engaging with a game, measured together rather than sorting you into one 'type'." },
      { q: "Do I need an account?", a: "No login, and nothing is stored." },
    ],
    related: [
      { href: "/tools/dnd-class-quiz", label: "What D&D class should I be?" },
      { href: "/tools/party-coverage", label: "Party coverage check" },
      { href: "/tools/session-zero", label: "Session zero checklist" },
    ],
  },

  "dnd-class-quiz": {
    heading: "What D&D class should you play?",
    intro: [
      "Picking a class is the first real decision in D&D, and the list keeps growing: the 2024 Player's Handbook, the newer setting books, the 2014 classics, and a long shelf of partnered books on D&D Beyond. This quiz asks a few questions about the hero you picture, then narrows over 450 subclasses down to one, with the close runners-up beside it.",
      "It starts with where your story lives and where your power comes from, then asks about how you fight, what your magic feels like, and the kind of story you want. A gauge shows how many heroes are still possible after each answer, and at the end you can open the whole flowchart to see every path you did not take.",
    ],
    steps: [
      "Choose which books to include: 2024 rules only or 2014 too, official books only or partnered ones too.",
      "Answer each question with the option that feels most like the character you want to play. Keys 1 to 9 work.",
      "Read your result: the subclass, its class, how it plays, its key abilities, and which book it is in.",
      "Check the runners-up, or open the flowchart and follow a different branch.",
    ],
    systemsHeading: "Which books it covers",
    systems: [
      "Official books from the 2024 Player's Handbook through the newest setting books, the 2014 legacy subclasses, and the crossover books for Azeroth, Middle-earth and the World of Darkness, plus partnered publishers such as Ghostfire Gaming, Kobold Press, Mage Hand Press, Hit Point Press, MCDM and Critical Role. Every description is written for this quiz, so read the source book for the actual rules before you build.",
    ],
    faq: [
      { q: "Is the class quiz free?", a: "Yes. It is free, needs no login, and saves nothing." },
      { q: "Does it use the 2024 rules?", a: "Both editions. Choose \"2024 rules only\" to leave out the 2014 subclasses, or keep them in." },
      { q: "Can I leave out third-party books?", a: "Yes. Choose \"Official only\" and the quiz only offers subclasses from Wizards of the Coast books." },
      { q: "What if I do not like my result?", a: "Look at the runners-up, step back a question, or open the flowchart to see where every other answer leads." },
    ],
    related: [
      { href: "/tools/player-quiz", label: "Player-type quiz" },
      { href: "/tools/party-coverage", label: "Party coverage check" },
      { href: "/tools/session-zero", label: "Session zero checklist" },
    ],
  },

  "token-maker": {
    heading: "Make a token that looks like your character",
    intro: [
      "Take any picture, lift it off its background, cut it to a circle, hexagon, shield or other shape, and put a frame around it. Frames come plain, or themed on a class or subclass: thornvine for a druid, gilded filigree for a paladin, crossed blades for a fighter, moon phases for a Circle of the Moon druid, a lamp and wisps for a genie-sworn paladin.",
      "Then make it move. Animated effects follow the damage types, so a fire sorcerer's token licks with flame, a tempest cleric's crackles with lightning, a necromancer's trails dark smoke, and a psion's ripples. Add a glow, a pulse, a rainbow, or sparkles on top, and pick your own colours for all of it.",
      "Everything happens in your browser. Nothing is uploaded, and there is no account.",
    ],
    steps: [
      "Choose, drop or paste a picture.",
      "Press Remove background, and tidy any edges with the erase and restore brushes.",
      "Pick a shape, then drag and zoom the picture to frame the face.",
      "Choose a border design and its colours, an animated effect, and a motion style, or import a border of your own.",
      "Download the token as a PNG, the picture alone, an animated GIF, or a short video.",
    ],
    systemsHeading: "Using it on your table",
    systems: [
      "The PNG has a transparent background, so it drops onto any virtual tabletop or into any character sheet that takes an image. The animated version downloads as a looping GIF, which most virtual tabletops accept, or as a WebM video. In Six Axes the same token maker sits in the tabletop for the GM and for each player, and the frame is drawn live, so the animation plays at the table.",
    ],
    faq: [
      { q: "Is the token maker free?", a: "Yes. It is free, needs no login, and nothing you make is uploaded or stored." },
      { q: "How does the background removal work?", a: "It reads the colours around the edge of your picture and removes everything connected to them, then softens the cut. It works best on a plain or simple background; the erase and restore brushes handle the rest." },
      { q: "Can I use my own border?", a: "Yes. Import a square PNG with a transparent middle and it is drawn around your picture, alone or over one of the designs." },
      { q: "Are the class borders official art?", a: "No. Every design is original Six Axes artwork. The class and subclass names only say what inspired each one." },
    ],
    related: [
      { href: "/tools/background-remover", label: "Background remover" },
      { href: "/tools/dnd-class-quiz", label: "What D&D class should I be?" },
      { href: "/tools/party-coverage", label: "Party coverage check" },
    ],
  },

  "background-remover": {
    heading: "Remove a background without uploading anything",
    intro: [
      "Character art, monster pictures and props almost always come on a background you do not want on a map or a sheet. This removes it in your browser: the picture never leaves your device, there is no account, and the download is full size.",
      "It reads the colours around the edge of the picture and clears everything connected to them, then gives you the tools to finish the job: click any patch of background that is left (the gap between an arm and a body), paint with an erase or restore brush, keep only the largest piece to clear stray specks, and tighten the edge to trim a halo.",
    ],
    steps: [
      "Choose, drop or paste a picture.",
      "Press Remove background automatically, and raise or lower the tolerance until the edge looks right.",
      "Click any background that is left, and touch up with the brushes. Zoom in for fine edges.",
      "Check it against white, black or a colour, then download a transparent PNG, or one with a new background.",
      "Or send it straight to the token maker to frame it as a token.",
    ],
    faq: [
      { q: "Is my picture uploaded?", a: "No. Everything runs in your browser, so the picture stays on your device." },
      { q: "What pictures work best?", a: "Pictures on a plain or simple background remove in one click. Busy photographs take more brushwork, since the remover works from colour rather than recognising what is in the picture." },
      { q: "What size is the download?", a: "The same size as your picture. You edit a preview copy, and the result is applied to the original at full resolution." },
      { q: "Is it free?", a: "Yes. It is free, needs no login, and nothing is stored." },
    ],
    related: [
      { href: "/tools/token-maker", label: "Token maker" },
      { href: "/tools/map-generator", label: "Hex map generator" },
    ],
  },

  "session-zero": {
    heading: "Run a session zero worth having",
    intro: [
      "A good session zero prevents most of the problems a campaign hits in month three: mismatched tone, unspoken lines and veils, safety tools nobody agreed on, expectations no one said out loud. This guided checklist walks your table through every topic and builds a downloadable charter everyone can hold each other to.",
      "It works for any system, because session zero is about the table, not the rules.",
    ],
    steps: [
      "Walk the checklist: tone, content lines and veils, safety tools, characters, scheduling, and table expectations.",
      "Capture the table's answers as you go.",
      "Download the charter, a shared agreement you can point back at when something drifts.",
    ],
    faq: [
      { q: "What does a session zero cover?", a: "Tone and genre, content boundaries (lines and veils), safety tools, character hooks, scheduling, and how the table wants to handle conflict and spotlight." },
      { q: "What is the charter?", a: "A downloadable summary of what your table agreed to: the thing you point back at when expectations slip." },
      { q: "Is it free?", a: "Yes. It is free, needs no login, and saves nothing." },
    ],
    related: [
      { href: "/tools/player-quiz", label: "Player-type quiz" },
      { href: "/tools/party-coverage", label: "Party coverage check" },
    ],
  },
};
