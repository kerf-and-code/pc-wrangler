// Per-system LICENSE ATTRIBUTIONS - the single source of truth for the notices Six Axes must show for
// each supported game system whose content (mechanics) it ships. Consumed by the /licenses page (lists
// every entry) and by the in-Forge attribution line (shows the active system's entry). Plain data, no
// React, so it can be imported from a server page or a client component alike.
//
// The three third-party-license notices (Draw Steel, Daggerheart, Lancer) are VERBATIM as the licenses
// require and match the copies in the Terms of Service. The D&D SRD notice is the standard CC-BY-4.0
// attribution. Only game MECHANICS ship in Six Axes; publishers' descriptive prose does not.

import { OGL_MONSTER_SOURCES, MONSTER_SOURCES } from "@/lib/monster-sources";

// The Open Game License v1.0a, sections 1 to 14, verbatim (text as published by Open5e,
// api.open5e.com/v2/licenses/ogl-10a). Section 15 is assembled below from the sources actually shipped.
const OGL_10A_TERMS: string[] = [
  "The following text is the property of Wizards of the Coast, Inc. and is Copyright 2000 Wizards of the Coast, Inc (\"Wizards\"). All Rights Reserved.",
  "1. Definitions: (a)\"Contributors\" means the copyright and/or trademark owners who have contributed Open Game Content; (b)\"Derivative Material\" means copyrighted material including derivative works and translations (including into other computer languages), potation, modification, correction, addition, extension, upgrade, improvement, compilation, abridgment or other form in which an existing work may be recast, transformed or adapted; (c) \"Distribute\" means to reproduce, license, rent, lease, sell, broadcast, publicly display, transmit or otherwise distribute; (d)\"Open Game Content\" means the game mechanic and includes the methods, procedures, processes and routines to the extent such content does not embody the Product Identity and is an enhancement over the prior art and any additional content clearly identified as Open Game Content by the Contributor, and means any work covered by this License, including translations and derivative works under copyright law, but specifically excludes Product Identity. (e) \"Product Identity\" means product and product line names, logos and identifying marks including trade dress; artifacts; creatures characters; stories, storylines, plots, thematic elements, dialogue, incidents, language, artwork, symbols, designs, depictions, likenesses, formats, poses, concepts, themes and graphic, photographic and other visual or audio representations; names and descriptions of characters, spells, enchantments, personalities, teams, personas, likenesses and special abilities; places, locations, environments, creatures, equipment, magical or supernatural abilities or effects, logos, symbols, or graphic designs; and any other trademark or registered trademark clearly identified as Product identity by the owner of the Product Identity, and which specifically excludes the Open Game Content; (f) \"Trademark\" means the logos, names, mark, sign, motto, designs that are used by a Contributor to identify itself or its products or the associated products contributed to the Open Game License by the Contributor (g) \"Use\", \"Used\" or \"Using\" means to use, Distribute, copy, edit, format, modify, translate and otherwise create Derivative Material of Open Game Content. (h) \"You\" or \"Your\" means the licensee in terms of this agreement.",
  "2. The License: This License applies to any Open Game Content that contains a notice indicating that the Open Game Content may only be Used under and in terms of this License. You must affix such a notice to any Open Game Content that you Use. No terms may be added to or subtracted from this License except as described by the License itself. No other terms or conditions may be applied to any Open Game Content distributed using this License.",
  "3. Offer and Acceptance: By Using the Open Game Content You indicate Your acceptance of the terms of this License.",
  "4. Grant and Consideration: In consideration for agreeing to use this License, the Contributors grant You a perpetual, worldwide, royalty-free, non-exclusive license with the exact terms of this License to Use, the Open Game Content.",
  "5.Representation of Authority to Contribute: If You are contributing original material as Open Game Content, You represent that Your Contributions are Your original creation and/or You have sufficient rights to grant the rights conveyed by this License.",
  "6.Notice of License Copyright: You must update the COPYRIGHT NOTICE portion of this License to include the exact text of the COPYRIGHT NOTICE of any Open Game Content You are copying, modifying or distributing, and You must add the title, the copyright date, and the copyright holder's name to the COPYRIGHT NOTICE of any original Open Game Content you Distribute.",
  "7. Use of Product Identity: You agree not to Use any Product Identity, including as an indication as to compatibility, except as expressly licensed in another, independent Agreement with the owner of each element of that Product Identity. You agree not to indicate compatibility or co-adaptability with any Trademark or Registered Trademark in conjunction with a work containing Open Game Content except as expressly licensed in another, independent Agreement with the owner of such Trademark or Registered Trademark. The use of any Product Identity in Open Game Content does not constitute a challenge to the ownership of that Product Identity. The owner of any Product Identity used in Open Game Content shall retain all rights, title and interest in and to that Product Identity.",
  "8. Identification: If you distribute Open Game Content You must clearly indicate which portions of the work that you are distributing are Open Game Content.",
  "9. Updating the License: Wizards or its designated Agents may publish updated versions of this License. You may use any authorized version of this License to copy, modify and distribute any Open Game Content originally distributed under any version of this License.",
  "10. Copy of this License: You MUST include a copy of this License with every copy of the Open Game Content You Distribute.",
  "11. Use of Contributor Credits: You may not market or advertise the Open Game Content using the name of any Contributor unless You have written permission from the Contributor to do so.",
  "12. Inability to Comply: If it is impossible for You to comply with any of the terms of this License with respect to some or all of the Open Game Content due to statute, judicial order, or governmental regulation then You may not Use any Open Game Material so affected.",
  "13. Termination: This License will terminate automatically if You fail to comply with all terms herein and fail to cure such breach within 30 days of becoming aware of the breach. All sublicenses shall survive the termination of this License.",
  "14. Reformation: If any provision of this License is held to be unenforceable, such provision shall be reformed only to the extent necessary to make it enforceable."
];

// OGL Section 15: the license itself, the SRD lines every 5e OGL product carries, then each
// third-party bestiary whose monsters ship in lib/srd/monsters-2014.json (copyright lines verbatim
// from Open5e, see lib/monster-sources.ts).
const OGL_SECTION_15: string[] = [
  "15. COPYRIGHT NOTICE",
  "Open Game License v 1.0a Copyright 2000, Wizards of the Coast, Inc.",
  "System Reference Document Copyright 2000-2003, Wizards of the Coast, Inc.; Authors Jonathan Tweet, Monte Cook, Skip Williams, Rich Baker, Andy Collins, David Noonan, Rich Redman, Bruce R. Cordell, John D. Rateliff, Thomas Reid, James Wyatt, based on original material by E. Gary Gygax and Dave Arneson.",
  "System Reference Document 5.1 Copyright 2016, Wizards of the Coast, Inc.; Authors Mike Mearls, Jeremy Crawford, Chris Perkins, Rodney Thompson, Peter Lee, James Wyatt, Robert J. Schwalb, Bruce R. Cordell, Chris Sims, and Steve Townshend, based on original material by E. Gary Gygax and Dave Arneson.",
  ...OGL_MONSTER_SOURCES.map((s) => s.notice ?? s.title),
  "END OF LICENSE",
];

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
  {
    // Third-party 5e bestiaries shipped as Open Game Content (Kobold Press, EN Publishing, Green Ronin),
    // via Open5e. Not a selectable system, so id "" keeps it off the in-Forge line; it lists on /licenses.
    // OGL Section 8 is met by the per-monster source label; Sections 10 and 15 by the text below.
    id: "",
    system: "D&D 5e third-party monsters",
    license: "Open Game License 1.0a",
    short: "Includes Open Game Content from third-party 5e bestiaries under the Open Game License 1.0a.",
    notice: [
      "The monster stat blocks labeled with a third-party source (" + OGL_MONSTER_SOURCES.map((s) => s.title).join(", ") + ") are Open Game Content, used under the Open Game License version 1.0a, and are reproduced as their publishers released them through Open5e. Each such monster is labeled with its source wherever it appears in Six Axes. Product Identity, including those publishers' names, settings and trademarks, is not used beyond identifying the source, and Six Axes is not affiliated with, endorsed or sponsored by any of them.",
      "OPEN GAME LICENSE Version 1.0a",
      ...OGL_10A_TERMS,
      ...OGL_SECTION_15,
    ],
    url: "https://open5e.com/legal",
  },
  {
    // Black Flag Roleplaying Reference Document monsters, the one ORC-licensed bestiary in the data.
    id: "",
    system: "Black Flag Roleplaying monsters",
    license: "ORC License",
    short: "Includes material from the Black Flag Roleplaying Reference Document by Kobold Press, under the ORC License.",
    notice: [
      "The monster stat blocks labeled Black Flag come from the Black Flag Roleplaying Reference Document by Kobold Press, reproduced as released through Open5e. Kobold Press trademarks and Reserved Material are not used beyond identifying the source, and Six Axes is not affiliated with or endorsed by Kobold Press.",
      MONSTER_SOURCES.bfrd.notice ?? "",
    ],
    url: "https://koboldpress.com/orclicense",
  },
];

// The active-system attribution for the in-Forge line. Returns undefined for systems that ship no
// licensed content (e.g. the generic d10 pool, Call of Cthulhu dice-only), so the line simply hides.
export function attributionFor(system: string | null | undefined): SystemAttribution | undefined {
  if (!system) return undefined;
  return SYSTEM_ATTRIBUTIONS.find((a) => a.id === system);
}
