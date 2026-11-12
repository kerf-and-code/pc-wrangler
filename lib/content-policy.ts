// lib/content-policy.ts (2026-11-12, push 48: audit round 2, T4)
//
// The kill switch for book content that is not open content: the monsters, spells, items, feats,
// backgrounds, subclasses and other entries written up in Kerf and Code wording from books outside the
// System Reference Documents (marked "kc" in the data and on the cards). Terry's decision: keep that
// content, and be able to take it out quickly if a publisher asks.
//
// Set NEXT_PUBLIC_NON_SRD_CONTENT=off in the hosting environment and redeploy. The pickers and lookups
// that read lib/srd/srd.ts then offer the SRD and the open third-party bestiaries only, and the
// compendium hides "kc" cards. For the files themselves to stop being served, the compendium is rebuilt
// with NON_SRD_CONTENT=off as well; docs/non-srd-kill-switch.md has every step. Anything a GM or player
// already saved into a campaign (a character's spell, a stat block) stays theirs and is not touched.
//
// NEXT_PUBLIC_ so the browser bundle sees it; Next inlines it at build time, which is why a change
// needs a redeploy.

export function nonSrdContentOn(): boolean {
  return process.env.NEXT_PUBLIC_NON_SRD_CONTENT !== "off";
}

/** True for a record that is non-SRD book content: `source` "kc" or any source that is not an SRD
 *  ("Eberron: Forge of the Artificer"), or a monster whose `source_key` starts with "kc-". Records with
 *  no source are SRD (the SRD files leave it empty). Subclasses go by SRD_SUBCLASSES instead, because
 *  their `source` names the book even for the SRD ones. */
export function isNonSrd(r: { source?: unknown; source_key?: unknown } | null | undefined): boolean {
  if (!r) return false;
  if (typeof r.source_key === "string" && r.source_key.startsWith("kc-")) return true;
  return typeof r.source === "string" && r.source !== "" && r.source !== "srd" && !/^SRD/i.test(r.source);
}

/** The subclasses in SRD 5.1 and SRD 5.2.1, one per class (Draconic Bloodline is 2024's Draconic
 *  Sorcery). Compared lower case. */
export const SRD_SUBCLASSES = new Set([
  "path of the berserker", "college of lore", "life domain", "circle of the land", "champion",
  "way of the open hand", "warrior of the open hand", "oath of devotion", "hunter", "thief",
  "draconic bloodline", "draconic sorcery", "the fiend", "fiend patron", "school of evocation", "evoker",
]);

/** The rows with non-SRD book content removed when the switch is off; the same array otherwise. */
export function withContentPolicy<T>(rows: T[]): T[] {
  return nonSrdContentOn() ? rows : rows.filter((r) => !isNonSrd(r as { source?: unknown }));
}

/** Subclasses the same way, by name. */
export function subclassesWithContentPolicy<T extends { subclass: string }>(rows: T[]): T[] {
  return nonSrdContentOn() ? rows : rows.filter((r) => SRD_SUBCLASSES.has(r.subclass.trim().toLowerCase()));
}
