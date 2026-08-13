import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

// Accept a generated world: write the terrain blob + generation metadata onto the world_maps row,
// replace the overlay features (rivers/roads) and the generated pins, and clear stale region-hex
// assignments. Owner-gated exactly like the other world-map routes. This REPLACES the map's terrain,
// features, and pins wholesale, so hand-placed pins and hex-to-region assignments are cleared; the
// named regions themselves are kept. GM-only.

type Feature = { kind: string; klass: number; path: [number, number][]; name: string | null };
type Poi = { col: number; row: number; x: number; y: number; iconKey: string; name: string };
type Body = {
  campaignId: string;
  terrain: string;
  features: Feature[];
  pois: Poi[];
  genConfig: unknown;
  genSeed: string;
  width: number;
  height: number;
  originCol: number;
  originRow: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const { campaignId, terrain, features, pois, genConfig, genSeed, width, height, originCol, originRow } = body;
    if (!campaignId || typeof terrain !== "string") {
      return NextResponse.json({ error: "Missing campaignId or terrain." }, { status: 400 });
    }

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: camp } = await supa.from("campaigns").select("gm_id").eq("id", campaignId).maybeSingle();
    if ((camp as { gm_id: string } | null)?.gm_id !== user.id) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: wm } = await admin.from("world_maps").select("id").eq("campaign_id", campaignId).maybeSingle();
    if (!wm) return NextResponse.json({ error: "No world map exists for this campaign yet." }, { status: 404 });
    const worldMapId = (wm as { id: string }).id;

    const upd = await admin.from("world_maps")
      .update({ terrain, gen_config: genConfig, gen_seed: genSeed, width, height, origin_col: originCol, origin_row: originRow })
      .eq("id", worldMapId);
    if (upd.error) return NextResponse.json({ error: `Terrain write failed: ${upd.error.message}` }, { status: 500 });

    await admin.from("map_features").delete().eq("world_map_id", worldMapId);
    if (features.length) {
      const rows = features.map((f) => ({ world_map_id: worldMapId, kind: f.kind, class: f.klass, path: f.path, name: f.name ?? null }));
      const insF = await admin.from("map_features").insert(rows);
      if (insF.error) return NextResponse.json({ error: `Features write failed: ${insF.error.message}` }, { status: 500 });
    }

    await admin.from("map_pois").delete().eq("world_map_id", worldMapId);
    if (pois.length) {
      const rows = pois.map((p) => ({ world_map_id: worldMapId, x: p.x, y: p.y, col: p.col, row: p.row, icon_key: p.iconKey, name: p.name, visibility: "common" }));
      const insP = await admin.from("map_pois").insert(rows);
      if (insP.error) return NextResponse.json({ error: `Pins write failed: ${insP.error.message}` }, { status: 500 });
    }

    await admin.from("world_hexes").delete().eq("world_map_id", worldMapId);

    return NextResponse.json({ ok: true, features: features.length, pois: pois.length });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/world-map/generate] failure:", detail, e);
    return NextResponse.json({ error: `Could not apply the generated world: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
