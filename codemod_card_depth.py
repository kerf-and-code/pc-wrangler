#!/usr/bin/env python3
"""
codemod_card_depth.py - give hand-rolled cards the carved depth the Forge panels have.

WHY THIS IS A CODEMOD AND NOT MORE SHELL CSS
Fields and buttons could be reached from the cascade because they are ELEMENTS: `.sax-shell select`
is a safe, precise selector. A card is a <div> with an inline background, and CSS has no way to say
"the divs that are cards" without an attribute-substring hack that would also hit layout wrappers,
rows and chips. So this edits the style blocks directly.

WHAT IT LOOKS FOR
A style block that sets BOTH a background and a border, and does NOT already set a boxShadow. That
combination is what a hand-rolled card looks like across this app, and the absent shadow is exactly
why those cards read flat next to stonePanel(), which layers five shadows: two bevels, an inner
darkening, a drop, and a mortar ring.

It adds the same shadow stonePanel() uses, minus the outer 3px halo (that one reads as a heavy frame
and suits a full-width panel, not a small row card).

WHAT IT SKIPS, and why each is deliberate
  * The three Forge pages. They already call stonePanel/stoneButton/stoneField and are the reference.
  * Blocks that already set boxShadow. Something chose that on purpose.
  * Blocks with position:absolute or fixed. Those are overlays and tooltips, not cards.
  * Blocks setting a background of "transparent" or "none". A deliberately invisible container.

DRY RUN BY DEFAULT.

    python codemod_card_depth.py
    python codemod_card_depth.py --apply
    python codemod_card_depth.py --apply --root app/me
"""

from __future__ import annotations

import argparse
import os
import re
import sys

VERSION = "3 (brace-matched, cards only)"

# stonePanel()'s shadow without the outer halo. Written as one string so the inserted line stays
# readable in the page source rather than sprawling.
SHADOW = (
    'boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), '
    'inset -1px -1px 0 rgba(0,0,0,0.55), '
    'inset 0 0 34px rgba(0,0,0,0.30), '
    '0 4px 12px rgba(0,0,0,0.5)"'
)

SKIP_DIRS = ("me/forge", "gm/statblock", "me/library")
# A regex cannot find the end of a style block that contains nested braces - template literals,
# ternaries, spreads - and those are the MAJORITY here: 104 of 132 candidates. Match braces properly.
STYLE_OPEN = re.compile(r"style=\{\{")


def style_blocks(src: str):
    """Yield (start, end, body) for every style={{...}}, brace-matched."""
    for m in STYLE_OPEN.finditer(src):
        i = m.end()
        # style={{ opens TWO braces, so the scan starts at depth 2 and the body ends two back.
        depth, j = 2, i
        while j < len(src) and depth > 0:
            if src[j] == "{":
                depth += 1
            elif src[j] == "}":
                depth -= 1
            j += 1
        if depth == 0:
            yield m.start(), j, src[i:j - 2]


def is_card(body: str, preceding: str) -> bool:
    # Buttons and anchors already get their depth from the shell CSS, and a PANEL shadow on a button
    # reads wrong: a button should look pushed out, a card pressed in. The first version of this
    # matched them because `border: "none"` satisfied a naive "has a border" test.
    lt = preceding.rfind("<")
    if lt != -1 and ">" not in preceding[lt:]:
        name = re.match(r"<(\w+)", preceding[lt:])
        if name and name.group(1).lower() in ("button", "a"):
            return False
    if re.search(r"border\s*:\s*[\"\']none[\"\']", body):
        return False
    if "boxShadow" in body:
        return False
    if not re.search(r"\bbackground\s*:", body):
        return False
    if not re.search(r"\bborder\s*:", body):
        return False
    if re.search(r"position\s*:\s*[\"'](absolute|fixed)[\"']", body):
        return False
    if re.search(r"background\s*:\s*[\"'](transparent|none)[\"']", body):
        return False
    return True


def migrate(src: str) -> tuple[str | None, int]:
    edits = []
    for start, end, body in style_blocks(src):
        if not is_card(body, src[max(0, start - 4000):start]):
            continue
        trimmed = body.rstrip()
        sep = "" if trimmed.endswith(",") else ","
        edits.append((start, end, "style={{" + trimmed + sep + " " + SHADOW + " }}"))
    if not edits:
        return None, 0
    # Apply back to front so earlier offsets stay valid.
    out = src
    for start, end, text in reversed(edits):
        out = out[:start] + text + out[end:]
    return out, len(edits)


def main() -> int:
    ap = argparse.ArgumentParser(description="Add carved depth to hand-rolled cards.")
    ap.add_argument("--root", nargs="*", default=["app", "components"])
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    args = ap.parse_args()

    print(f"codemod_card_depth version {VERSION}")

    targets = []
    for root in args.root:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            if "node_modules" in dirpath:
                continue
            if any(sd in dirpath.replace("\\", "/") for sd in SKIP_DIRS):
                continue
            for fn in files:
                if fn.endswith(".tsx"):
                    targets.append(os.path.join(dirpath, fn))
    targets.sort()

    total = touched = 0
    print(f"{'FILE':<48}{'CARDS':>6}")
    for path in targets:
        src = open(path, encoding="utf-8").read()
        new, n = migrate(src)
        if new is None:
            continue
        print(f"{path:<48}{n:>6}")
        total += n
        touched += 1
        if args.apply:
            open(path, "w", encoding="utf-8").write(new)

    print()
    print(f"{total} card(s) given depth across {touched} file(s)"
          f"{'' if args.apply else ' (dry run)'}.")
    if not args.apply:
        print("Dry run. Re-run with --apply to write.")
    else:
        print("Now run: rmdir /s /q .next && npm run build")
    return 0


if __name__ == "__main__":
    sys.exit(main())
