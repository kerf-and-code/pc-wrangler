#!/usr/bin/env python3
"""
codemod_palette.py - migrate every page from its own local `const C` palette to the shared
dungeon palette exported by lib/forge-theme.

WHY A CODEMOD
34 pages each declare their own `const C = { ... }` built from SAX and then reference it ~1,100
times. Those references are indirection that already exists, so changing what C MEANS retones every
page at once without touching a line of JSX. What has to change per file is only three lines: drop
the local declaration, add an import, and tidy the SAX import if nothing else in the file still uses
it. That is mechanical and identical everywhere, which is exactly the kind of edit a human should
not do 34 times by hand.

WHAT IT DOES, per file
  1. Removes the module-scope `const C = { ... };` (or `const C: Type = { ... };`).
  2. Adds `import { C } from "@/lib/forge-theme";`, merging into an existing forge-theme import
     if the file already has one.
  3. Counts remaining `SAX.` uses. If none are left, removes SAX from the "@/lib/theme" import,
     and drops the import line entirely if SAX was the only thing it brought in. Leaving an unused
     import behind fails the lint step of `next build`, so this is not cosmetic.

WHAT IT REFUSES TO DO
  * Touch a file with no module-scope `const C` (indented, in-component declarations are reported
    and skipped, never guessed at).
  * Touch a file with more than one `const C`.
  * Touch a file that has already been migrated.
Anything it refuses is printed, so the skipped set is visible rather than silent.

DRY RUN BY DEFAULT. Nothing is written without --apply.

    python codemod_palette.py                 # report what would change
    python codemod_palette.py --apply         # do it
    python codemod_palette.py --apply --root app/me   # narrow the blast radius
"""

from __future__ import annotations

import argparse
import os
import re
import sys

C_DECL = re.compile(r"^const C(?::[^=\n]+)? = \{.*?\n?\};[ \t]*\n", re.S | re.M)
C_DECL_INDENTED = re.compile(r"^[ \t]+const C\b", re.M)
THEME_IMPORT = re.compile(r'^import \{([^}]*)\} from "@/lib/theme";[ \t]*\n', re.M)
FORGE_IMPORT = re.compile(r'^import \{([^}]*)\} from "@/lib/forge-theme";[ \t]*\n', re.M)
ANY_IMPORT = re.compile(r'^import .*?;[ \t]*\n', re.M)

FORGE_LINE = 'import { C } from "@/lib/forge-theme";\n'


def migrate(src: str) -> tuple[str | None, str]:
    """Return (new_source, note). new_source is None when the file is skipped."""
    if FORGE_IMPORT.search(src) and re.search(r"\bC\b\s*[,}]", FORGE_IMPORT.search(src).group(1)):
        return None, "already migrated"

    decls = C_DECL.findall(src)
    if len(decls) > 1:
        return None, "SKIPPED: more than one module-scope const C"
    if not decls:
        if C_DECL_INDENTED.search(src):
            return None, "SKIPPED: const C is declared inside a component, not at module scope"
        return None, "no local const C"

    m = C_DECL.search(src)
    out = src[: m.start()] + src[m.end():]
    # The declaration usually sits between blank lines; collapse the pair it leaves behind.
    out = re.sub(r"\n\n\n+", "\n\n", out, count=1)

    notes = ["removed local const C"]

    # Add (or extend) the forge-theme import.
    fi = FORGE_IMPORT.search(out)
    if fi:
        members = [x.strip() for x in fi.group(1).split(",") if x.strip()]
        if "C" not in members:
            members.insert(0, "C")
        line = 'import { ' + ", ".join(members) + ' } from "@/lib/forge-theme";\n'
        out = out[: fi.start()] + line + out[fi.end():]
        notes.append("extended existing forge-theme import")
    else:
        imports = list(ANY_IMPORT.finditer(out))
        if not imports:
            return None, "SKIPPED: no import block to anchor to"
        last = imports[-1]
        out = out[: last.end()] + FORGE_LINE + out[last.end():]
        notes.append("added forge-theme import")

    # Tidy SAX if the file no longer uses it.
    remaining = len(re.findall(r"\bSAX\.", out))
    if remaining == 0:
        ti = THEME_IMPORT.search(out)
        if ti:
            members = [x.strip() for x in ti.group(1).split(",") if x.strip()]
            kept = [x for x in members if x != "SAX"]
            if kept:
                line = 'import { ' + ", ".join(kept) + ' } from "@/lib/theme";\n'
                out = out[: ti.start()] + line + out[ti.end():]
                notes.append("dropped SAX from the theme import")
            else:
                out = out[: ti.start()] + out[ti.end():]
                notes.append("removed the now-unused theme import")
    else:
        notes.append(f"kept SAX ({remaining} uses remain)")

    return out, "; ".join(notes)


def main() -> int:
    ap = argparse.ArgumentParser(description="Migrate pages to the shared dungeon palette.")
    ap.add_argument("--root", default="app", help="directory to walk (default: app)")
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    args = ap.parse_args()

    if not os.path.isdir(args.root):
        print(f"No such directory: {args.root}")
        return 1

    targets = []
    for dirpath, _dirs, files in os.walk(args.root):
        if "node_modules" in dirpath:
            continue
        for fn in files:
            if fn.endswith((".tsx", ".ts")):
                targets.append(os.path.join(dirpath, fn))
    targets.sort()

    changed = skipped = untouched = 0
    print(f"{'FILE':<44}{'ACTION'}")
    for path in targets:
        src = open(path, encoding="utf-8").read()
        new, note = migrate(src)
        if new is None:
            if note.startswith("SKIPPED") or note == "already migrated":
                if note != "no local const C":
                    print(f"{path:<44}{note}")
                    skipped += 1
            else:
                untouched += 1
            continue
        print(f"{path:<44}{note}")
        changed += 1
        if args.apply:
            open(path, "w", encoding="utf-8").write(new)

    print()
    print(f"{changed} file(s) {'migrated' if args.apply else 'would be migrated'}, "
          f"{skipped} skipped needing a look, {untouched} had no local palette.")
    if not args.apply:
        print("Dry run. Re-run with --apply to write.")
    else:
        print("Now run: rmdir /s /q .next && npm run build")
    return 0


if __name__ == "__main__":
    sys.exit(main())
