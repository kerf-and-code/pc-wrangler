// tests/campaign-duplicate.test.ts (push 24, audit F16)
import { describe, expect, it } from "vitest";
import { COPY_SPECS, copyRow, remapDeep, type CopySpec } from "../lib/campaign/duplicate";

const OLD = "11111111-1111-1111-1111-111111111111";
const NEW = "99999999-9999-9999-9999-999999999999";
const E1 = "aaaaaaaa-0000-0000-0000-000000000001";
const E1N = "aaaaaaaa-0000-0000-0000-0000000000ff";
const PC = "cccccccc-0000-0000-0000-000000000001";
const ids = new Map([[OLD, NEW], [E1, E1N]]);
const spec = (t: string) => COPY_SPECS.find((s) => s.table === t) as CopySpec;

describe("remapDeep", () => {
  it("points copied ids at their copies, deep inside JSON, and moves file paths to the new folder", () => {
    const v = { a: E1, list: [{ ref: E1 }, "keep"], url: `https://x/storage/v1/object/public/campaign-maps/${OLD}/map.png`, n: 3 };
    expect(remapDeep(v, ids, OLD, NEW)).toEqual({ a: E1N, list: [{ ref: E1N }, "keep"], url: `https://x/storage/v1/object/public/campaign-maps/${NEW}/map.png`, n: 3 });
  });
  it("leaves ids that are not copied alone", () => {
    expect(remapDeep(PC, ids, OLD, NEW)).toBe(PC);
  });
});

describe("copyRow", () => {
  it("drops a link to a player's character and keeps a link between copied entries", () => {
    const s = spec("entity_links");
    expect(copyRow({ id: "x", campaign_id: OLD, source_id: E1, target_id: PC }, s, ids, OLD, NEW, "me")).toBeNull();
    expect(copyRow({ id: E1, campaign_id: OLD, source_id: E1, target_id: E1 }, s, ids, OLD, NEW, "me"))
      .toMatchObject({ id: E1N, campaign_id: NEW, source_id: E1N, target_id: E1N });
  });
  it("clears a marker's player character but keeps the marker", () => {
    const r = copyRow({ id: E1, world_map_id: OLD, character_id: PC, entry_id: E1 }, spec("map_pois"), ids, OLD, NEW, "me")!;
    expect(r.character_id).toBeNull();
    expect(r.entry_id).toBe(E1N);
  });
  it("hands rows to the person duplicating and strips players from NPCs", () => {
    const r = copyRow({ id: E1, campaign_id: OLD, kind: "npc", profile_id: PC, invite_code: "abc", discord_user_id: "123", is_public: true }, spec("characters"), ids, OLD, NEW, "me")!;
    expect(r).toMatchObject({ profile_id: null, discord_user_id: null, is_public: false });
    expect("invite_code" in r).toBe(false);
    expect(spec("characters").keep!({ kind: "pc" })).toBe(false);
    expect(copyRow({ id: E1, campaign_id: OLD, gm_id: PC }, spec("stat_blocks"), ids, OLD, NEW, "me")!.gm_id).toBe("me");
  });
  it("puts every card back in the draw pile and resets fog", () => {
    const c = copyRow({ id: E1, deck_id: E1, campaign_id: OLD, pile: "hand", holder: PC, face_up: true }, spec("vtt_cards"), ids, OLD, NEW, "me")!;
    expect(c).toMatchObject({ pile: "draw", holder: null, face_up: false, deck_id: E1N });
    const sc = copyRow({ id: E1, campaign_id: OLD, battle_map_id: E1, revealed: "\\xff", door_state: { a: 1 } }, spec("vtt_scenes"), ids, OLD, NEW, "me")!;
    expect(sc).toMatchObject({ revealed: "\\x", door_state: {} });
  });
});

describe("copy order", () => {
  // Foreign keys between copied tables (from the schema): each target must be inserted first.
  const FK: Record<string, string[]> = {
    maps: ["entries"], map_pins: ["maps"], map_layers: ["world_maps"], regions: ["world_maps", "map_layers", "entries"],
    world_hexes: ["world_maps", "regions"], map_features: ["world_maps"], map_pois: ["world_maps", "entries", "characters", "map_icons"],
    map_labels: ["world_maps"], map_images: ["world_maps"], vtt_scenes: ["battle_maps"], vtt_cards: ["vtt_decks"],
    session_plan_items: ["characters"], entity_links: ["entries", "characters"],
  };
  it("inserts every table after the tables it points at", () => {
    const at = new Map(COPY_SPECS.map((s, i) => [s.table, i]));
    for (const [t, targets] of Object.entries(FK)) for (const g of targets) expect(at.get(g)!).toBeLessThan(at.get(t)!);
  });
});
