// lib/tabletop/floors.ts (2026-11-09)
//
// Phase 6c (p132): floors. The scenes made from one battle map's levels are the floors of one place,
// and a token changes floor at the same spot. A player's token may only do so standing on a way between
// floors (stairs, a ladder, a trapdoor, a pit) unless the GM lets players change floors anywhere. The
// server decides (tabletop_on_connector, tabletop_token_floor); this mirrors its test so the table can
// say beforehand whether the button will work.

export type Floor = { level: number; name: string; current: boolean; sceneId?: string; active?: boolean };
export const CONNECTOR_KINDS = new Set(["stairs", "ladder", "trapdoor", "pit"]);
type El = { k: string; x: number; y: number; s?: number };

/** Whether a token centred at (x, y) stands on a way between floors. Pieces sit by their top-left corner, s squares across. */
export function onConnector(elements: El[], x: number, y: number): boolean {
  return elements.some((e) => {
    if (!CONNECTOR_KINDS.has(e.k) || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return false;
    const s = typeof e.s === "number" && Number.isFinite(e.s) ? Math.max(e.s, 0.5) : 1;
    return x >= e.x - 0.25 && x <= e.x + s + 0.25 && y >= e.y - 0.25 && y <= e.y + s + 0.25;
  });
}

/** What the server says, in the table's words. */
export function floorError(message: string): string {
  if (/stand on stairs/.test(message)) return "Stand on stairs, a ladder, a trapdoor or a pit to change floor.";
  if (/not on the table yet/.test(message)) return "That floor is not on the table yet. The GM adds it with the floor buttons.";
  if (/solid rock/.test(message)) return "That spot is solid rock on the other floor. Move a little first.";
  if (/not yours/.test(message)) return "That token is not yours.";
  if (/not on your floor/.test(message)) return "That token is on another floor.";
  if (/tabletop_token_floor|tabletop_floors/.test(message)) return "Floors are not set up yet (the p132 migration).";
  return message;
}
