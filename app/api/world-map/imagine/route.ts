import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60; // Nano Banana image generation can take a while

const DAILY_LIMIT = 3;
const RATE_LIMIT_ENABLED = false; // TESTING: set true to enforce DAILY_LIMIT
// Nano Banana 2 (gemini-3.1-flash-image) outputs 1K/2K/4K; the older gemini-2.5-flash-image was 1K only.
// Both overridable via env: if the model 404s, try "gemini-3.1-flash-image-preview". Size: 1K|2K|4K.
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
const IMAGE_SIZE = process.env.GEMINI_IMAGE_SIZE || "2K";
// Genre render presets. The placement rules (use the tile map only for WHERE things go, dissolve the
// hexes, keep every coastline/river/road in the same position) are shared; each genre swaps the
// terrain interpretation and the visual style. `style` on the request picks one; the default,
// 'fantasy', is the original render, unchanged.
const PLACEMENT =
  "The source is a colored tile map - use it ONLY as a guide to WHERE each terrain, river, and road " +
  "goes; do NOT copy its blocky look. Completely DISSOLVE every hexagon, tile edge, and grid line, so " +
  "the result reads as smooth, organic regions with soft natural transitions, NOT a grid of colored " +
  "cells. Keep every coastline, landmass, lake, river, road, and terrain region in the SAME position " +
  "and proportion.";
const NO_LABELS = "No text, no labels, no hex grid, no borders.";

const STYLE_PROMPTS: Record<string, string> = {
  fantasy:
    "Transform this map into ONE cohesive, hand-painted fantasy world map. " + PLACEMENT + " " +
    "Render each terrain in its true character: lush green forests, snow-capped alpine peaks, rolling " +
    "plains and prairie, golden deserts and cracked white salt flats, murky reed-filled swamps and " +
    "bogs, glowing magical feywild and enchanted groves with fairy rings, ashen blighted wastes, " +
    "glittering crystal caverns, and smoking volcanic peaks. Draw rivers as flowing blue water and " +
    "roads as worn trails along their exact routes. Where land meets the sea, render soft sandy and " +
    "rocky beaches along the coastline. Style: rich painterly antique cartography - parchment tones, " +
    "softly illustrated relief, subtle sea texture, elegant flourishes. " + NO_LABELS,
  scifi:
    "Transform this map into ONE cohesive orbital survey map of a colonized alien world. " + PLACEMENT + " " +
    "Render each terrain as an alien biome or developed zone: bioluminescent forests, jagged mineral " +
    "ranges, terraformed plains, glassy deserts and dry seabeds, toxic marshlands, crystalline caverns, " +
    "and volcanic geothermal fields. Draw rivers as glowing energy or coolant channels and roads as " +
    "mag-lev lines and lit highways along their exact routes. Style: clean high-tech cartography - a " +
    "satellite / holographic survey atlas, deep blues and teals with cyan and amber glowing accents, " +
    "subtle scan-line and topographic contours on a dark background. " + NO_LABELS,
  grimdark:
    "Transform this map into ONE cohesive grim, war-scarred dark-fantasy world map. " + PLACEMENT + " " +
    "Render each terrain oppressive and blighted: dead blackened forests, jagged ash-grey peaks, " +
    "trampled battle-plains, bone-white salt deserts, fetid bogs, corrupted wastes, and smoking " +
    "volcanic scars. Draw rivers as dark sluggish water and roads as churned war-trails along their " +
    "exact routes. Style: heavy ink-and-wash cartography on scorched, stained parchment - desaturated " +
    "ash tones with ember-red and sickly-green accents, deep shadow, an ominous oppressive mood. " + NO_LABELS,
  urban:
    "Transform this map into ONE cohesive modern regional map of a developed, built-up land. " + PLACEMENT + " " +
    "Render each region in contemporary character: dense city sprawl and suburbs, green parks and " +
    "reserves, farmland patchwork, industrial districts, and open water. Draw rivers as blue waterways " +
    "and roads as a network of highways and streets along their exact routes. Style: clean stylized " +
    "modern road-atlas / noir city-region cartography - muted contemporary tones, clear land-use " +
    "colour blocking, subtle paper texture. " + NO_LABELS,
};

// Non-fantasy genres reinterpret the fantasy TILE TYPES into genre-native features. The fantasy tiles
// (feywild, enchanted forest, corrupted/blighted land, crystal caverns, volcanic) carry magical
// meaning the base style alone won't convey, so each genre says explicitly what they become.
const STYLE_REINTERP: Record<string, string> = {
  scifi:
    " Reinterpret the realm's magical and distinctive regions for a colonized world: feywild-touched " +
    "regions become reality-warped anomaly and exotic-energy zones; enchanted or magical forests become " +
    "bio-engineered xenoflora reserves and arcology greenbelts; corrupted or blighted lands become toxic " +
    "contamination and fallout exclusion zones; crystal caverns become energy- and data-crystal mines; " +
    "volcanic peaks become geothermal power fields and refineries; swamps become algae-farm or hydrocarbon " +
    "wetlands; snowfields become cryo and polar research stations; deserts become solar-array flats and " +
    "mining claims. Render all other regions as their plausible colonized-world equivalent.",
  grimdark:
    " Reinterpret the realm's magical and distinctive regions for a war-torn world: feywild-touched " +
    "regions become killing fields; enchanted or magical forests become smoke-belching war factories; " +
    "corrupted or blighted lands become a demonic incursion of hell-rifts and daemon-scarred earth; " +
    "crystal caverns become soul-gem mines; volcanic peaks become active artillery battlefields; swamps " +
    "become plague-ridden trench works; snowfields become frozen death-march fronts; deserts become ash " +
    "wastes strewn with mass graves. Render all other regions as their grim, brutalized equivalent.",
  urban:
    " Reinterpret the realm's magical and distinctive regions for a modern developed land: feywild-touched " +
    "regions become protected wildland and national parks; enchanted or magical forests become old-growth " +
    "reserves and botanical parkland; corrupted or blighted lands become industrial brownfields and " +
    "abandoned exclusion zones; crystal caverns become quarries and mining districts; volcanic peaks " +
    "become geothermal plants and badlands parks; swamps become wetland preserves; snowfields become " +
    "alpine ski resorts; deserts become arid ranchland and solar farms. Render all other regions as their " +
    "modern real-world equivalent.",
};

type Body = { campaignId: string; controlImage: string; scaleHint?: string; style?: string; biomes?: { label: string; color: string }[] };

export async function POST(request: Request) {
  try {
    const { campaignId, controlImage, scaleHint, style, biomes } = (await request.json()) as Body;
    const chosenStyle = style && STYLE_PROMPTS[style] ? style : "fantasy";
    const basePrompt = STYLE_PROMPTS[chosenStyle];
    // Only non-fantasy genres reinterpret + get a colour legend; fantasy renders exactly as before.
    const reinterp = chosenStyle !== "fantasy" ? STYLE_REINTERP[chosenStyle] ?? "" : "";
    const legend =
      chosenStyle !== "fantasy" && biomes && biomes.length
        ? " The source map's region colours are: " +
          biomes.map((b) => `${b.label} ${b.color}`).join(", ") +
          " - use these to identify each region before reinterpreting it."
        : "";
    const scale = scaleHint ? ` Cartographic scale: this is ${scaleHint}.` : "";
    const promptText = `${basePrompt}${reinterp}${legend}${scale}`;
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
        contents: [{ parts: [{ text: promptText }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { imageSize: IMAGE_SIZE } },
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
    const outImgs = parts.map((pt) => pt.inline_data?.data ?? pt.inlineData?.data).filter(Boolean);
    const outB64 = outImgs[outImgs.length - 1];
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
    if (wm) await admin.from("world_maps").update({ ai_image_url: url, ai_image_at: new Date().toISOString(), style: chosenStyle }).eq("id", (wm as { id: string }).id);
    await admin.from("ai_map_renders").insert({ campaign_id: campaignId, profile_id: user.id });

    return NextResponse.json({ ok: true, url, remaining: Math.max(0, DAILY_LIMIT - (used + 1)) });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/world-map/imagine] failure:", detail, e);
    return NextResponse.json({ error: `Could not generate the fantasy view: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
