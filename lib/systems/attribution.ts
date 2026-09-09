// Per-system LICENSE ATTRIBUTIONS - the single source of truth for the notices Six Axes must show for
// each supported game system whose content (mechanics) it ships. Consumed by the /licenses page (lists
// every entry) and by the in-Forge attribution line (shows the active system's entry). Plain data, no
// React, so it can be imported from a server page or a client component alike.
//
// The three third-party-license notices (Draw Steel, Daggerheart, Lancer) are VERBATIM as the licenses
// require and match the copies in the Terms of Service. The D&D SRD notice is the standard CC-BY-4.0
// attribution. Only game MECHANICS ship in Six Axes; publishers' descriptive prose does not.

export interface SystemAttribution {
  id: string;        // systemId (matches lib/systems/<id>.ts); "" for entries not tied to one forge system
  system: string;    // display name of the system
  license: string;   // short license label, for headings and the compact Forge line
  short: string;     // one-sentence notice for the compact in-Forge line
  notice: string[];  // full notice paragraphs (verbatim where the license requires)
  url?: string;      // canonical license URL, when there is one
}

export const SYSTEM_ATTRIBUTIONS: SystemAttribution[] = [
  {
    id: "dnd5e",
    system: "D&D 5e",
    license: "SRD 5.1 (CC BY 4.0)",
    short: "Includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.",
    notice: [
      "This work includes material from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.",
      "Six Axes is not affiliated with, endorsed, sponsored, or specifically approved by Wizards of the Coast LLC.",
    ],
    url: "https://creativecommons.org/licenses/by/4.0/legalcode",
  },
  {
    id: "pf2e",
    system: "Pathfinder Second Edition",
    license: "Open Game License 1.0a / ORC License",
    short: "Includes Open Game Content from Pathfinder Second Edition under the Open Game License 1.0a and the ORC License; not affiliated with, endorsed, or approved by Paizo.",
    notice: [
      "This work includes Open Game Content from Pathfinder Second Edition, published by Paizo Inc. Pre-Remaster material is used under the Open Game License version 1.0a; Remaster material (Player Core, GM Core, Monster Core, and later titles) is used under the ORC License, available at https://paizo.com/orclicense. Reproduction of Open Game Content or ORC-licensed content is permitted only in accordance with those licenses.",
      "Six Axes ships game mechanics and the rules text Paizo released as open content. Paizo trademarks and Product Identity (including the Pathfinder name and logo and Paizo’s proprietary setting material) remain the property of Paizo Inc. and are not used beyond what the open licenses permit. Six Axes is not published, endorsed, sponsored, or specifically approved by Paizo Inc. For more information about Paizo and Paizo products, visit https://paizo.com.",
    ],
    url: "https://paizo.com/orclicense",
  },
  {
    id: "daggerheart",
    system: "Daggerheart",
    license: "Darrington Press Community Gaming License",
    short: "Includes materials from the Daggerheart SRD 1.0, © Critical Role, LLC, under the Darrington Press Community Gaming License.",
    notice: [
      "This product includes materials from the Daggerheart System Reference Document 1.0, © Critical Role, LLC. Six Axes is an independent product published under the Darrington Press Community Gaming License and is not affiliated with, endorsed by, or sponsored by Darrington Press or Critical Role.",
    ],
    url: "https://www.daggerheart.com/",
  },
  {
    id: "drawsteel",
    system: "Draw Steel",
    license: "Draw Steel Creator License",
    short: "An independent product published under the DRAW STEEL Creator License, not affiliated with MCDM Productions, LLC.",
    notice: [
      "Six Axes is an independent product published under the DRAW STEEL Creator License and is not affiliated with MCDM Productions, LLC. DRAW STEEL © 2026 MCDM Productions, LLC.",
    ],
    url: "https://www.mcdmproductions.com/",
  },
  {
    id: "lancer",
    system: "Lancer",
    license: "Lancer Third Party License",
    short: "A third party work published via the Lancer Third Party License; Lancer is copyright Massif Press.",
    notice: [
      "Six Axes is not an official Lancer product; it is a third party work, and is not affiliated with Massif Press. Six Axes is published via the Lancer Third Party License. Lancer is copyright Massif Press.",
    ],
    url: "https://massifpress.com/legal",
  },
  {
    // Dark Matter reuses the open 5e engine (SRD 5.1 CC-BY). It is now a selectable compendium system
    // (its compendium reads the shared 2014 SRD index), so it carries its own id for the compact line
    // shown in the tool footer; the SRD attribution also appears on the licenses page.
    id: "darkmatter",
    system: "Dark Matter (5e engine)",
    license: "SRD 5.1 (CC BY 4.0)",
    short: "Runs on the D&D 5e SRD engine under CC BY 4.0; Mage Hand Press’s Dark Matter setting content is not shipped.",
    notice: [
      "Dark Matter campaigns run on the open Dungeons & Dragons 5e engine. This work includes material from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC, licensed under the Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode).",
      "Mage Hand Press’s Dark Matter setting content is proprietary and is not shipped by Six Axes; groups supply that content themselves. Six Axes is not affiliated with Mage Hand Press or Wizards of the Coast.",
    ],
    url: "https://creativecommons.org/licenses/by/4.0/legalcode",
  },
];

// The active-system attribution for the in-Forge line. Returns undefined for systems that ship no
// licensed content (e.g. the generic d10 pool, Call of Cthulhu dice-only), so the line simply hides.
export function attributionFor(system: string | null | undefined): SystemAttribution | undefined {
  if (!system) return undefined;
  return SYSTEM_ATTRIBUTIONS.find((a) => a.id === system);
}
