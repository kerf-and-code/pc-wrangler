// scripts/build-docs/lib.mjs (push 54, 2026-11-12)
//
// Shared builder for the six Six Axes documents (Owner's Manual, GM Onboarding, First Two Sessions,
// Player Guide, both Quick Cards), in the house style of the originals: Liberation Sans, brown headings,
// gold-ruled notes, US Letter. Each document's words live in docs/<name>.mjs; build.mjs runs them all.
import fs from "node:fs";
import JSZip from "jszip";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  BorderStyle, LevelFormat, AlignmentType, Footer, PageNumber,
} from "docx";

// The date in every footer. Change it when the documents are revised.
export const UPDATED = "12 November 2026";

const INK = "2B2620", BROWN = "6E4E26", MUTED = "6B6255", GOLD = "C8A24B", NOTE = "F4EFE4", HEAD = "EDE6D8";

// **bold** and *italic* inline.
function runs(text, size, extra = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), size, color: INK, ...extra }));
    const t = m[0];
    if (t.startsWith("**")) out.push(new TextRun({ text: t.slice(2, -2), bold: true, size, color: INK, ...extra }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true, size, color: INK, ...extra }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), size, color: INK, ...extra }));
  return out;
}

function build(file, items, opts = {}) {
  const compact = !!opts.compact;
  const body = compact ? 20 : 22;
  const line = compact ? 250 : 300;
  const after = compact ? 60 : 140;
  const width = 12240 - 2 * (compact ? 720 : 1440);
  const kids = [];
  for (const it of items) {
    const [k, a, b] = it;
    if (k === "title") kids.push(new Paragraph({ spacing: { before: 0, after: 40 }, children: [new TextRun({ text: a, bold: true, size: compact ? 32 : 40, color: INK })] }));
    else if (k === "sub") kids.push(new Paragraph({ spacing: { before: 0, after: compact ? 130 : 260 }, children: [new TextRun({ text: a, italics: true, size: compact ? 19 : 22, color: MUTED })] }));
    else if (k === "h1") kids.push(new Paragraph({ keepNext: true, spacing: { before: 340, after: 160 }, children: [new TextRun({ text: a, bold: true, size: 34, color: BROWN })] }));
    else if (k === "h2") kids.push(new Paragraph({ keepNext: true, spacing: { before: 240, after: 100 }, children: [new TextRun({ text: a, bold: true, size: 26, color: INK })] }));
    else if (k === "rule") kids.push(new Paragraph({ keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 4, space: 3, color: GOLD } }, spacing: { before: 150, after: 70 }, children: [new TextRun({ text: a.toUpperCase(), bold: true, size: 19, color: BROWN, characterSpacing: 30 })] }));
    else if (k === "p") kids.push(new Paragraph({ spacing: { after, line }, children: runs(a, body) }));
    else if (k === "note") kids.push(new Paragraph({ border: { left: { style: BorderStyle.SINGLE, size: 18, space: 10, color: GOLD } }, shading: { type: ShadingType.CLEAR, fill: NOTE, color: "auto" }, indent: { left: 180, right: 180 }, spacing: { before: compact ? 80 : 160, after: compact ? 100 : 200, line }, children: runs(a, body) }));
    else if (k === "ul" || k === "ol") for (const t of a) kids.push(new Paragraph({ numbering: { reference: k === "ul" ? "bul" : "num" + (it.id || 0), level: 0 }, spacing: { after: compact ? 40 : 80, line }, children: runs(t, body) }));
    else if (k === "table") {
      const widths = a.map((f) => Math.round(f * width));
      widths[widths.length - 1] = width - widths.slice(0, -1).reduce((x, y) => x + y, 0);
      const cell = (t, i, head) => new TableCell({
        width: { size: widths[i], type: WidthType.DXA },
        shading: head ? { type: ShadingType.CLEAR, fill: HEAD, color: "auto" } : undefined,
        margins: compact ? { top: 35, bottom: 35, left: 100, right: 100 } : { top: 70, bottom: 70, left: 110, right: 110 },
        children: [new Paragraph({ spacing: { after: 0, line: compact ? 240 : 270 }, children: runs(t, compact ? 19 : 21, head ? { bold: true } : {}) })],
      });
      kids.push(new Table({
        width: { size: width, type: WidthType.DXA }, columnWidths: widths,
        rows: b.map((r, ri) => new TableRow({ tableHeader: ri === 0 && !it.nohead, cantSplit: true, children: r.map((t, i) => cell(t, i, ri === 0 && !it.nohead)) })),
      }));
      if (it !== items[items.length - 1]) kids.push(new Paragraph({ spacing: { after: compact ? 60 : 120 }, children: [] }));
    } else throw new Error("unknown " + k);
  }
  // A separate numbering instance per ordered list, so each restarts at 1.
  const numIds = [...new Set(items.filter((i) => i[0] === "ol").map((i) => i.id || 0))];
  const doc = new Document({
    creator: "Kerf and Code", title: items[0][1],
    styles: { default: { document: { run: { font: "Liberation Sans", size: body, color: INK } } } },
    numbering: { config: [
      { reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 260 } } } }] },
      ...numIds.map((n) => ({ reference: "num" + n, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 300 } } } }] })),
    ] },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: compact ? { top: 720, bottom: 620, left: 720, right: 720 } : { top: 1300, bottom: 1300, left: 1440, right: 1440 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
        new TextRun({ text: items[0][1] + "   \u00B7   Updated " + UPDATED + "   \u00B7   ", size: 16, color: MUTED }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED }),
      ] })] }) },
      children: kids,
    }],
  });
  // Word has refused a file with folder entries in the zip when it is opened through a cloud
  // co-editing service, and docx writes them, so they are dropped before the file is saved.
  return Packer.toBuffer(doc).then(async (buf) => {
    const src = await JSZip.loadAsync(buf);
    const out = new JSZip();
    for (const f of Object.values(src.files)) {
      if (!f.dir) out.file(f.name, await f.async("nodebuffer"), { createFolders: false });
    }
    fs.writeFileSync(file, await out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  });
}

// Ordered lists need distinct ids to restart numbering.
let olCount = 0;
function ol(list) { const x = ["ol", list]; x.id = ++olCount; return x; }
function tbl(widths, rows, nohead) { const x = ["table", widths, rows]; if (nohead) x.nohead = true; return x; }
export { build, ol, tbl };
