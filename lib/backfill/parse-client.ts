// lib/backfill/parse-client.ts
//
// Browser-side decoding for the upload page. Turns whatever the GM drops, an Obsidian vault .zip, a
// World Anvil export .zip/.json, a .docx, a .pdf, loose .md/.txt, into the UploadedFile[] the ingest
// layer already understands, then runs ingest() so only normalized TEXT is posted to the server. The
// raw files never leave the browser.
//
// The heavy decoders (jszip / mammoth / pdfjs-dist) are dynamically imported so they land only in the
// client bundle for this page, and never in the server or the rest of the app.
//
// Deps (client): jszip, mammoth, pdfjs-dist.

import { ingest, type IngestOptions } from "./ingest";
import type { NormalizedImport, UploadedFile } from "./types";

const TEXT_EXT = /\.(md|markdown|txt|json|html?|csv)$/i;
const SKIP_IN_ZIP = /(^|\/)\.(obsidian|git|trash)\//i; // Obsidian config, git, trash folders

// A File-like the page passes in (the DOM File works directly).
export type InputFile = { name: string; type?: string; arrayBuffer: () => Promise<ArrayBuffer>; text: () => Promise<string> };

export type ParseResult = { files: UploadedFile[]; warnings: string[] };

// Decode one dropped file into zero or more UploadedFiles.
async function decodeOne(file: InputFile): Promise<{ files: UploadedFile[]; warnings: string[] }> {
  const name = file.name;
  const lower = name.toLowerCase();
  const warnings: string[] = [];

  if (lower.endsWith(".zip")) {
    return decodeZip(file);
  }
  if (lower.endsWith(".docx")) {
    try { return { files: [{ name: name.replace(/\.docx$/i, ".txt"), text: await decodeDocx(await file.arrayBuffer()) }], warnings }; }
    catch (e) { return { files: [], warnings: [`Could not read ${name}: ${errMsg(e)}`] }; }
  }
  if (lower.endsWith(".pdf")) {
    try { return { files: [{ name: name.replace(/\.pdf$/i, ".txt"), text: await decodePdf(await file.arrayBuffer()) }], warnings }; }
    catch (e) { return { files: [], warnings: [`Could not read ${name}: ${errMsg(e)}`] }; }
  }
  if (TEXT_EXT.test(lower)) {
    return { files: [{ name, text: await file.text() }], warnings };
  }
  return { files: [], warnings: [`Skipped ${name}: unsupported type.`] };
}

// Unpack a zip, keeping only readable text members (an Obsidian vault is markdown; a World Anvil export
// is JSON + HTML). Binary members inside a zip (images) are ignored.
async function decodeZip(file: InputFile): Promise<{ files: UploadedFile[]; warnings: string[] }> {
  const warnings: string[] = [];
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const out: UploadedFile[] = [];
  const entries = Object.values(zip.files) as { dir: boolean; name: string; async: (t: "string") => Promise<string> }[];
  for (const entry of entries) {
    if (entry.dir) continue;
    if (SKIP_IN_ZIP.test(entry.name)) continue;
    if (!TEXT_EXT.test(entry.name)) continue;
    try { out.push({ name: entry.name, text: await entry.async("string") }); }
    catch { warnings.push(`Could not read ${entry.name} from the archive.`); }
  }
  if (out.length === 0) warnings.push("The archive had no readable notes (markdown / JSON / text).");
  return { files: out, warnings };
}

async function decodeDocx(buf: ArrayBuffer): Promise<string> {
  // mammoth ships a browser build; import it dynamically and read raw text.
  const mod = (await import("mammoth")) as unknown as { extractRawText: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> };
  const res = await mod.extractRawText({ arrayBuffer: buf });
  return res.value || "";
}

async function decodePdf(buf: ArrayBuffer): Promise<string> {
  // pdfjs needs a worker. We point it at the module worker; if a build setup rejects import.meta.url,
  // set GlobalWorkerOptions.workerSrc to your hosted copy of pdf.worker.min.mjs instead.
  const pdfjs = (await import("pdfjs-dist")) as unknown as {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument: (s: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> };
  };
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  } catch { /* leave whatever the bundler configured */ }
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    parts.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return parts.join("\n\n");
}

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = { getTextContent: () => Promise<{ items: ({ str: string } | Record<string, unknown>)[] }> };

function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

// Decode every dropped file, then normalize with the ingest layer. This is what the upload page calls.
export async function parseAndIngest(inputs: InputFile[], opts: IngestOptions = {}): Promise<NormalizedImport & { decodeWarnings: string[] }> {
  const files: UploadedFile[] = [];
  const warnings: string[] = [];
  for (const f of inputs) {
    const r = await decodeOne(f);
    files.push(...r.files);
    warnings.push(...r.warnings);
  }
  const norm = ingest(files, opts);
  return { ...norm, decodeWarnings: warnings };
}

// Pasted text is the simplest path: one synthetic file, straight into ingest.
export function parsePasted(text: string, opts: IngestOptions = {}): NormalizedImport {
  return ingest([{ name: "pasted-notes.txt", text }], opts);
}
