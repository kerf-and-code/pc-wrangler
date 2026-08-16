"use client";

import React, { useRef, useState } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

// The block editor for a codex entry. A body is an ordered list of blocks - text or image - that the
// GM reorders by dragging and, for images, aligns left / center / right / full. Upload is delegated:
// the parent passes onUploadImage(file) -> url so this component stays independent of the storage
// layer (it drops straight onto the same Supabase bucket the PortraitUploader uses). blocks persist
// to entries.blocks (jsonb); the parent also flattens them to the plain-text body on save via
// blocksToPlainText, so search and the summary keep working.

export type Align = "left" | "center" | "right" | "full";
export type Block =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; url: string; caption: string; align: Align };

const uid = () => Math.random().toString(36).slice(2, 10);

// Flatten to plain text for the body column, search, and summary derivation. Image captions count
// as text so a caption-only image still contributes something searchable.
export function blocksToPlainText(blocks: Block[]): string {
  return blocks
    .map((b) => (b.type === "text" ? b.text : b.caption))
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

// A first-time migration helper: an entry that only has a `body` becomes one text block.
export function bodyToBlocks(body: string | null): Block[] {
  const t = (body || "").trim();
  return t ? [{ id: uid(), type: "text", text: t }] : [];
}

const ALIGNS: { v: Align; label: string }[] = [
  { v: "left", label: "Left" },
  { v: "center", label: "Center" },
  { v: "right", label: "Right" },
  { v: "full", label: "Full" },
];

export default function BlockEditor({
  blocks,
  onChange,
  onUploadImage,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  onUploadImage: (file: File) => Promise<string | null>;
}) {
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const setBlock = (id: string, next: Block) => onChange(blocks.map((b) => (b.id === id ? next : b)));
  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    const next = blocks.slice();
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  };
  const addText = () => onChange([...blocks, { id: uid(), type: "text", text: "" }]);
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    const url = await onUploadImage(file);
    setBusy(false);
    if (url) onChange([...blocks, { id: uid(), type: "image", url, caption: "", align: "center" }]);
  };

  const input: React.CSSProperties = {
    width: "100%", background: C.surface2, color: C.text, border: `1px solid ${C.line}`,
    borderRadius: FORGE_RADIUS, padding: "9px 11px", fontFamily: "inherit", fontSize: 14, outline: "none",
  };
  const ctrlBtn: React.CSSProperties = {
    background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: 6,
    padding: "3px 7px", fontSize: 11, cursor: "pointer",
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "grid", gap: 10 }}>
        {blocks.map((b, i) => (
          <div
            key={b.id}
            draggable
            onDragStart={() => { dragFrom.current = i; }}
            onDragOver={(e) => { e.preventDefault(); if (dragOver !== i) setDragOver(i); }}
            onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
            onDrop={(e) => { e.preventDefault(); if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null; setDragOver(null); }}
            style={{
              border: `1px solid ${dragOver === i ? C.sun : C.line}`, borderRadius: FORGE_RADIUS,
              background: C.surface, padding: 10, position: "relative",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span title="Drag to reorder" style={{ cursor: "grab", color: C.muted, fontSize: 15, userSelect: "none" }}>&#x2059;</span>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted }}>
                {b.type}
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button type="button" style={ctrlBtn} onClick={() => move(i, i - 1)} disabled={i === 0}>&uarr;</button>
                <button type="button" style={ctrlBtn} onClick={() => move(i, i + 1)} disabled={i === blocks.length - 1}>&darr;</button>
                <button type="button" style={{ ...ctrlBtn, color: C.warn }} onClick={() => remove(b.id)}>Remove</button>
              </div>
            </div>

            {b.type === "text" ? (
              <textarea
                value={b.text}
                onChange={(e) => setBlock(b.id, { ...b, text: e.target.value })}
                placeholder="Write. Markdown works for bold, italics, and links."
                rows={4}
                style={{ ...input, resize: "vertical", lineHeight: 1.6 }}
              />
            ) : (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={b.url}
                  alt={b.caption}
                  style={{
                    display: "block", borderRadius: 6, border: `1px solid ${C.line}`, marginBottom: 8,
                    maxHeight: 220, objectFit: "contain",
                    width: b.align === "full" ? "100%" : "auto",
                    maxWidth: "100%",
                    marginLeft: b.align === "right" ? "auto" : b.align === "center" ? "auto" : 0,
                    marginRight: b.align === "left" ? "auto" : b.align === "center" ? "auto" : 0,
                  }}
                />
                <input
                  value={b.caption}
                  onChange={(e) => setBlock(b.id, { ...b, caption: e.target.value })}
                  placeholder="Caption (optional)"
                  style={{ ...input, marginBottom: 8 }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  {ALIGNS.map((a) => (
                    <button
                      key={a.v}
                      type="button"
                      onClick={() => setBlock(b.id, { ...b, align: a.v })}
                      style={{
                        ...ctrlBtn,
                        borderColor: b.align === a.v ? C.sun : C.line,
                        color: b.align === a.v ? C.sun : C.muted,
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {blocks.length === 0 && (
        <p style={{ color: C.muted, fontSize: 13, margin: "4px 0 10px" }}>
          Empty. Add a text or image block to start the entry.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" onClick={addText}
          style={{ background: C.surface2, color: C.text, border: `1px dashed ${C.line}`, borderRadius: 9, padding: "9px 14px", fontSize: 13, cursor: "pointer" }}>
          &#65291; Text
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          style={{ background: C.surface2, color: busy ? C.muted : C.text, border: `1px dashed ${C.line}`, borderRadius: 9, padding: "9px 14px", fontSize: 13, cursor: busy ? "default" : "pointer" }}>
          {busy ? "Uploading\u2026" : "\uFF0B Image"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} style={{ display: "none" }} />
      </div>
    </div>
  );
}
