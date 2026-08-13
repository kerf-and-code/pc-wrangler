import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60; // Nano Banana image generation can take a while

const DAILY_LIMIT = 3;
const RATE_LIMIT_ENABLED = false; // TESTING: set true to enforce DAILY_LIMIT
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const PROMPT =
  "Repaint this world map as a beautiful hand-painted fantasy cartography poster. Keep every coastline, " +
  "river, lake, mountain range, forest, desert, and terrain region in the SAME position, shape, and " +
  "proportion as the source image - do not move, add, or remove landmasses or water. Render it in a rich " +
  "painterly antique-map style: parchment tones, softly illustrated mountains and forests, gentle color " +
  "gradients for biomes, subtle sea texture, and elegant cartographic flourishes. No text, no labels, no " +
  "hex grid, no borders. Preserve the overall layout and framing exactly.";

type Body = { campaignId: string; controlImage: string };

export async function POST(request: Request) {
  try {
    const { campaignId, controlImage } = (await request.json()) as Body;
    if (!campaignId || typeof controlImage !== "string") {
      return NextResponse.json({ error: "Missing campaignId or image." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Fantasy view isn't configured yet (missing GEMINI_API_KEY)." }, { status: 503 });

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: camp } = await supa.from("campaigns").select("gm_id").eq("id", campaignId).maybeSingle();
    if ((camp as { gm_id: string } | null)?.gm_id !== user.id) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }

    const admin = createAdminClient();

    // Rate limit: 3 per rolling 24h per GM.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin
      .from("ai_map_renders")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", user.id)
      .gte("created_at", since);
    const used = count ?? 0;
    if (RATE_LIMIT_ENABLED && used >= DAILY_LIMIT) {
      return NextResponse.json({ error: `Daily fantasy-view limit reached (${DAILY_LIMIT} per day). Try again later.`, limited: true, remaining: 0 }, { status: 429 });
    }

    const b64 = controlImage.replace(/^data:image\/\w+;base64,/, "");

    const gemResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: "image/png", data: b64 } }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });
    if (!gemResp.ok) {
      const detail = await gemResp.text();
      return NextResponse.json({ error: `Image service error (${gemResp.status}): ${detail.slice(0, 200)}` }, { status: 502 });
    }

    const gem = (await gemResp.json()) as { candidates?: { content?: { parts?: { inline_data?: { data?: string } }[] } }[] };
    const parts = gem.candidates?.[0]?.content?.parts ?? [];
    const outB64 = parts.find((p) => p?.inline_data?.data)?.inline_data?.data;
    if (!outB64) return NextResponse.json({ error: "The image service returned no image." }, { status: 502 });

    const bytes = Buffer.from(outB64, "base64");
    const path = `${campaignId}/ai-${crypto.randomUUID()}.png`;
    const up = await admin.storage.from("campaign-maps").upload(path, bytes, { contentType: "image/png", upsert: false });
    if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });
    const url = admin.storage.from("campaign-maps").getPublicUrl(path).data.publicUrl;

    const { data: wm } = await admin.from("world_maps").select("id").eq("campaign_id", campaignId).maybeSingle();
    if (wm) await admin.from("world_maps").update({ ai_image_url: url, ai_image_at: new Date().toISOString() }).eq("id", (wm as { id: string }).id);
    await admin.from("ai_map_renders").insert({ campaign_id: campaignId, profile_id: user.id });

    return NextResponse.json({ ok: true, url, remaining: Math.max(0, DAILY_LIMIT - (used + 1)) });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/world-map/imagine] failure:", detail, e);
    return NextResponse.json({ error: `Could not generate the fantasy view: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
