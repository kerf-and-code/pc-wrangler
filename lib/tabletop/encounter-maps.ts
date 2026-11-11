// lib/tabletop/encounter-maps.ts (2026-11-11, push 31, tabletop item V4: one encounter, several maps)
//
// An encounter can span several tabletop scenes (p155): encounters.maps lists them in order, each foe
// may name the scene it starts on, and when the fight runs each monster carries that scene as sceneId
// so its token goes onto its own map. The fight stays one combats row, so the turn order is shared and
// the tabletop shows the GM which map each combatant is on. Pure helpers, tested in
// tests/encounter-maps.test.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_MAPS = 12;

/** A stored map list: scene ids, in order, without repeats, at most 12. Anything else is dropped. */
export function normalizeMaps(raw: unknown): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    if (typeof v === "string" && UUID.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= MAX_MAPS) break;
  }
  return out;
}

/** The scene a foe starts on: its own when that is one of the encounter's maps, otherwise the first
 *  map; null when the encounter has no maps (the fight goes on the table's active scene). */
export function foeScene(scene: string | null | undefined, maps: string[]): string | null {
  if (!maps.length) return null;
  return scene && maps.includes(scene) ? scene : maps[0];
}

/** Groups what goes on the table by the scene it goes to: a combatant's own scene when the campaign
 *  still has it, otherwise the active scene. Returns the groups in the order they were first met. */
export function groupByScene<T extends { sceneId?: string | null }>(list: T[], activeScene: string, known: string[]): { sceneId: string; items: T[] }[] {
  const groups: { sceneId: string; items: T[] }[] = [];
  for (const c of list) {
    const id = c.sceneId && known.includes(c.sceneId) ? c.sceneId : activeScene;
    let g = groups.find((x) => x.sceneId === id);
    if (!g) { g = { sceneId: id, items: [] }; groups.push(g); }
    g.items.push(c);
  }
  return groups;
}

/** Where a fight entry is: its token's scene, or for a player character without a linked token, the
 *  scene of a token of that character (the one on the scene being viewed when there is one). */
export function sceneOfEntry(
  e: { kind: string; tokenId?: string | null; characterId?: string | null },
  tokenScenes: Record<string, string>,
  pcScenes: Record<string, string[]>,
  viewing: string | null,
): string | null {
  if (e.tokenId && tokenScenes[e.tokenId]) return tokenScenes[e.tokenId];
  if (e.kind === "pc" && e.characterId) {
    const list = pcScenes[e.characterId] ?? [];
    if (viewing && list.includes(viewing)) return viewing;
    return list[0] ?? null;
  }
  return null;
}
