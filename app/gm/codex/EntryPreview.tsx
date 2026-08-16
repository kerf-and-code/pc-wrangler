"use client";

import React from "react";
import { C } from "@/lib/forge-theme";
import type { Block } from "./BlockEditor";

// A pop-up that renders the current entry draft the way the published page will: same three columns
// (Contents from headers · content · image panel), block widths, and heading style. It reproduces the
// wiki's own styles in a scoped .wp block so what you see here matches /c/[slug]/[section]/[entry],
// without saving or leaving the editor.

const WIKI_CSS = `
.wp { --w-deep:#14110d; --w-panel:#1f1a15; --w-ink:#ece4d6; --w-ink-2:#cbbfa6; --w-muted:#a99e86;
  --w-accent:#c9a24b; --w-accent-dim:#8a7038; --w-line:#3a332a; --w-hover:rgba(255,255,255,0.05);
  background:var(--w-deep); color:var(--w-ink);
  font-family:'EB Garamond','Iowan Old Style',Georgia,serif; font-size:18px; line-height:1.72; }
.wp .ey { font-family:'IBM Plex Mono',ui-monospace,monospace; font-size:11px; letter-spacing:.2em;
  text-transform:uppercase; color:var(--w-accent-dim); }
.wp .w-title { font-family:'Cinzel','EB Garamond',serif; font-size:34px; line-height:1.12; margin:0 0 14px; font-weight:600; }
.wp .w-body { font-size:17px; line-height:1.78; white-space:pre-wrap; }
.wp .w-h2 { font-family:'Cinzel','EB Garamond',serif; font-size:23px; font-weight:600; margin:8px 0 12px;
  display:flex; align-items:center; gap:10px; }
.wp .w-h2::before { content:"\\2726"; color:var(--w-accent); font-size:13px; }
.wp .w-tag { display:inline-block; font-family:'IBM Plex Mono',ui-monospace,monospace; font-size:11px;
  color:var(--w-accent); background:rgba(201,162,75,.12); border:1px solid var(--w-line);
  border-radius:999px; padding:3px 9px; margin-right:6px; }
.wp .w-card { background:var(--w-panel); border:1px solid var(--w-line); border-radius:12px; padding:15px; }
.wp .w-toc a { display:block; padding:5px 8px; color:var(--w-muted); font-size:14px; text-decoration:none;
  border-left:2px solid transparent; }
.wp figure { margin:0; }
.wp .panel img { display:block; width:100%; border-radius:8px; border:1px solid var(--w-line); }
.wp .panel figcaption, .wp .cap { font-size:13px; color:var(--w-muted); font-style:italic; margin-top:6px; }
`;

function BlockView({ b }: { b: Block }) {
  if (b.type === "header") return <h2 className="w-h2">{b.text}</h2>;
  if (b.type === "text") return <div className="w-body">{b.text}</div>;
  return (
    <figure>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={b.url}
        alt={b.caption}
        style={{
          display: "block", borderRadius: 8, border: "1px solid var(--w-line)", maxWidth: "100%",
          width: b.align === "full" || b.width === "half" ? "100%" : "auto",
          marginLeft: b.align === "right" || b.align === "center" ? "auto" : 0,
          marginRight: b.align === "left" || b.align === "center" ? "auto" : 0,
        }}
      />
      {b.caption && <figcaption className="cap">{b.caption}</figcaption>}
    </figure>
  );
}

export default function EntryPreview({
  title, summary, tags, blocks, onClose,
}: {
  title: string;
  summary: string;
  tags: string[];
  blocks: Block[];
  onClose: () => void;
}) {
  const headers = blocks.filter((b): b is Extract<Block, { type: "header" }> => b.type === "header" && !!b.text.trim());
  const bodyBlocks = blocks.filter((b) => !(b.type === "image" && b.slot === "panel"));
  const panelBlocks = blocks.filter((b): b is Extract<Block, { type: "image" }> => b.type === "image" && b.slot === "panel");
  const hasLeft = headers.length > 0;
  const hasRight = panelBlocks.length > 0;
  const cols = `${hasLeft ? "200px " : ""}minmax(0,1fr)${hasRight ? " 300px" : ""}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 3vw", overflow: "auto",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: WIKI_CSS }} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 1200, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.line}`, boxShadow: "0 30px 80px rgba(0,0,0,.6)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: C.surface2, borderBottom: `1px solid ${C.line}` }}>
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted }}>
            Preview &mdash; how this entry will look published
          </span>
          <button type="button" onClick={onClose}
            style={{ background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: "5px 12px", fontSize: 13, cursor: "pointer" }}>
            Close
          </button>
        </div>

        <div className="wp" style={{ padding: "34px 30px" }}>
          <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gridTemplateColumns: cols, gap: 36, alignItems: "start" }}>
            {hasLeft && (
              <aside>
                <div className="w-card">
                  <div className="ey" style={{ marginBottom: 12 }}>Contents</div>
                  <nav className="w-toc">
                    {headers.map((h) => <a key={h.id} href="#">{h.text}</a>)}
                  </nav>
                </div>
              </aside>
            )}

            <article>
              <h1 className="w-title">{title || "Untitled"}</h1>
              {summary && (
                <p style={{ fontSize: 19, lineHeight: 1.6, color: "var(--w-ink-2)", fontStyle: "italic", margin: "0 0 20px" }}>{summary}</p>
              )}
              {tags.length > 0 && (
                <div style={{ marginBottom: 18 }}>{tags.map((t) => <span key={t} className="w-tag">{t}</span>)}</div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
                {bodyBlocks.map((b) => (
                  <div key={b.id} style={{ flexBasis: b.width === "half" ? "calc(50% - 10px)" : "100%", flexGrow: b.width === "half" ? 1 : 0, minWidth: 220 }}>
                    <BlockView b={b} />
                  </div>
                ))}
                {bodyBlocks.length === 0 && <p style={{ color: "var(--w-muted)", fontSize: 15 }}>Nothing in the body yet.</p>}
              </div>
            </article>

            {hasRight && (
              <aside className="panel">
                {panelBlocks.map((b) => (
                  <figure key={b.id} style={{ marginBottom: 14 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={b.url} alt={b.caption} />
                    {b.caption && <figcaption>{b.caption}</figcaption>}
                  </figure>
                ))}
              </aside>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
