import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// A vision model (understanding, not image-gen) reads a map image and labels each hex's terrain. If it
// 404s, set GEMINI_VISION_MODEL to a model your key can call.
const MODEL = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";

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

    const total = width * height;
    const legend = biomes.map((b) => `${b.id} = ${b.label}`).join("; ");
    const prompt =
      `This image is a top-down fantasy world map. Read it as a ${width}-column by ${height}-row grid ` +
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
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
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

    // Validate: clamp every cell to a known biome id, pad/truncate to exactly width*height.
    const known = new Set(biomes.map((b) => b.id));
    const fallback = biomes[0].id;
    const tiles: number[] = [];
    for (let i = 0; i < total; i++) { const v = raw[i]; tiles.push(typeof v === "number" && known.has(v) ? v : fallback); }

    return NextResponse.json({ ok: true, tiles });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/world-map/trace] failure:", detail, e);
    return NextResponse.json({ error: `Could not trace the map: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
