import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseAi, reserveAi } from "@/lib/ai-allowance";
import { geminiTokens, recordUsage } from "@/lib/usage";
import { isCampaignGm } from "@/lib/campaign-gm";

// POST /api/battle-map/paint (2026-11-06)
//
// Paints one level of a battle map with Gemini so the GM can lay the painting over the map. The client
// sends the plan: the whole n x n grid rendered by lib/dungeon/classic with no frame, title, numbers,
// labels or grid, so the image edges ARE the grid edges. The painting comes back square and the client
// stretches it over the same square, so a wall in the plan lands on the same wall in the painting as long
// as Gemini kept it in place. Gemini cannot promise that, so the editor keeps the real walls, doors and
// grid drawn over the painting by default and flags a painting once the map changes.
//
// Same guard rails as /api/world-map/imagine: signed in, GM of the campaign, GM pilot access and a daily
// cap (lib/ai-allowance.ts, kind "battle", audit T4), stored in the campaign-maps bucket. Nothing but the plan image and the prompt goes to Google.

export const maxDuration = 60;

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
const IMAGE_SIZE = process.env.GEMINI_IMAGE_SIZE || "2K";
const MAX_IMAGE_CHARS = 6_000_000;   // about 4.5 MB of base64; the client sends a JPEG well under this

const MATCH =
  "The source image is a top-down tabletop battle map drawn as an ink plan on parchment. Repaint it as ONE " +
  "finished, full-colour, top-down battle map seen from directly above. It must match the plan EXACTLY. " +
  "The image edges are the map edges: keep the same framing, scale and orientation, no zoom, no crop, no " +
  "border. Every wall, doorway, room, corridor, cave edge, pool, river, road, cliff, tree, rock, tent, " +
  "wagon, piece of furniture and object stays in the SAME position, size, shape and rotation. Do not add, " +
  "remove, move or resize anything: no new rooms, doors, paths, trees, rocks or props. Do not add any " +
  "perspective or tilt. ";

const LEGEND =
  "How to read the plan: heavy black ink lines are walls; the cross-hatched band and the plain parchment " +
  "beyond it are solid rock, never floor; pale stone squares are flagstone floor; sandy dotted areas with " +
  "wobbly walls are rough cave; blue with wave marks is water; orange with cracks is lava; pale blue is " +
  "ice; wood-brown planks are a timber deck; grey is a crypt; green tones are grass, meadow and forest " +
  "floor; tan is dirt and road; pale yellow is sand; white is snow; olive with puddles is swamp; deep blue " +
  "is deep water; grey-brown with short hatching is a cliff or rocky slope. Small shapes set into walls are " +
  "doors: a brown bar is a wooden door, two bars a double door, a bar with a dot a locked door, a row of " +
  "dots a portcullis, a gap with posts an archway; a dark bar marked S is a SECRET door, paint it as plain " +
  "wall. Round scalloped green shapes are tree canopies seen from above, star shapes are pines, the other " +
  "inked shapes are the objects they look like (pillars, statues, chests, tables, beds, stairs, barrels, " +
  "crates, rubble, campfires, tents, wagons, boats, bridges, fences). ";

const STYLE: Record<string, string> = {
  fantasy: "Style: rich hand-painted fantasy battle map, natural textures, soft light from the top left, gentle shadows under walls and objects.",
  grimdark: "Style: grim, dark fantasy battle map, worn and weathered textures, desaturated colour, deep shadows, oppressive mood.",
  ink: "Style: clean ink linework with soft watercolour washes, light and airy, like a printed adventure module map.",
};

const NO_TEXT = " No text, letters, numbers, labels, grid lines, compass, scale bar, title or border.";

type Body = { campaignId?: string; controlImage?: string; kind?: "indoor" | "outdoor"; style?: string; flavour?: string; feetPerSquare?: number };

export async function POST(request: Request) {
  try {
    const { campaignId, controlImage, kind, style, flavour, feetPerSquare } = (await request.json()) as Body;
    if (!campaignId || typeof controlImage !== "string" || !/^data:image\/(png|jpeg);base64,/.test(controlImage)) {
      return NextResponse.json({ error: "Missing campaign or map image." }, { status: 400 });
    }
    if (controlImage.length > MAX_IMAGE_CHARS) return NextResponse.json({ error: "The map image is too large to send." }, { status: 413 });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Painting isn't configured yet (missing GEMINI_API_KEY)." }, { status: 503 });

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { data: camp } = await supa.from("campaigns").select("gm_id").eq("id", campaignId).maybeSingle();
    if (!(await isCampaignGm(supa, campaignId, user.id, (camp as { gm_id: string } | null)?.gm_id ?? null))) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

    const admin = createAdminClient();
    const grant = await reserveAi(admin, user.id, campaignId, "battle");
    if (!grant.ok) return NextResponse.json({ error: grant.error, limited: grant.limited, remaining: 0 }, { status: grant.status });
    let done = false;
    try {

    const kindNote = kind === "outdoor"
      ? "This is an OUTDOOR map: open ground everywhere except the walled buildings, ruins or caves. "
      : "This is an INDOOR map: everything outside the walls is solid rock. ";
    const scale = feetPerSquare && feetPerSquare > 0 ? `Each grid square of the plan is ${Math.round(feetPerSquare)} feet across. ` : "";
    const extra = typeof flavour === "string" && flavour.trim() ? ` GM's direction (it never overrides the layout rules above): ${flavour.trim().slice(0, 300)}.` : "";
    const prompt = MATCH + kindNote + scale + LEGEND + (STYLE[style ?? ""] ?? STYLE.fantasy) + extra + NO_TEXT;

    const mime = controlImage.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
    const b64 = controlImage.replace(/^data:image\/(png|jpeg);base64,/, "");

    const gemResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { imageSize: IMAGE_SIZE, aspectRatio: "1:1" } },
      }),
    });
    if (!gemResp.ok) {
      const detail = await gemResp.text();
      return NextResponse.json({ error: `Image service error (${gemResp.status}): ${detail.slice(0, 200)}` }, { status: 502 });
    }
    const gem = (await gemResp.json()) as {
      promptFeedback?: { blockReason?: string };
      candidates?: { finishReason?: string; content?: { parts?: Array<{ text?: string; inline_data?: { data?: string; mime_type?: string }; inlineData?: { data?: string; mimeType?: string } }> } }[];
    };
    await recordUsage({ kind: "image", provider: "google", model: MODEL, route: "battle-map/paint", campaignId, images: 1, ...geminiTokens(gem) });
    const cand = gem.candidates?.[0];
    const parts = cand?.content?.parts ?? [];
    const imgs = parts.map((pt) => ({ data: pt.inline_data?.data ?? pt.inlineData?.data, mime: pt.inline_data?.mime_type ?? pt.inlineData?.mimeType })).filter((x) => !!x.data);
    const out = imgs[imgs.length - 1];
    if (!out?.data) {
      const block = gem.promptFeedback?.blockReason;
      const said = parts.map((pt) => pt.text).filter(Boolean).join(" ").slice(0, 300);
      const why = block ? `prompt blocked (${block})` : `finishReason ${cand?.finishReason ?? "unknown"}${said ? `, model said: ${said}` : ""}`;
      return NextResponse.json({ error: `The image service returned no image: ${why}` }, { status: 502 });
    }

    const ext = out.mime === "image/jpeg" ? "jpg" : "png";
    const path = `${campaignId}/battle-${crypto.randomUUID()}.${ext}`;
    const up = await admin.storage.from("campaign-maps").upload(path, Buffer.from(out.data, "base64"), { contentType: out.mime === "image/jpeg" ? "image/jpeg" : "image/png", upsert: false });
    if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });
    const url = admin.storage.from("campaign-maps").getPublicUrl(path).data.publicUrl;
    done = true;
    return NextResponse.json({ ok: true, url, remaining: grant.remaining });
    } finally {
      if (!done) await releaseAi(admin, grant.id);
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/battle-map/paint] failure:", detail, e);
    return NextResponse.json({ error: `Could not paint the map: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
