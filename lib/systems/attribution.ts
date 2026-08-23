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
    license: "Paizo Community Use Policy",
    short: "Uses trademarks and copyrights owned by Paizo Inc., used under Paizo’s Community Use Policy.",
    notice: [
      "Six Axes uses trademarks and/or copyrights owned by Paizo Inc., used under Paizo’s Community Use Policy (https://paizo.com/community/communityuse). Six Axes is not published, endorsed, or specifically approved by Paizo. For more information about Paizo Inc. and Paizo products, visit https://paizo.com.",
      "Pathfinder Second Edition rules mechanics are made available by Paizo under the ORC License; Six Axes ships those mechanics only, not Paizo’s descriptive text.",
    ],
    url: "https://paizo.com/community/communityuse",
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
    // Dark Matter reuses the open 5e engine (SRD 5.1 CC-BY); it is not offered as its own Forge system,
    // so it has no compact Forge line, but its SRD attribution belongs on the licenses page.
    id: "",
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
