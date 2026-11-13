// scripts/build-docs/build.mjs (push 54, 2026-11-12)
//
// Builds the six Six Axes documents (Owner's Manual, GM Onboarding, Your First Two Sessions, Player
// Guide, GM Quick Card, Player Quick Card) as Word files into public/docs, then turns each into a PDF
// with LibreOffice. The GM Help page (/gm/help) and the player Help page (/me/help) link both, through
// the list in lib/docs-files.ts.
//
// Run from the repo root:   npm run docs
// That installs this folder's one dependency (docx) into scripts/build-docs/node_modules, which is
// kept out of the app's own package.json and lockfile on purpose, and then runs this file.
//
// PDFs need LibreOffice. It is looked for on the PATH (soffice, libreoffice), in the usual Windows
// and macOS install folders, or wherever the SOFFICE environment variable points. Without it the Word
// files are still rebuilt and the PDFs are left as they were, with a warning that they are now stale.
// --no-pdf skips the PDF step on purpose.
//
// Each document's words live in docs/<file name>.mjs. Change those, run this, and commit both the
// .mjs and the rebuilt files in public/docs.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../public/docs");
const NAMES = [
  "six-axes-owners-manual",
  "six-axes-gm-onboarding",
  "six-axes-first-two-sessions",
  "six-axes-gm-quick-card",
  "six-axes-player-guide",
  "six-axes-player-quick-card",
];

function findSoffice() {
  const candidates = [
    process.env.SOFFICE,
    "soffice",
    "libreoffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ["--version"], { encoding: "utf8", shell: false });
    if (r.status === 0) return c;
  }
  return null;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of NAMES) {
    const mod = await import(pathToFileURL(path.join(here, "docs", `${name}.mjs`)).href);
    await mod.default(outDir);
    console.log(`built public/docs/${name}.docx`);
  }

  if (process.argv.includes("--no-pdf")) {
    console.log("Skipped the PDFs (--no-pdf).");
    return;
  }
  const soffice = findSoffice();
  if (!soffice) {
    console.warn(
      "LibreOffice was not found, so the PDFs in public/docs were NOT rebuilt and no longer match the Word files.\n"
      + "Install LibreOffice, or set SOFFICE to its soffice program, and run npm run docs again.",
    );
    process.exitCode = 1;
    return;
  }
  for (const name of NAMES) {
    const file = path.join(outDir, `${name}.docx`);
    const r = spawnSync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", outDir, file], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error(`PDF failed for ${name}: ${r.stderr || r.stdout}`);
      process.exitCode = 1;
    } else {
      console.log(`built public/docs/${name}.pdf`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
