#!/usr/bin/env python3
"""
codemod_hex.py - retire hardcoded hex colours in favour of the shared palette.

WHY A FOURTH CODEMOD
  The first three migrated files that were already wired to the theme: they looked for a local
  `const C = {...}` to delete or a `SAX.` reference to rewrite. Files that never used either were
  invisible to all of them, and those are exactly the ones still rendering purple - the capture
  cards, the extension onboarding page, the join and claim flows. Nothing to grab means nothing
  migrated, and no report said so.

THREE BLIND SPOTS THIS ALSO CLOSES
  .jsx        every earlier codemod globbed *.tsx. components/tpdi.jsx was never considered.
  aliasing    components/upgrade-account.tsx does `import { SAX as C }`, which renames the OLD
              palette to the NEW one's name. Grepping for SAX. missed it and grepping for a local
              const C missed it, while the whole file rendered in SAX colours.
  case        the same colour appears as #A597BD and #a597bd across the repo.

WHAT IT WILL NOT TOUCH
  THE SIX AXIS COLOURS. They are DATA ENCODING - the same hue means the same axis on every chart -
  so they are excluded by value. A hue test alone would happily map #C8A24B (Tactics) onto C.brass
  and quietly break every legend in the app.
  BRAND COLOURS. #5865F2 is Discord's, and the Google button's four are Google's.

DRY RUN BY DEFAULT. --apply to write. Commit first: the whole migration is then one git diff and
`git checkout` is the undo.
"""
import argparse, os, re, sys

AXIS = {"#b7615a", "#c8a24b", "#4e8077", "#ce8a42", "#6c76b0", "#9a93b0"}
BRAND = {"#5865f2", "#4285f4", "#34a853", "#fbbc05", "#ea4335", "#1f1f1f", "#3ecf8e"}

# Mapped by ROLE, read from how each colour was used, not by hue. Two that are easy to get wrong:
# a "text on brass" dark maps to C.ink (NOT STONE.ink, which is pale parchment text), and a success
# SURFACE cannot use C.good, which is a text weight and far too bright to fill with.
TOKEN = {
    "#140f1f": "C.bg", "#0f0b16": "C.bg", "#1b1426": "C.bg", "#16121f": "C.bg", "#0b0710": "C.bg",
    "#1e1730": "C.panel", "#221c31": "C.panel", "#251b33": "C.panel", "#2a2438": "C.panel",
    "#1a1428": "C.panel", "#221e18": "C.panel",
    "#241b33": "C.surface2", "#191324": "C.surface2",
    "#1a1526": "C.field", "#14110c": "C.ink", "#1a1626": "C.ink",
    "#3a2f52": "C.line", "#37304a": "C.line", "#3d2f52": "C.line", "#6e6385": "C.line",
    "#2e2742": "C.line", "#332b49": "C.line", "#4a4237": "C.line",
    "#a597bd": "C.muted", "#776d90": "C.muted", "#9a8fb0": "C.muted", "#b7aed1": "C.muted",
    "#a99e86": "C.muted",
    "#efe9f7": "C.text", "#e8e2f0": "C.text", "#f4eefa": "C.text", "#ded6ea": "C.text",
    "#e8dcc4": "C.text",
    "#c9a6ff": "C.sun", "#9b7bd4": "C.sun", "#b98cff": "C.sun", "#e0c76a": "C.sun",
    "#e2b878": "C.sun", "#f4c430": "C.brass", "#ffd75e": "C.sunSoft",
    "#9fe0ae": "C.good", "#5dbe9a": "C.good", "#8fbf8f": "C.good", "#9aa880": "C.good",
    "#e0a2b8": "C.warn", "#e07a5f": "C.warn", "#e7b7b0": "C.warn",
}
# Fills rather than text: these become a wash so they read as a surface.
SURFACE = {
    "#173026": "rgba(122,138,94,0.22)", "#1d3324": "rgba(122,138,94,0.22)",
    "#12210f": "rgba(122,138,94,0.22)", "#3a2230": "rgba(140,74,74,0.20)",
    "#1a1206": "rgba(0,0,0,0.34)", "#5a3348": "rgba(140,74,74,0.40)",
}

IMPORT = 'import { C, FORGE_RADIUS } from "@/lib/forge-theme";'


def migrate(text):
    notes = []
    s = text

    # An aliased import renames the old palette to the new one's name. Undo that first or every
    # C.* below silently keeps resolving to SAX.
    if 'import { SAX as C }' in s:
        s = s.replace('import { SAX as C } from "@/lib/theme";',
                      'import { SAX } from "@/lib/theme";\n' + IMPORT)
        s = re.sub(r'\bC\.(mono|serif)\b', r'SAX.\1', s)
        s = s.replace("C.slateBg", "C.surface").replace("C.panelBg", "C.panel")
        notes.append("un-aliased SAX-as-C")

    for hexv, repl in SURFACE.items():
        if re.search(re.escape(hexv), s, re.I):
            s = re.sub(re.escape(hexv), repl, s, flags=re.I)
            notes.append(f"{hexv} -> wash")

    for hexv, token in TOKEN.items():
        if not re.search(re.escape(hexv), s, re.I):
            continue
        s = re.sub(r'"' + re.escape(hexv) + r'"', token, s, flags=re.I)
        s = re.sub(r"'" + re.escape(hexv) + r"'", token, s, flags=re.I)
        # Anything left is inside a template literal and needs interpolation.
        s = re.sub(re.escape(hexv), "${" + token + "}", s, flags=re.I)
        notes.append(f"{hexv} -> {token}")

    if re.search(r'\bC\.\w+', s) and "forge-theme" not in s:
        m = re.search(r'^import .*?\n(?!import)', s, re.M)
        if m:
            s = s[:m.end()] + IMPORT + "\n" + s[m.end():]
            notes.append("added palette import")

    # A local const C now shadows the import and every key it defined resolves from the shared one.
    if "forge-theme" in s:
        m = re.search(r'^const C = \{.*?^\};\n\n?', s, re.S | re.M)
        if m:
            s = s[:m.start()] + s[m.end():]
            notes.append("removed shadowing const C")

    n = len(re.findall(r'borderRadius: (?:6|8|10|12|14|16)\b', s))
    if n:
        s = re.sub(r'borderRadius: (?:6|8|10|12|14|16)\b', 'borderRadius: FORGE_RADIUS', s)
        notes.append(f"{n} radii -> FORGE_RADIUS")

    return s, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="limit to a subtree, e.g. --root components")
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    a = ap.parse_args()

    changed = skipped = 0
    for root, _, files in os.walk(a.root):
        if "node_modules" in root or "/.next" in root:
            continue
        for f in files:
            if not f.endswith((".tsx", ".jsx")):   # .jsx included on purpose - see the header
                continue
            p = os.path.join(root, f)
            text = open(p, encoding="utf-8", errors="ignore").read()
            new, notes = migrate(text)
            if new == text:
                continue
            left = sorted({h.lower() for h in re.findall(r'#[0-9a-fA-F]{6}\b', new)}
                          - AXIS - BRAND)
            changed += 1
            print(f"  {p}")
            for n in notes:
                print(f"      {n}")
            if left:
                skipped += 1
                print(f"      LEFT ALONE, no role known: {left}")
            if a.apply:
                open(p, "w", encoding="utf-8").write(new)

    print()
    print(f"  {changed} file(s) {'written' if a.apply else 'would change'}"
          f"{f', {skipped} with colours I could not place' if skipped else ''}")
    if not a.apply:
        print("  dry run. commit, then rerun with --apply")


if __name__ == "__main__":
    main()
