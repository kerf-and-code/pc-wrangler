#!/usr/bin/env python3
"""
codemod_sax.py - point the last direct SAX colour references at the shared dungeon palette.

WHY THIS EXISTS AFTER THE OTHER TWO
The palette codemod changed what `C` means, which retoned everything referenced THROUGH C. It could
not touch anything a file writes as SAX directly, and 214 such references survive across 35 files.
More importantly they are not only in app/: components/ was never in scope for the earlier passes,
and components/six-axes-nav.tsx alone holds 31 — which is why the left-hand nav is still the old
purple on every screen even after three green deploys.

WHAT IT MAPS, and what it deliberately leaves
  MAPPED   inkDeep, ink -> C.ink      the darkest surface, what a page sets as text on a brass
                                      button. C.ink is STONE.mortar, which is the same idea.
           muted -> C.muted           SAX.muted is a purple-grey; C.muted is weathered stone.
           line -> C.line
           text -> C.text
           slateBg, panelBg -> C.surface
           plum -> C.plum             the interactive accent, now bright brass
           sun -> C.sun               SAX.sun is a bright yellow well off the dungeon palette
           good -> C.good             the text-safe moss
           warn -> C.warn             the text-safe blood
           brassDim -> C.brassDim

  LEFT     brass                      C.brass IS SAX.brass. Mapping it would be 33 lines of churn
                                      for an identical value, so it stays.
           mono, serif                type, not colour.
           parch, parchInk, parchLine the parchment surface is a deliberate light contrast panel,
                                      not a stone one. Only components/tpdi.jsx uses it and that is
                                      .jsx, outside this glob, but the members are excluded anyway
                                      so a future .tsx parchment panel is safe too.
           spark, ember               one use each, decorative.

SPECIAL CASE. components/upgrade-account.tsx does `import { SAX as C }` — it ALIASES SAX to the name
C rather than declaring a palette, so every earlier codemod skipped it and its `C.*` still resolves
to SAX. Rewriting that single import to pull the real C from forge-theme migrates the whole file
without touching a line of its JSX.

DRY RUN BY DEFAULT.

    python codemod_sax.py
    python codemod_sax.py --apply
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import collections

MAP = {
    "inkDeep": "ink", "ink": "ink",
    "muted": "muted", "line": "line", "text": "text",
    "slateBg": "surface", "panelBg": "surface",
    "plum": "plum", "sun": "sun", "good": "good", "warn": "warn",
    "brassDim": "brassDim",
}
LEAVE = {"brass", "mono", "serif", "parch", "parchInk", "parchLine", "spark", "ember"}

SAX_REF = re.compile(r"\bSAX\.(\w+)\b")
THEME_IMPORT = re.compile(r'^import \{([^}]*)\} from "@/lib/theme";[ \t]*\n', re.M)
FORGE_IMPORT = re.compile(r'^import \{([^}]*)\} from "@/lib/forge-theme";[ \t]*\n', re.M)
ANY_IMPORT = re.compile(r'^import .*?;[ \t]*\n', re.M)
ALIAS_IMPORT = re.compile(r'^import \{\s*SAX as C\s*\} from "@/lib/theme";[ \t]*\n', re.M)
LOCAL_C = re.compile(r"^const C(?::[^=\n]+)? = \{", re.M)


def add_forge_C(src: str) -> str:
    fi = FORGE_IMPORT.search(src)
    if fi:
        members = [x.strip() for x in fi.group(1).split(",") if x.strip()]
        if "C" in members:
            return src
        members.insert(0, "C")
        line = 'import { ' + ", ".join(members) + ' } from "@/lib/forge-theme";\n'
        return src[: fi.start()] + line + src[fi.end():]
    imports = list(ANY_IMPORT.finditer(src))
    if not imports:
        return src
    last = imports[-1]
    return src[: last.end()] + 'import { C } from "@/lib/forge-theme";\n' + src[last.end():]


def migrate(src: str) -> tuple[str | None, int, str]:
    # A file that declares its OWN `const C` must not be touched here, for two reasons that both
    # break the build. Mapping SAX inside that declaration rewrites it to reference itself
    # (`const C = { surface: C.surface }`), and adding the shared import on top collides with the
    # local name ("the name `C` is defined multiple times"). Both happened: codemod_palette only
    # ever walked app/, so components/boundaries-card and components/gm-identity-card still carry
    # local palettes. Run codemod_palette.py --root components on them FIRST, then this.
    if LOCAL_C.search(src):
        return None, 0, "SKIPPED: declares its own const C - run codemod_palette.py --root components first"

    # The alias case: swapping the import alone migrates the whole file.
    if ALIAS_IMPORT.search(src):
        out = ALIAS_IMPORT.sub('import { C } from "@/lib/forge-theme";\n', src, count=1)
        return out, len(SAX_REF.findall(src)) or 1, "aliased SAX as C; repointed the import at the real palette"

    changed = 0

    def sub(m: re.Match) -> str:
        nonlocal changed
        member = m.group(1)
        if member in MAP:
            changed += 1
            return f"C.{MAP[member]}"
        return m.group(0)

    out = SAX_REF.sub(sub, src)
    if changed == 0:
        return None, 0, ""
    out = add_forge_C(out)

    note = f"mapped {changed}"
    # Drop SAX from the theme import if nothing needs it any more.
    if not SAX_REF.search(out):
        ti = THEME_IMPORT.search(out)
        if ti:
            members = [x.strip() for x in ti.group(1).split(",") if x.strip()]
            kept = [x for x in members if x != "SAX"]
            if kept:
                line = 'import { ' + ", ".join(kept) + ' } from "@/lib/theme";\n'
                out = out[: ti.start()] + line + out[ti.end():]
                note += "; dropped SAX from the theme import"
            else:
                out = out[: ti.start()] + out[ti.end():]
                note += "; removed the now-unused theme import"
    return out, changed, note


def main() -> int:
    ap = argparse.ArgumentParser(description="Map direct SAX colour refs onto the shared palette.")
    ap.add_argument("--root", nargs="*", default=["app", "components"])
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    args = ap.parse_args()

    targets = []
    for root in args.root:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            if "node_modules" in dirpath:
                continue
            for fn in files:
                if fn.endswith(".tsx"):
                    targets.append(os.path.join(dirpath, fn))
    targets.sort()

    total = touched = skipped = 0
    left: collections.Counter = collections.Counter()
    print(f"{'FILE':<46}{'MAPPED':>7}  NOTE")
    for path in targets:
        src = open(path, encoding="utf-8").read()
        new, n, note = migrate(src)
        if new is None:
            left.update(m for m in SAX_REF.findall(src))
            if note.startswith("SKIPPED"):
                print(f"{path:<46}{'-':>7}  {note}")
                skipped += 1
            continue
        left.update(m for m in SAX_REF.findall(new))
        print(f"{path:<46}{n:>7}  {note}")
        total += n
        touched += 1
        if args.apply:
            open(path, "w", encoding="utf-8").write(new)

    print()
    print(f"{total} reference(s) mapped across {touched} file(s)"
          f"{', ' + str(skipped) + ' SKIPPED needing codemod_palette first' if skipped else ''}"
          f"{'' if args.apply else ' (dry run)'}.")
    remaining = {k: v for k, v in left.items() if k in LEAVE}
    if remaining:
        print("\nLeft as SAX on purpose:")
        for k, v in sorted(remaining.items(), key=lambda kv: -kv[1]):
            why = ("identical to C.brass" if k == "brass"
                   else "type, not colour" if k in ("mono", "serif")
                   else "parchment surface" if k.startswith("parch")
                   else "decorative, one use")
            print(f"   SAX.{k:<11}{v:>4}   {why}")
    if not args.apply:
        print("\nDry run. Re-run with --apply to write.")
    else:
        print("\nNow run: rmdir /s /q .next && npm run build")
    return 0


if __name__ == "__main__":
    sys.exit(main())
