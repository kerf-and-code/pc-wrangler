import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// A vision model (understanding, not image-gen) reads a map image and labels each hex's terrain. Uses a
// current GA Flash model (older ones like gemini-2.5-flash are blocked for new keys). If it 404s, set
// GEMINI_VISION_MODEL to a model your key can call (e.g. gemini-3.7-flash).
const MODEL = process.env.GEMINI_VISION_MODEL || "gemini-3.6-flash";

type Body = {
  campaignId: string;
  image: string; // data URL
  width: number;
  height: number;
  biomes: { id: number; label: string; color?: string }[];
};

export async function POST(request: Request) {
  try {
    const { campaignId, image, width, height, biomes } = (await request.json()) as Body;
    if (!campaignId || typeof image !== "string" || !width || !height || !Array.isArray(biomes) || biomes.length === 0) {
      return NextResponse.json({ error: "Missing image, dimensions, or biomes." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Tracing isn't configured yet (missing GEMINI_API_KEY)." }, { status: 503 });

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: camp } = await supa.from("campaigns").select("gm_id").eq("id", campaignId).maybeSingle();
    if ((camp as { gm_id: string } | null)?.gm_id !== user.id) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }

    const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
    const mime = mimeMatch ? mimeMatch[1] : "image/png";
    const b64 = image.replace(/^data:image\/\w+;base64,/, "");

    // A model can't meaningfully label 10k hexes from a picture, and asking for that many integers is slow
    // and can time out the gateway. Read into a COARSE grid (<= MAX_TRACE_CELLS), then upsample below.
    const MAX_TRACE_CELLS = 2500;
    const scale = Math.min(1, Math.sqrt(MAX_TRACE_CELLS / (width * height)));
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));
    const total = tw * th;
    const legend = biomes.map((b) => `${b.id} = ${b.label}`).join("; ");
    const prompt =
      `This image is a top-down fantasy world map. Read it as a ${tw}-column by ${th}-row grid ` +
      `of ${total} cells, scanning left to right, top to bottom. For EACH cell choose the biome id whose ` +
      `terrain best matches what that cell mostly shows. Judge by the map's features and context, not ` +
      `colour alone: distinguish plain forest from enchanted or magical forest, plains from desert, open ` +
      `water from land, mountains, swamp, snow, and so on. Biomes (id = name): ${legend}. ` +
      `Respond with ONLY a JSON array of exactly ${total} integers in scan order, each one of the biome ids listed.`;

    const gemResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
    if (!gemResp.ok) {
      const detail = await gemResp.text();
      return NextResponse.json({ error: `Trace service error (${gemResp.status}): ${detail.slice(0, 200)}` }, { status: 502 });
    }

    const gem = (await gemResp.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = gem.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ?? "";

    let parsed: unknown;
    try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); }
    catch { return NextResponse.json({ error: "The trace didn't return usable tiles. Try again." }, { status: 502 }); }

    const raw: unknown = Array.isArray(parsed) ? parsed : (parsed as { tiles?: unknown; cells?: unknown })?.tiles ?? (parsed as { cells?: unknown })?.cells;
    if (!Array.isArray(raw) || raw.length < total * 0.5) {
      return NextResponse.json({ error: `The trace returned ${Array.isArray(raw) ? raw.length : 0} tiles; expected ${total}. Try again.` }, { status: 502 });
    }

    // Validate the coarse grid: clamp every cell to a known biome id, pad/truncate to exactly tw*th.
    const known = new Set(biomes.map((b) => b.id));
    const fallback = biomes[0].id;
    const coarse: number[] = [];
    for (let i = 0; i < total; i++) { const v = raw[i]; coarse.push(typeof v === "number" && known.has(v) ? v : fallback); }

    // Upsample the coarse grid (tw x th) to the real grid (width x height), nearest-neighbour.
    const tiles: number[] = new Array(width * height);
    for (let r = 0; r < height; r++) {
      const cr = Math.min(th - 1, Math.floor((r * th) / height));
      for (let c = 0; c < width; c++) {
        const cc = Math.min(tw - 1, Math.floor((c * tw) / width));
        tiles[r * width + c] = coarse[cr * tw + cc];
      }
    }

    return NextResponse.json({ ok: true, tiles });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/world-map/trace] failure:", detail, e);
    return NextResponse.json({ error: `Could not trace the map: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
