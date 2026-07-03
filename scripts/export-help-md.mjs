// Regenerate docs/six-axes-guide.md from lib/help-content.mjs.
// Run from the repo root: node scripts/export-help-md.mjs

import { HELP } from "../lib/help-content.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

let md = `# ${HELP.title}\n\n${HELP.subtitle}\n`;
for (const s of HELP.sections) {
  md += `\n## ${s.title}\n`;
  for (const b of s.blocks) {
    if (b.kind === "p") md += `\n${b.text}\n`;
    else if (b.kind === "sub") md += `\n**${b.title}.** ${b.text}\n`;
    else if (b.kind === "steps") {
      md += "\n";
      b.items.forEach((item, i) => { md += `${i + 1}. ${item}\n`; });
    }
  }
}
md += `\n---\n\nGenerated from the in-app guide. Edit lib/help-content.mjs and re-run this script.\n`;

mkdirSync("docs", { recursive: true });
writeFileSync("docs/six-axes-guide.md", md);
console.log("Wrote docs/six-axes-guide.md (" + md.length + " chars)");
