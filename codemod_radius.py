#!/usr/bin/env python3
"""
codemod_radius.py - square off the inline corner radii so panels, cards, buttons and inputs match
the Forge.

WHY
The dungeon language is FORGE_RADIUS = 4, commented "stone chips, it doesn't round". After the
palette migration and the carved surfaces/ui, the loudest remaining mismatch is shape: 209 inline
borderRadius values survive across the app and only three of them are 4. A page can be perfectly
on-palette and still read as a different product because its cards have 12px corners.

WHAT IT CHANGES, and what it deliberately does not
  CHANGED   borderRadius >= 8  ->  FORGE_RADIUS
            These are unambiguous: at that size it is a panel, card, button or input. 8, 9, 10, 11,
            12, 14, 16 and 26 all appear, which is itself the problem — eight different values for
            one idea.

  REPORTED, NOT CHANGED
    borderRadius: 999   Padded text chips, tag pills and segmented toggles. The Forge's own
                        stoneChip uses radius 2, so these arguably want squaring too, but the same
                        value is also how a circular status dot is drawn, and telling those apart
                        from source is guesswork. Listed with context so the call can be made by
                        eye.
    borderRadius: 3-7   Progress tracks, meter fills and small controls, several only 6px tall. At
                        that size the radius is already almost square, and forcing it can make a
                        6px bar look broken rather than carved.

Squaring the clear cases is most of the visual win and none of the risk. The rest is a design
decision, not a refactor, so it is surfaced rather than assumed.

DRY RUN BY DEFAULT.

    python codemod_radius.py                  # report
    python codemod_radius.py --apply
    python codemod_radius.py --apply --root app/me
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import collections

RADIUS = re.compile(r"borderRadius:\s*(\d+)")
FORGE_IMPORT = re.compile(r'^import \{([^}]*)\} from "@/lib/forge-theme";[ \t]*\n', re.M)
ANY_IMPORT = re.compile(r'^import .*?;[ \t]*\n', re.M)

THRESHOLD = 8


def ensure_import(src: str) -> tuple[str, bool]:
    """Make sure FORGE_RADIUS is imported, reusing an existing forge-theme import if there is one."""
    fi = FORGE_IMPORT.search(src)
    if fi:
        members = [x.strip() for x in fi.group(1).split(",") if x.strip()]
        if "FORGE_RADIUS" in members:
            return src, False
        members.append("FORGE_RADIUS")
        line = 'import { ' + ", ".join(members) + ' } from "@/lib/forge-theme";\n'
        return src[: fi.start()] + line + src[fi.end():], True
    imports = list(ANY_IMPORT.finditer(src))
    if not imports:
        return src, False
    last = imports[-1]
    line = 'import { FORGE_RADIUS } from "@/lib/forge-theme";\n'
    return src[: last.end()] + line + src[last.end():], True


def migrate(src: str) -> tuple[str | None, int, collections.Counter]:
    """Return (new_source, changed_count, skipped_counter)."""
    skipped: collections.Counter = collections.Counter()
    changed = 0

    def sub(m: re.Match) -> str:
        nonlocal changed
        v = int(m.group(1))
        if v == 4:
            return m.group(0)          # already the Forge value
        if v >= THRESHOLD and v != 999:
            changed += 1
            return "borderRadius: FORGE_RADIUS"
        skipped[m.group(1)] += 1
        return m.group(0)

    out = RADIUS.sub(sub, src)
    # 999 is written literally, not as a digit run this regex catches differently, but guard anyway.
    skipped.update({"999": len(re.findall(r"borderRadius:\s*999", src))} if False else {})
    if changed == 0:
        return None, 0, skipped
    out, _ = ensure_import(out)
    return out, changed, skipped


def main() -> int:
    ap = argparse.ArgumentParser(description="Square inline corner radii to the Forge value.")
    ap.add_argument("--root", default="app")
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
            if fn.endswith(".tsx"):
                targets.append(os.path.join(dirpath, fn))
    targets.sort()

    total_changed = 0
    all_skipped: collections.Counter = collections.Counter()
    touched = 0
    print(f"{'FILE':<44}{'SQUARED':>8}")
    for path in targets:
        src = open(path, encoding="utf-8").read()
        new, changed, skipped = migrate(src)
        all_skipped.update(skipped)
        if new is None:
            continue
        print(f"{path:<44}{changed:>8}")
        total_changed += changed
        touched += 1
        if args.apply:
            open(path, "w", encoding="utf-8").write(new)

    print()
    print(f"{total_changed} radius value(s) squared to FORGE_RADIUS across {touched} file(s)"
          f"{'' if args.apply else ' (dry run)'}.")
    if all_skipped:
        print("\nLeft alone, for you to rule on:")
        for v, n in sorted(all_skipped.items(), key=lambda kv: -kv[1]):
            what = ("pills, chips and toggles" if v == "999"
                    else "progress tracks and small controls")
            print(f"   borderRadius: {v:<4} {n:>4}   {what}")
    if not args.apply:
        print("\nDry run. Re-run with --apply to write.")
    else:
        print("\nNow run: rmdir /s /q .next && npm run build")
    return 0


if __name__ == "__main__":
    sys.exit(main())
