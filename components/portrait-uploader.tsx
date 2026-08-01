"use client";

/**
 * A small, reusable portrait uploader for the campaign-maps bucket. Used by both the Forge (PC
 * portraits) and the monster stat-block builder (creature portraits). It uploads an image, stores
 * it at the caller-supplied path, and hands back the public URL for the caller to persist.
 *
 * It does NOT decide the path or persist the URL itself: the caller owns those, because the path
 * conventions and the row being updated differ between a PC and a stat block. This component only
 * handles file selection, the upload, and preview. Writes are gated by the storage policies in
 * p14-portrait-uploads.sql; if the caller lacks permission the upload fails and we surface it
 * plainly rather than pretending it worked.
 */

import React, { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "campaign-maps";
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB; portraits don't need more and the bucket isn't a CDN.
const OK_TYPES = ["image/png", "image/jpeg", "image/webp"];

export type PortraitUploaderProps = {
  // The object path within campaign-maps, WITHOUT extension (we append it from the file type).
  // e.g. "<campaign_id>/portraits/<character_id>" or "statblocks/<id>".
  // Null means "not ready yet" (e.g. the row hasn't been saved, so there's no id): the control
  // renders a hint instead of an upload button.
  basePath: string | null;
  currentUrl?: string | null;
  onUploaded: (publicUrl: string, path: string) => void;
  label?: string;
  notReadyHint?: string;
  // Optional theming hooks so the button matches whichever surface hosts it.
  buttonStyle?: React.CSSProperties;
  textColor?: string;
  mutedColor?: string;
};

export function PortraitUploader({
  basePath, currentUrl, onUploaded, label = "Portrait",
  notReadyHint = "Save first, then add a portrait.",
  buttonStyle, textColor = "#e8e3d8", mutedColor = "#9a9488",
}: PortraitUploaderProps) {
  const supabase = React.useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl || null);

  const pick = () => inputRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file || !basePath) return;

    if (!OK_TYPES.includes(file.type)) { setError("Use a PNG, JPEG, or WebP image."); return; }
    if (file.size > MAX_BYTES) { setError("That image is over 4 MB. Use a smaller one."); return; }

    setBusy(true);
    setError(null);
    try {
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${basePath}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      // Cache-bust so a re-upload to the same path shows the new image immediately.
      const url = `${data.publicUrl}?v=${Date.now()}`;
      setPreview(url);
      onUploaded(url, path);
    } catch (err) {
      // Surface what actually failed. This used to be a bare catch that replaced every error with
      // "you may not have permission to write here", which is a GUESS: a missing bucket, an
      // oversized payload, a network drop and a genuine RLS refusal all produced that same
      // sentence. It sent a real debugging session chasing storage policies that turned out to be
      // installed correctly. Storage errors carry a status and a message; show them.
      const e = err as { message?: string; status?: number; statusCode?: string; error?: string };
      const status = e?.status ?? (e?.statusCode ? Number(e.statusCode) : undefined);
      const msg = e?.message || e?.error || "Unknown error.";
      const hint =
        status === 403 || /row-level security|policy|unauthor/i.test(msg)
          ? " The storage policy for this path is not granting write access. Check /gm/start for an unapplied migration."
          : status === 404 || /bucket/i.test(msg)
            ? " The storage bucket was not found."
            : status === 413 || /large|size/i.test(msg)
              ? " The file was rejected as too large by the server."
              : "";
      setError(`Upload failed: ${msg}${status ? ` (${status})` : ""}.${hint}`);
      // Keep the raw object in the console for anything the cases above do not cover.
      console.error("portrait upload failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{
        width: 64, height: 64, borderRadius: 8, overflow: "hidden", flexShrink: 0,
        border: `1px solid ${mutedColor}`, background: "rgba(255,255,255,0.03)",
        display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
        {preview
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={preview} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <span style={{ color: mutedColor, fontSize: 22 }}>◈</span>}
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: mutedColor, textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</span>
        {basePath ? (
          <>
            <button type="button" onClick={pick} disabled={busy}
              style={buttonStyle || {
                background: "transparent", color: textColor, border: `1px solid ${mutedColor}`,
                borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: busy ? "default" : "pointer",
              }}>
              {busy ? "Uploading…" : preview ? "Replace image" : "Upload image"}
            </button>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp"
              onChange={onFile} style={{ display: "none" }} />
          </>
        ) : (
          <span style={{ fontSize: 12, color: mutedColor, fontStyle: "italic" }}>{notReadyHint}</span>
        )}
        {error && <span style={{ fontSize: 11.5, color: "#c98a7a" }}>{error}</span>}
      </div>
    </div>
  );
}
