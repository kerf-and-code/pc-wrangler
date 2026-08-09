#!/usr/bin/env python3
"""
fix_missing_palette_import.py - add the palette import to any file that uses C.* without it.

WHY THIS EXISTS SEPARATELY
  codemod_hex.py's first version anchored its import on "the first import not followed by another
  import", wrote `if m:` with no else, and reported success when the anchor did not match. Files
  came out full of C.* references and no import. This finds every file in that state and repairs
  it, without depending on which version of the codemod is on disk.

  It only ADDS an import. It touches no colours, so running it on an already-correct repo is a
  no-op and running it twice is safe.
"""
import os, re, sys

IMPORT = 'import { C, FORGE_RADIUS } from "@/lib/forge-theme";'

# Every symbol a file might use FROM forge-theme, with how to tell it is being used.
#
# Checking one symbol at a time is what made this take four attempts: I fixed C, and the next build
# failed on FORGE_RADIUS written by the same codemod into the same files. The set is the unit, not
# the symbol.
SYMBOLS = {
    "C": r'\bC\.\w+',
    "FORGE_RADIUS": r'\bFORGE_RADIUS\b',
    "STONE": r'\bSTONE\.\w+',
    "stonePanel": r'\bstonePanel\s*\(',
    "stoneButton": r'\bstoneButton\s*\(',
    "stoneField": r'\bstoneField\s*\(',
    "stoneChip": r'\bstoneChip\s*\(',
    "FORGE_FONTS": r'\bFORGE_FONTS\.',
}


def imported_from_theme(s):
    """The names this file already pulls in from forge-theme."""
    out = set()
    for m in re.finditer(r'import\s*\{([^}]*)\}\s*from\s*["\']@/lib/forge-theme["\']', s):
        for n in m.group(1).split(","):
            n = n.strip().split(" as ")[0].strip()
            if n:
                out.add(n)
    return out


def missing_symbols(s):
    have = imported_from_theme(s)
    out = []
    for name, pat in SYMBOLS.items():
        if name in have or not re.search(pat, s):
            continue
        # A file declaring its own is not missing an import, it is shadowing one.
        if re.search(r'^\s*(const|let|function)\s+' + re.escape(name) + r'\b', s, re.M):
            continue
        if name == "C" and re.search(r'import \{[^}]*\bSAX as C\b', s):
            continue
        out.append(name)
    return out


def apply_import(s, names):
    """Widen an existing forge-theme import, or add one after the last import."""
    m = re.search(r'(import\s*\{)([^}]*)(\}\s*from\s*["\']@/lib/forge-theme["\'];?)', s)
    if m:
        return s[:m.start()] + m.group(1) + " " + ", ".join(names) + "," + m.group(2) + m.group(3) + s[m.end():]
    line = "import { " + ", ".join(names) + ' } from "@/lib/forge-theme";'
    imports = list(re.finditer(r'^import[^\n]*(?:\n(?![\S])[^\n]*)*\n', s, re.M))
    if imports:
        at = imports[-1].end()
    else:
        uc = re.search(r'^["\']use client["\'];\n', s, re.M)
        at = uc.end() if uc else 0
    return s[:at] + line + "\n" + s[at:]


apply = "--apply" in sys.argv
hits = 0
for root, _, files in os.walk("."):
    if "node_modules" in root or ".next" in root or ".git" in root:
        continue
    for f in files:
        if not f.endswith((".tsx", ".jsx")):
            continue
        p = os.path.join(root, f)
        s = open(p, encoding="utf-8", errors="ignore").read()
        need = missing_symbols(s)
        if not need:
            continue
        hits += 1
        how = "widened" if "forge-theme" in s else "added"
        print(f"  {p}")
        print(f"      {how} the forge-theme import for: {', '.join(need)}")
        if apply:
            open(p, "w", encoding="utf-8").write(apply_import(s, need))

print()
print(f"  {hits} file(s) {'fixed' if apply else 'need the import'}")
if hits and not apply:
    print("  rerun with --apply")
