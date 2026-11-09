import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_SOUND_BYTES, SOUND_TYPES, normAudio, toInput } from "@/lib/tabletop/sound";

// app/api/tabletop/sound/route.ts (2026-11-08)
//
// The campaign's sound library (p124 vtt_sounds, phase 5s). GM only.
//
// POST (form: campaignId, file, name, kind 'music' | 'ambient', duration in seconds as the browser
// measured it): stores the file in the public campaign-maps bucket under <campaign_id>/audio/<uuid>.<ext>
// with the service role, then adds the library row with the GM's own session, so row level security and
// the table's address check (only that folder, on this project's storage host) both apply. If the row
// is refused, the file is removed again. MP3, OGG, Opus, M4A, AAC, WAV, WebM or FLAC, 25 MB at most.
//
// DELETE (JSON: campaignId, soundId): removes the row and its file, and takes the sound out of what is
// playing (tabletop_set_audio), so no browser keeps reaching for a file that is gone.

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Send the sound as a form upload." }, { status: 400 }); }
  const campaignId = String(form.get("campaignId") ?? "");
  const file = form.get("file");
  const kind = form.get("kind") === "ambient" ? "ambient" : "music";
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const dur = Number(form.get("duration"));
  if (!UUID.test(campaignId)) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a sound file." }, { status: 400 });
  const ext = SOUND_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Use an MP3, OGG, Opus, M4A, AAC, WAV, WebM or FLAC file." }, { status: 415 });
  if (file.size > MAX_SOUND_BYTES) return NextResponse.json({ error: "That file is over 25 MB. A compressed MP3 or OGG is usually a tenth of the size." }, { status: 413 });

  const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only the GM adds sounds." }, { status: 403 });

  const admin = createAdminClient();
  const path = `${campaignId}/audio/${crypto.randomUUID()}.${ext}`;
  const up = await admin.storage.from("campaign-maps").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });
  const url = admin.storage.from("campaign-maps").getPublicUrl(path).data.publicUrl;

  const { data: row, error } = await supabase.from("vtt_sounds").insert({
    campaign_id: campaignId, name: name || "Sound", kind, url,
    duration: Number.isFinite(dur) && dur > 0 && dur < 86400 ? dur : null, bytes: file.size,
  }).select("id, name, kind, url, duration, bytes, created_at").single();
  if (error) {
    await admin.storage.from("campaign-maps").remove([path]);
    return NextResponse.json({ error: /vtt_sounds/.test(error.message) && /does not exist/.test(error.message) ? "Sound is not set up yet (the p124 migration)." : `Could not add the sound: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, sound: row });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let b: { campaignId?: unknown; soundId?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Send JSON." }, { status: 400 }); }
  const campaignId = String(b.campaignId ?? ""), soundId = String(b.soundId ?? "");
  if (!UUID.test(campaignId) || !UUID.test(soundId)) return NextResponse.json({ error: "Pick a sound." }, { status: 400 });
  const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only the GM removes sounds." }, { status: 403 });

  const { data: snd } = await supabase.from("vtt_sounds").select("id, url").eq("id", soundId).eq("campaign_id", campaignId).maybeSingle();
  const row = snd as { id: string; url: string } | null;
  if (!row) return NextResponse.json({ error: "That sound is not in this campaign." }, { status: 404 });

  // stop it first if it is playing, so no one is left reaching for it
  const { data: cur } = await supabase.from("vtt_audio").select("state").eq("campaign_id", campaignId).maybeSingle();
  const now = toInput(normAudio((cur as { state?: unknown } | null)?.state));
  if (now.music?.soundId === soundId || now.ambient.some((a) => a.soundId === soundId)) {
    const next = { music: now.music?.soundId === soundId ? null : now.music, ambient: now.ambient.filter((a) => a.soundId !== soundId) };
    const { error: sErr } = await supabase.rpc("tabletop_set_audio", { p_campaign: campaignId, p_state: next });
    if (sErr) return NextResponse.json({ error: `Could not stop it first: ${sErr.message}` }, { status: 500 });
  }

  const { error } = await supabase.from("vtt_sounds").delete().eq("id", soundId);
  if (error) return NextResponse.json({ error: `Could not remove it: ${error.message}` }, { status: 500 });

  const admin = createAdminClient();
  const folder = admin.storage.from("campaign-maps").getPublicUrl(`${campaignId}/audio/`).data.publicUrl;
  if (row.url.startsWith(folder)) {
    const fileName = row.url.slice(folder.length);
    if (/^[A-Za-z0-9._-]+$/.test(fileName)) await admin.storage.from("campaign-maps").remove([`${campaignId}/audio/${fileName}`]);
  }
  return NextResponse.json({ ok: true });
}
