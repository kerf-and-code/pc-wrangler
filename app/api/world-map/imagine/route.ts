import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60; // Nano Banana image generation can take a while

const DAILY_LIMIT = 3;
const RATE_LIMIT_ENABLED = false; // TESTING: set true to enforce DAILY_LIMIT
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const PROMPT =
  "You are given a hand-painted hex-tile fantasy world map: each region already carries distinct terrain " +
  "artwork, with rivers and roads drawn over it. Repaint the whole thing as ONE cohesive, beautiful " +
  "hand-illustrated fantasy world-map poster. Keep every coastline, landmass, lake, river, road, " +
  "mountain range, and terrain region in the SAME position, shape, and proportion as the source - do " +
  "not move, add, or remove anything. Render each terrain in its true character: lush green forests, " +
  "snow-capped alpine peaks, rolling plains and prairie, golden deserts and cracked white salt flats, " +
  "murky reed-filled swamps and bogs, glowing magical feywild and enchanted groves with fairy rings, " +
  "ashen blighted wastes, glittering crystal caverns, and smoking volcanic peaks. Draw the rivers as " +
  "flowing blue water and the roads as worn trails following their exact routes. Style: rich painterly " +
  "antique cartography - parchment tones, softly illustrated relief, subtle sea texture, elegant " +
  "flourishes. No text, no labels, no hex grid, no borders. Preserve the overall layout and framing exactly.";

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

    const mimeMatch = controlImage.match(/^data:(image\/\w+);base64,/);
    const mime = mimeMatch ? mimeMatch[1] : "image/png";
    const b64 = controlImage.replace(/^data:image\/\w+;base64,/, "");

    const gemResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });
    if (!gemResp.ok) {
      const detail = await gemResp.text();
      return NextResponse.json({ error: `Image service error (${gemResp.status}): ${detail.slice(0, 200)}` }, { status: 502 });
    }

    const gem = (await gemResp.json()) as {
      promptFeedback?: { blockReason?: string };
      candidates?: { finishReason?: string; content?: { parts?: Array<{ text?: string; inline_data?: { data?: string }; inlineData?: { data?: string } }> } }[];
    };
    const cand = gem.candidates?.[0];
    const parts = cand?.content?.parts ?? [];
    // The REST response uses camelCase inlineData; accept snake_case too for safety.
    const outB64 = parts.map((pt) => pt.inline_data?.data ?? pt.inlineData?.data).find(Boolean);
    if (!outB64) {
      const block = gem.promptFeedback?.blockReason;
      const finish = cand?.finishReason ?? "unknown";
      const said = parts.map((pt) => pt.text).filter(Boolean).join(" ").slice(0, 300);
      const why = block ? `prompt blocked (${block})` : `finishReason ${finish}${said ? ` - model said: ${said}` : ""}`;
      return NextResponse.json({ error: `The image service returned no image. ${why}` }, { status: 502 });
    }

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
