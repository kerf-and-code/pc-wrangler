import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// The GM's global custom-tile library (see p87-custom-tiles.sql and lib/tiles/custom.ts).
//   GET    /api/custom-tiles?scope=dungeon|world  -> the caller's tiles (optionally one scope)
//   POST   /api/custom-tiles  { scope, label, dataUrl, color }  -> upload the cropped PNG + insert a row
//   DELETE /api/custom-tiles?id=<uuid>            -> remove the row and its stored image
// The cropped image is written to the existing public 'campaign-maps' bucket with the service-role
// client, so no storage RLS policy is needed; the table itself is owner-scoped by RLS.

const BUCKET = "campaign-maps";
const MAX_TILES = 500;                 // soft cap per GM
const MAX_DATAURL = 3_000_000;         // ~3 MB of base64; a 256px PNG is far smaller

export async function GET(request: Request) {
  try {
    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const scope = new URL(request.url).searchParams.get("scope");
    let q = supa.from("custom_tiles").select("id, scope, label, color, image_url, created_at").eq("profile_id", user.id).order("created_at", { ascending: false });
    if (scope === "dungeon" || scope === "world") q = q.eq("scope", scope);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ tiles: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { scope, label, dataUrl, color } = (await request.json()) as { scope?: string; label?: string; dataUrl?: string; color?: string };
    if (scope !== "dungeon" && scope !== "world") return NextResponse.json({ error: "Invalid scope." }, { status: 400 });
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return NextResponse.json({ error: "Missing tile image." }, { status: 400 });
    if (dataUrl.length > MAX_DATAURL) return NextResponse.json({ error: "Tile image is too large." }, { status: 413 });

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { count } = await supa.from("custom_tiles").select("id", { count: "exact", head: true }).eq("profile_id", user.id);
    if ((count ?? 0) >= MAX_TILES) return NextResponse.json({ error: `Tile library is full (${MAX_TILES} max).` }, { status: 409 });

    const mime = dataUrl.match(/^data:(image\/\w+);base64,/)?.[1] ?? "image/png";
    const ext = mime.split("/")[1] || "png";
    const bytes = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");

    const admin = createAdminClient();
    const id = crypto.randomUUID();
    const path = `custom-tiles/${user.id}/${id}.${ext}`;
    const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
    if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });
    const image_url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    const safeLabel = (typeof label === "string" && label.trim() ? label.trim() : "Custom tile").slice(0, 60);
    const safeColor = typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#888888";
    const row = { id, profile_id: user.id, scope, label: safeLabel, color: safeColor, image_url };
    const { error } = await admin.from("custom_tiles").insert(row);
    if (error) {
      await admin.storage.from(BUCKET).remove([path]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ tile: { id, scope, label: safeLabel, color: safeColor, image_url } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    // RLS restricts this select to the caller's own rows, so a hit proves ownership.
    const { data: rowData } = await supa.from("custom_tiles").select("image_url").eq("id", id).maybeSingle();
    const row = rowData as { image_url?: string } | null;
    if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const admin = createAdminClient();
    const marker = "/campaign-maps/";
    const idx = row.image_url?.indexOf(marker) ?? -1;
    if (row.image_url && idx >= 0) {
      const path = row.image_url.slice(idx + marker.length);
      await admin.storage.from(BUCKET).remove([path]);
    }
    const { error } = await admin.from("custom_tiles").delete().eq("id", id).eq("profile_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
