import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// app/api/tools/map-render/route.ts
//
// The FREE, no-login AI render for the public map generator (/tools/map-generator). A trimmed, public
// sibling of app/api/world-map/imagine: world-mode only, no auth, no campaign, no storage. The client
// posts a smooth control image; this paints it via Gemini and returns the image inline as a data URL.
//
// KEY DIFFERENCES FROM THE PRODUCT ROUTE, per the free-tools plan:
//   - Uses GEMINI_FREE_API_KEY, a SEPARATE free-tier key, so public traffic can't drain the product's
//     paid quota. If it's unset, the feature is simply unavailable (503), which the tool handles.
//   - Renders at 1K (standard). High-def (2K/4K) stays a signup feature.
//   - Meters the BUDGET, not the person (no login = no real identity): a global daily ceiling and a soft
//     per-IP daily cap, counted from tool_render_log (service role only; see p76). Porous by design
//     (VPN/CGNAT defeat IP caps), which is acceptable because free-tier renders cost nothing; the caps
//     exist to stay within the free quota and slow casual looping, and the honest ask is "sign up".
//
// Public route: /api/tools is on the logged-out allowlist in lib/supabase/proxy.ts.

export const maxDuration = 60; // image generation can take a while

// The free route uses its OWN model + key, fully separate from the product's paid route. The default is
// Nano Banana (gemini-2.5-flash-image), which is available on the Gemini FREE tier (~500 images/day, no
// billing). Override with GEMINI_FREE_IMAGE_MODEL if Google changes the free-tier image model.
const MODEL = process.env.GEMINI_FREE_IMAGE_MODEL || "gemini-2.5-flash-image";
const IMAGE_SIZE = "1K"; // standard def; high-def is the signup upsell
const GLOBAL_DAILY = parseInt(process.env.TOOL_RENDER_GLOBAL_DAILY || "120", 10);
const PER_IP_DAILY = parseInt(process.env.TOOL_RENDER_IP_DAILY || "3", 10);

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

type Body = { controlImage: string; style?: string; biomes?: { label: string; color: string }[] };

export async function POST(request: Request) {
  try {
    const { controlImage, style, biomes } = (await request.json().catch(() => ({}))) as Body;
    if (typeof controlImage !== "string" || !controlImage.startsWith("data:image")) {
      return NextResponse.json({ error: "Missing map image." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_FREE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI rendering isn't available right now." }, { status: 503 });
    }

    const chosen = style && STYLE_PROMPTS[style] ? style : "fantasy";
    const reinterp = chosen !== "fantasy" ? STYLE_REINTERP[chosen] ?? "" : "";
    const legend =
      chosen !== "fantasy" && biomes && biomes.length
        ? " The source map's region colours are: " +
          biomes.map((b) => `${b.label} ${b.color}`).join(", ") +
          " - use these to identify each region before reinterpreting it."
        : "";
    const promptText = STYLE_PROMPTS[chosen] + reinterp + legend;

    const admin = createAdminClient();
    const ip = (request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "").trim() || "unknown";
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    // Global ceiling: protect the shared free-tier quota.
    const { count: gCount } = await admin
      .from("tool_render_log").select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if ((gCount ?? 0) >= GLOBAL_DAILY) {
      return NextResponse.json({ error: "Free renders are all used up for today. Join the pilot to get your own.", limited: true }, { status: 429 });
    }
    // Soft per-IP cap: friction, not a wall.
    if (ip !== "unknown") {
      const { count: ipCount } = await admin
        .from("tool_render_log").select("id", { count: "exact", head: true })
        .eq("ip", ip).gte("created_at", since);
      if ((ipCount ?? 0) >= PER_IP_DAILY) {
        return NextResponse.json({ error: `You've used your ${PER_IP_DAILY} free renders for today. Join the pilot for more.`, limited: true }, { status: 429 });
      }
    }

    const mime = controlImage.match(/^data:(image\/\w+);base64,/)?.[1] || "image/jpeg";
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
      return NextResponse.json({ error: `Image service error (${gemResp.status}). Please try again.` }, { status: 502 });
    }

    const gem = (await gemResp.json()) as {
      promptFeedback?: { blockReason?: string };
      candidates?: { finishReason?: string; content?: { parts?: Array<{ text?: string; inline_data?: { data?: string }; inlineData?: { data?: string } }> } }[];
    };
    const parts = gem.candidates?.[0]?.content?.parts ?? [];
    const outB64 = parts.map((p) => p.inline_data?.data ?? p.inlineData?.data).filter(Boolean).pop();
    if (!outB64) {
      const why = gem.promptFeedback?.blockReason ? `blocked (${gem.promptFeedback.blockReason})` : "no image returned";
      return NextResponse.json({ error: `The image service returned nothing (${why}). Please try again.` }, { status: 502 });
    }

    // Record the successful render (best-effort; a failed log must not fail the response).
    await admin.from("tool_render_log").insert({ tool: "map-render", ip });

    return NextResponse.json({ ok: true, image: `data:image/png;base64,${outB64}` });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Could not render the map: ${detail.slice(0, 200)}` }, { status: 500 });
  }
}
