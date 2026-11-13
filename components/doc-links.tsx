// components/doc-links.tsx (push 54, 2026-11-12)
//
// A list of the Six Axes documents (lib/docs-files.ts), each with a link that opens the PDF in a new tab
// (it reads on a phone) and one that downloads the Word file (to edit, print or forward). Used by the GM
// Help page and the player Help page.

import React from "react";
import { DOC_FILES, docHref, type DocFile } from "@/lib/docs-files";
import { C } from "@/lib/forge-theme";

export default function DocLinks({ only }: { only?: "players" }) {
  const docs: DocFile[] = only === "players" ? DOC_FILES.filter((d) => d.forPlayers) : DOC_FILES;
  const link: React.CSSProperties = { color: C.sun, fontSize: 13.5, textDecoration: "underline", textUnderlineOffset: 3 };
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {docs.map((d, i) => (
        <li key={d.slug} style={{ padding: "11px 0", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 16px" }}>
            <span style={{ color: C.text, fontSize: 15, fontWeight: 600 }}>{d.title}</span>
            <span style={{ display: "flex", gap: 14 }}>
              <a href={docHref(d.slug, "pdf")} target="_blank" rel="noreferrer" style={link}
                aria-label={`Read ${d.title} (PDF, opens in a new tab)`}>Read (PDF)</a>
              <a href={docHref(d.slug, "docx")} download style={link}
                aria-label={`Download ${d.title} as a Word file`}>Word file</a>
            </span>
          </div>
          <div style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.55, marginTop: 3 }}>{d.blurb}</div>
        </li>
      ))}
    </ul>
  );
}
