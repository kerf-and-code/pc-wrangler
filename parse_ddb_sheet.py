#!/usr/bin/env python3
"""
parse_ddb_sheet.py - Parse a D&D Beyond character-sheet PDF export into the Six Axes build shape.

COORDINATE-BASED. D&D Beyond exports every character with the SAME fixed template (PDFsharp), so we
parse by anchoring on constant field LABELS and reading each value by its SPATIAL relationship to its
label (the number inside the AC box, the modifier left of PROFICIENCY BONUS, etc.). Word coordinates
come from `pdftotext -bbox`, whose x/y model matches what pdf.js page.getTextContent() gives in the
browser - so this logic ports to in-app upload with minimal change.

Nothing is lossy: the full parse (including multiclass) is preserved so later parity passes can
promote parked data. Optional sections (spells for non-casters, maneuvers) degrade to empty rather
than erroring.

Requires Poppler's pdftotext + pdfinfo on PATH.

Usage:
    python parse_ddb_sheet.py <sheet.pdf>
    python parse_ddb_sheet.py <sheet.pdf> --out x.json
"""

from __future__ import annotations
import html as html_lib
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class Word:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


@dataclass
class Page:
    words: List[Word] = field(default_factory=list)

    def find(self, text: str, exact: bool = True, ci: bool = False) -> List[Word]:
        """Case-SENSITIVE by default. D&D Beyond uses casing to separate a field LABEL from the same
        word in body prose (the 'SPEED' box label vs 'speed' in a feature description, 'SAVING
        THROWS' vs 'a saving throw'). Case-folding here made label resolution depend on pdftotext
        emission order, which silently picked the wrong occurrence on some sheets and not others.
        Pass ci=True only where a case-fold match is genuinely wanted."""
        if ci:
            t = text.lower()
            if exact:
                return [w for w in self.words if w.text.lower() == t]
            return [w for w in self.words if t in w.text.lower()]
        if exact:
            return [w for w in self.words if w.text == text]
        return [w for w in self.words if text in w.text]

    def first(self, text: str, exact: bool = True, ci: bool = False) -> Optional[Word]:
        hits = self.find(text, exact, ci)
        return hits[0] if hits else None

    def in_column_above(self, text: str, anchor: Optional[Word], x_tol: float = 45,
                        max_dy: float = 200) -> Optional[Word]:
        """The case-exact occurrence of `text` sitting in `anchor`'s x-column and above it, nearest
        first. Binds a row label to its OWN box, so an identical word elsewhere on the page (body
        prose, another box's header) cannot win on emission order. `anchor` is that box's footer
        label, e.g. SAVING for the saving-throw rows or SKILLS for the skill rows."""
        if anchor is None:
            return self.first(text)
        best, bestd = None, 1e9
        for w in self.words:
            if w.text != text or abs(w.x0 - anchor.x0) > x_tol:
                continue
            d = anchor.y0 - w.y0
            if 0 < d < max_dy and d < bestd:
                best, bestd = w, d
        return best

    def first_followed_by(self, text: str, nxt: str, max_gap: float = 40,
                          y_tol: float = 4) -> Optional[Word]:
        """The occurrence of `text` whose immediate right-hand neighbour on the same line is `nxt`.
        Disambiguates a token that repeats in identical casing: page 1 carries THREE 'HIT' tokens
        (HIT POINTS, HIT DICE, and the attacks-table column header), so casing cannot separate them
        but the following word can."""
        for w in self.words:
            if w.text != text:
                continue
            for u in self.words:
                if u.text == nxt and abs(u.y0 - w.y0) < y_tol and 0 <= u.x0 - w.x1 < max_gap:
                    return w
        return None

    def in_region(self, x0: float, y0: float, x1: float, y1: float) -> List[Word]:
        got = [w for w in self.words if x0 <= w.cx <= x1 and y0 <= w.cy <= y1]
        return sorted(got, key=lambda w: (round(w.cy / 3), w.cx))

    def value_above(self, label: Optional[Word], max_dy: float = 30, x_tol: float = 45) -> Optional[Word]:
        if not label:
            return None
        best, bestd = None, 1e9
        for w in self.words:
            if w.y1 <= label.y0 and abs(w.cx - label.cx) < x_tol:
                d = label.y0 - w.y1
                if d < bestd and d < max_dy:
                    best, bestd = w, d
        return best

    def value_left(self, label: Optional[Word], max_dx: float = 90, y_tol: float = 12) -> Optional[Word]:
        if not label:
            return None
        best, bestd = None, 1e9
        for w in self.words:
            if w.x1 <= label.x0 and abs(w.cy - label.cy) < y_tol:
                d = label.x0 - w.x1
                if d < bestd and d < max_dx:
                    best, bestd = w, d
        return best

    def lines(self, y_bucket: float = 3.0) -> List[str]:
        by_y: Dict[int, List[Word]] = {}
        for w in self.words:
            by_y.setdefault(round(w.cy / y_bucket), []).append(w)
        return [" ".join(x.text for x in sorted(ws, key=lambda w: w.x0)) for _, ws in sorted(by_y.items())]


def load_pages(pdf_path: str) -> List[Page]:
    info = subprocess.run(["pdfinfo", pdf_path], capture_output=True, text=True)
    n = 1
    for line in info.stdout.splitlines():
        if line.startswith("Pages:"):
            n = int(line.split(":")[1].strip())
            break
    pages: List[Page] = []
    for p in range(1, n + 1):
        out = subprocess.run(
            ["pdftotext", "-bbox", "-f", str(p), "-l", str(p), pdf_path, "-"],
            capture_output=True, text=True,
        ).stdout
        words: List[Word] = []
        for m in re.finditer(
            r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>',
            out,
        ):
            words.append(Word(html_lib.unescape(m[5]), float(m[1]), float(m[2]), float(m[3]), float(m[4])))
        pages.append(Page(words))
    return pages


ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"]
ABBR = {a: a[:3].lower() for a in ABILITIES}
SKILL_NAMES = [
    "Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception", "History",
    "Insight", "Intimidation", "Investigation", "Medicine", "Nature", "Perception",
    "Performance", "Persuasion", "Religion", "Sleight of Hand", "Stealth", "Survival",
]


def _int(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    m = re.search(r"-?\d+", s)
    return int(m.group()) if m else None


def _signed(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    s = s.strip()
    return int(s) if re.fullmatch(r"[+-]?\d+", s) else None


def _wt(w: Optional[Word]) -> Optional[str]:
    return w.text if w else None


def _row_above(p: Page, label: Optional[Word], dy: float = 11, band: float = 7,
               xlo: float = -30, xhi: float = 120) -> Optional[str]:
    if not label:
        return None
    row = [w for w in p.words if abs(w.cy - (label.cy - dy)) < band
           and w.x0 >= label.x0 + xlo and w.x0 <= label.x1 + xhi]
    return " ".join(w.text for w in sorted(row, key=lambda w: w.x0)).strip() or None


def parse_identity(p: Page) -> Dict[str, Any]:
    name = None
    nlbl = p.first("CHARACTER", exact=False)
    if nlbl:
        # Name is the line above the CHARACTER NAME label, left-aligned near it.
        row = [w for w in p.words if nlbl.cy - 35 < w.cy < nlbl.cy - 8 and w.x0 < nlbl.x1 + 60]
        name = " ".join(w.text for w in sorted(row, key=lambda w: w.x0)).strip() or None

    class_level = None
    cll = p.first("LEVEL")
    if cll:
        maybe = _row_above(p, cll, xlo=-60, xhi=90)
        if maybe and re.search(r"\d", maybe):
            class_level = maybe

    # Each identity field sits in its own x-column; match the value row within a NARROW window around
    # the label's x so adjacent columns don't bleed in.
    def col_value(label_text: str, width: float = 55) -> Optional[str]:
        lbl = p.first(label_text)
        if not lbl:
            return None
        row = [w for w in p.words if abs(w.cy - (lbl.cy - 11)) < 7 and lbl.x0 - 8 <= w.x0 <= lbl.x0 + width]
        return " ".join(w.text for w in sorted(row, key=lambda w: w.x0)).strip() or None

    species = col_value("SPECIES", width=60)
    background = col_value("BACKGROUND", width=60)
    player = col_value("PLAYER", width=90)
    xp = col_value("EXPERIENCE", width=70)

    classes: List[Dict[str, Any]] = []
    if class_level:
        for part in class_level.split("/"):
            m = re.match(r"\s*(.+?)\s+(\d+)\s*$", part.strip())
            if m:
                classes.append({"class": m.group(1).strip(), "level": int(m.group(2))})
    return {
        "name": name,
        "class_level_raw": class_level,
        "classes": classes,
        "primary_class": classes[0]["class"] if classes else None,
        "total_level": sum(c["level"] for c in classes) if classes else None,
        "species": species,
        "background": background,
        "player_name": player,
        "experience": xp,
    }


def parse_abilities(p: Page) -> Dict[str, Optional[int]]:
    scores: Dict[str, Optional[int]] = {}
    for ab in ABILITIES:
        # The ability box headers run down the LEFT edge (x < 75). Other occurrences of the same
        # word (e.g. in the saving-throw modifiers area) are further right, so constrain the column.
        hdr = next((w for w in p.words if w.text == ab.upper() and w.x0 < 75), None)
        score = None
        if hdr:
            cands = [w for w in p.words
                     if abs(w.cx - hdr.cx) < 35 and w.y0 > hdr.y1 and w.y0 - hdr.y1 < 30
                     and re.fullmatch(r"\d{1,2}", w.text)]
            cands.sort(key=lambda w: w.y0)
            if cands:
                score = int(cands[0].text)
        scores[ABBR[ab]] = score
    return scores


def parse_saves(p: Page) -> Dict[str, Optional[int]]:
    # Anchor every row label to the SAVING THROWS box footer. Two decoys otherwise win on emission
    # order: the all-caps ability-box header down the left edge (x0 ~41), and Title-case ability
    # words in the ACTIONS prose on the right (x0 ~407 on the rogue). Box footer sits at x0 ~125
    # with the six rows ~73-140pt above it.
    box = p.first("SAVING")
    saves: Dict[str, Optional[int]] = {}
    for ab in ABILITIES:
        lbl = p.in_column_above(ab, box, x_tol=45, max_dy=200)
        saves[ABBR[ab]] = _signed(_wt(p.value_left(lbl, max_dx=40))) if lbl else None
    return saves


def parse_skills(p: Page) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    # Same anchoring as saves: bind each row label to the SKILLS box footer (x0 ~140), otherwise a
    # skill word in body prose can win on emission order (the wizard's Bladesong text carries
    # "Acrobatics" at x0 ~363, against the real row at x0 ~131). Rows span ~63-292pt above the
    # footer, so the y-window is wider here than for saves.
    box = p.first("SKILLS")
    for name in SKILL_NAMES:
        first = name.split()[0]
        lbl = p.in_column_above(first, box, x_tol=45, max_dy=320)
        modifier = tier = None
        if lbl:
            modw = p.value_left(lbl, max_dx=30)
            modifier = _signed(_wt(modw))
            if modw:
                mark = p.value_left(modw, max_dx=20)
                if mark and mark.text in ("P", "E"):
                    tier = "expertise" if mark.text == "E" else "proficient"
        out.append({"skill": name, "modifier": modifier, "prof": tier})
    return out


def parse_combat(p: Page) -> Dict[str, Any]:
    # AC box: the ARMOR label and CLASS label that share the same x-column (~347), with the number
    # between them. Other ARMOR/CLASS tokens (proficiencies header, CLASS & LEVEL) are in different
    # columns and are excluded by the column match.
    ac = None
    armors = [w for w in p.words if w.text == "ARMOR"]
    classes = [w for w in p.words if w.text == "CLASS"]
    for a in armors:
        cl = next((c for c in classes if abs(c.cx - a.cx) < 25 and c.y0 > a.y0 and c.y0 - a.y1 < 60), None)
        if cl:
            band = [w for w in p.words if a.y1 <= w.cy <= cl.y0 and abs(w.cx - a.cx) < 30
                    and re.fullmatch(r"\d{1,2}", w.text)]
            if band:
                ac = int(band[0].text)
                break

    init_lbl = p.first("INITIATIVE")
    initiative = _signed(_wt(p.value_above(init_lbl, max_dy=40))) if init_lbl else None
    prof = _signed(_wt(p.value_left(p.first("PROFICIENCY"))))

    max_hp = None
    mh = p.first("Max")
    if mh:
        c = [w for w in p.words if abs(w.cx - mh.cx) < 40 and 0 < w.y0 - mh.y1 < 30 and re.fullmatch(r"\d+", w.text)]
        max_hp = int(c[0].text) if c else None

    # Page 1 has three identically-cased "HIT" tokens: HIT POINTS (x ~480), HIT DICE (x ~443) and
    # the attacks-table column header (x ~341). Casing cannot separate them, so key on the word that
    # FOLLOWS. Taking the first "HIT" in emission order read the attacks header on the rogue and
    # returned ACTIONS prose ("After you use it, your Speed") as the hit dice.
    hit_dice = None
    hd = p.first_followed_by("HIT", "DICE")
    if hd:
        band = [w for w in p.words if hd.y0 - 40 < w.cy < hd.y0 and abs(w.cx - hd.cx) < 45
                and w.text != "Total"]
        hit_dice = " ".join(w.text for w in sorted(band, key=lambda w: w.x0)).strip() or None

    speed = None
    sp = p.first("SPEED")
    if sp:
        # Speed value sits ~30pt above the SPEED label in the same box, spanning its width.
        band = [w for w in p.words if sp.y0 - 38 < w.cy < sp.y0 - 4 and abs(w.cx - sp.cx) < 90]
        speed = " ".join(w.text for w in sorted(band, key=lambda w: w.x0)).strip() or None

    # Passives live in the SENSES box on the LEFT edge (x < 110), value left of each label. Constrain
    # to that column so skill modifiers (which also sit left of similarly-named things) don't leak in.
    def passive(kind: str) -> Optional[int]:
        lbl = next((w for w in p.words if w.text == kind and w.x0 < 130), None)
        if not lbl:
            return None
        c = [w for w in p.words if w.x1 <= lbl.x0 and abs(w.cy - lbl.cy) < 10 and w.x0 < 80
             and re.fullmatch(r"\d+", w.text)]
        return int(c[0].text) if c else None

    return {
        "armor_class": ac,
        "initiative": initiative,
        "proficiency_bonus": prof,
        "speed": speed,
        "max_hp": max_hp,
        "hit_dice": hit_dice,
        "passive_perception": passive("PERCEPTION"),
        "passive_insight": passive("INSIGHT"),
        "passive_investigation": passive("INVESTIGATION"),
    }


def parse_proficiencies(p: Page) -> Dict[str, str]:
    # The proficiencies & training box is the right-hand column (x > 405). Restrict to that region so
    # the dense middle columns (skills, saves) don't bleed into the block text.
    region = [w for w in p.words if w.x0 > 405 and w.cy < 425]
    full = " ".join(w.text for w in sorted(region, key=lambda w: (round(w.cy / 3), w.cx)))
    out: Dict[str, str] = {}
    order = ["ARMOR", "WEAPONS", "TOOLS", "LANGUAGES"]
    for i, header in enumerate(order):
        nxt = order[i + 1] if i + 1 < len(order) else None
        if nxt:
            m = re.search(rf"=== {header} ===\s+(.*?)\s+=== {nxt} ===", full)
        else:
            m = re.search(rf"=== {header} ===\s+(.*?)(?:\s+PROFICIENCIES|\s*$)", full)
        if m:
            out[header.lower()] = re.sub(r"\s+", " ", m.group(1)).strip()
    return out


def parse_attacks(p: Page) -> List[Dict[str, Any]]:
    # The weapon-attacks table sits in the lower-middle of page 1. Its NAME header is the one in the
    # center column (x ~200-260), below the skills/senses region. Pick the NAME token in that band.
    tbl = next((w for w in p.words if w.text == "NAME" and 190 < w.x0 < 270 and w.cy > 550), None)
    if not tbl:
        return []
    # Rows are between the header and the "WEAPON ATTACKS & CANTRIPS" footer label.
    footer = next((w for w in p.words if w.text == "WEAPON" and w.cy > tbl.cy), None)
    y_end = footer.cy if footer else tbl.cy + 200
    rows: Dict[int, List[Word]] = {}
    for w in p.words:
        if tbl.cy + 6 < w.cy < y_end - 4 and w.x0 > 200:
            rows.setdefault(round(w.cy / 5), []).append(w)
    attacks: List[Dict[str, Any]] = []
    for _, ws in sorted(rows.items()):
        ws.sort(key=lambda w: w.x0)
        # Columns (verified): NAME <340, HIT ~344, DAMAGE ~380-445, NOTES >445.
        name = " ".join(w.text for w in ws if w.x0 < 335).strip()
        hit = " ".join(w.text for w in ws if 335 <= w.x0 < 375).strip()
        dmg = " ".join(w.text for w in ws if 375 <= w.x0 < 445).strip()
        notes = " ".join(w.text for w in ws if w.x0 >= 445).strip()
        if name and name.upper() != "NAME":
            attacks.append({"name": name, "hit": hit or None, "damage": dmg or None, "notes": notes or None})
    return attacks


# Every feature head on every sheet ends with a source citation: a bullet, then a book code, then an
# optional page number ("Fighting Style • PHB-2024 91", "Rakish Audacity • SCAG", "Creature Type •
# EFotA 38", "Elven Accuracy • XGtE 74"). All 118 heads across the three sheets match this shape and
# none contains more than one bullet, so matching a SINGLE trailing token plus optional page is both
# sufficient and tight enough not to eat a real multi-word name segment.
# This replaced a hardcoded book allowlist (PHB|BR|SCAG|XGE|TCE|DMG), which silently left the suffix
# glued to the name for any book not on it: the rogue's nine Eberron traits and, because the list had
# "XGE" where the sheet writes "XGtE", the wizard's Elven Accuracy.
FEATURE_SOURCE = re.compile(r"\s*[\u2022\u00b7]\s*([A-Za-z][A-Za-z0-9-]*(?:\s+\d+)?)\s*$")


def _column_lines(p: Page, x0: float, x1: float, y_bucket: float = 3.0,
                  y_min: Optional[float] = None, y_max: Optional[float] = None) -> List[str]:
    """Reading-order lines for a single column band [x0, x1), optionally clipped to y_min..y_max."""
    by_y: Dict[int, List[Word]] = {}
    for w in p.words:
        if not (x0 <= w.cx < x1):
            continue
        if (y_min is not None and w.cy <= y_min) or (y_max is not None and w.cy >= y_max):
            continue
        by_y.setdefault(round(w.cy / y_bucket), []).append(w)
    return [" ".join(x.text for x in sorted(ws, key=lambda w: w.x0)) for _, ws in sorted(by_y.items())]


def parse_features(pages: List[Page]) -> List[Dict[str, str]]:
    """Every feature/trait across the FEATURES & TRAITS pages. These pages are THREE columns; reading
    full-width lines splices columns together, so we read each column band separately and stitch them
    into ONE reading-order stream (page N col1, col2, col3, then page N+1...) before parsing. A
    feature starts with '* <Name>' and its body is the following non-marker / '|'-marker lines until
    the next feature, WHICHEVER column or page those lines fall in."""
    # Measured column geometry, identical on every features page of every sheet. The three column
    # left edges (the "*" bullet markers) sit at x0 38.1 / 220.6 / 402.0, and content spans
    #   col1 cx  39.4-205.2 | col2 cx 221.9-387.3 | col3 cx 403.3-569.3
    # leaving gutters at 205.2-221.9 and 387.3-403.3. The old col1/col2 boundary of 200 sat INSIDE
    # col1's content, so the tail words of col1 lines were being appended to col2.
    COLUMNS = [(0, 213), (213, 395), (395, 700)]
    # The character header block (name, class & level, species, background, player, XP) repeats at
    # the top of EVERY page and spans the full width, so its words fall into all three column bands.
    # It has to be excluded or the stitched stream feeds "Fighter 9 / Rogue 3 CLASS & LEVEL Variant
    # Human SPECIES" into the body of whichever feature was still open at the column break. Measured
    # across every features page of every sheet: the header block ends at cy 93.2 and feature content
    # starts at cy 141.8, so this bound has ~24pt of clearance on each side.
    HEADER_BOTTOM = 118.0

    # One continuous stream in reading order. Running the state machine per COLUMN (resetting and
    # flushing at each column end) silently dropped the body of any feature whose text carried over a
    # column or page break: the head was emitted with an empty desc and the continuation lines at the
    # top of the next column were orphaned, since they have no "*" to reopen them. Across the three
    # sheets that cost 5 features their entire description, including two that carry over a PAGE
    # break (the fighter's Defensive Duelist, the rogue's level-12 ASI), so the stream must span
    # pages and not merely columns.
    stream: List[str] = []
    for p in pages:
        # The features box is bounded BELOW by its own centred footer label, "FEATURES & TRAITS" or
        # "ADDITIONAL FEATURES & TRAITS", at y0 ~485 on every features page. Anchor on the FEATURES
        # token FOLLOWED BY "&": the only other FEATURES tokens on these pages are in-box section
        # headers followed by "===", and the bio page carries no FEATURES token at all. So this one
        # anchor both selects the feature pages and supplies the cutoff.
        # Testing merely for the words "FEATURES"/"TRAITS" anywhere on the page matched the BIO page
        # too, via "PERSONALITY TRAITS", and reading each column to the bottom of the page appended
        # the EQUIPMENT table and the legal footer to whichever feature was last in that column.
        foot = p.first_followed_by("FEATURES", "&")
        if not foot:
            continue
        for cx0, cx1 in COLUMNS:
            stream.extend(_column_lines(p, cx0, cx1, y_min=HEADER_BOTTOM, y_max=foot.y0))

    feats: List[Dict[str, str]] = []
    cur_name: Optional[str] = None
    cur_src: Optional[str] = None
    cur_body: List[str] = []
    for ln in stream:
        s = ln.strip()
        # Only "*" starts a feature. The "*" markers sit at exactly the three column left
        # edges (x0 38.1 / 220.6 / 402.0) on every page; a line-start bullet is a SUB-option
        # of the current feature, indented ~7.7pt further in. Treating the two alike promoted
        # every sub-option to a top-level feature with a sentence-fragment name (the rogue's
        # Cunning Strike and Devious Strikes options: "Poison (Cost: 1d6). You add a toxin to
        # your strike,"). Across the three sheets there are 42/47/29 "*" lines and only the
        # rogue has bullet-start lines, 6 of them, all sub-options, so line-start bullets are
        # an unambiguous signal. The bullet is kept in the body text to preserve the list.
        m = re.match(r"^\*\s+(.*)", s)
        if m:
            if cur_name:
                feats.append({"name": cur_name, "source": cur_src,
                              "desc": " ".join(cur_body).strip()})
            sm = FEATURE_SOURCE.search(m.group(1))
            head = FEATURE_SOURCE.sub("", m.group(1)).strip()
            cur_name, cur_src, cur_body = head, (sm.group(1) if sm else None), []
        elif re.match(r"^\|\s+", s):
            cur_body.append(re.sub(r"^\|\s+", "", s))
        elif cur_name and s and not re.match(r"^===|FEATURES|TRAITS|EQUIPMENT|ADDITIONAL", s, re.I):
            cur_body.append(s)
    if cur_name:
        feats.append({"name": cur_name, "source": cur_src, "desc": " ".join(cur_body).strip()})

    seen = set()
    uniq: List[Dict[str, str]] = []
    for f in feats:
        key = f["name"].lower()
        if key and key not in seen and len(f["name"]) > 1:
            seen.add(key)
            uniq.append(f)
    return uniq


def parse_bio(pages: List[Page]) -> Dict[str, Any]:
    bio: Dict[str, Any] = {}
    page = next((p for p in pages if p.first("BACKSTORY", exact=False)), None)
    if not page:
        return bio

    def above(label_text: str, dy: float = 12, band: float = 8, max_dx: float = 42) -> Optional[str]:
        lbl = page.first(label_text, exact=False)
        if not lbl:
            return None
        # Narrow x-window so the adjacent column's value doesn't bleed in. The value is left-aligned
        # with its label, so take words starting at/after the label's left edge within the column.
        row = [w for w in page.words if abs(w.cy - (lbl.cy - dy)) < band
               and lbl.x0 - 6 <= w.x0 <= lbl.x0 + max_dx]
        return " ".join(w.text for w in sorted(row, key=lambda w: w.x0)).strip() or None

    for label, key in [("GENDER", "gender"), ("AGE", "age"), ("SIZE", "size"), ("HEIGHT", "height"),
                       ("WEIGHT", "weight"), ("ALIGNMENT", "alignment"), ("FAITH", "faith"),
                       ("SKIN", "skin"), ("EYES", "eyes"), ("HAIR", "hair")]:
        bio[key] = above(label)

    def block(label_text: str) -> Optional[str]:
        lbl = page.first(label_text, exact=False)
        if not lbl:
            return None
        band = [w for w in page.words if lbl.cy - 70 < w.cy < lbl.cy - 6 and abs(w.cx - lbl.cx) < 130]
        return " ".join(w.text for w in sorted(band, key=lambda w: (round(w.cy / 3), w.cx))).strip() or None

    bio["personality"] = block("PERSONALITY")
    bio["ideals"] = block("IDEALS")
    bio["bonds"] = block("BONDS")
    bio["flaws"] = block("FLAWS")

    def column(label_text: str) -> Optional[str]:
        lbl = page.first(label_text, exact=False)
        if not lbl:
            return None
        band = [w for w in page.words if lbl.cy - 320 < w.cy < lbl.cy - 6 and abs(w.cx - lbl.cx) < 150]
        return " ".join(w.text for w in sorted(band, key=lambda w: (round(w.cy / 3), w.cx))).strip() or None

    bio["backstory"] = column("BACKSTORY")
    bio["appearance"] = column("APPEARANCE")
    bio["allies_organizations"] = column("ALLIES")
    return bio


def parse_spells(pages: List[Page]) -> Dict[str, Any]:
    spells: Dict[str, Any] = {"save_dc": None, "attack_bonus": None, "list": []}
    page = next((p for p in pages if any(w.text == "SPELLS" for w in p.words)), None)
    if not page:
        return spells

    dc = page.first("SAVE DC", exact=False)
    spells["save_dc"] = _int(_wt(page.value_above(dc, max_dy=40))) if dc else None
    atk = page.first("ATTACK", exact=False)
    spells["attack_bonus"] = _wt(page.value_above(atk, max_dy=40)) if atk else None

    # Anchor on the spell table's own NAME header (x0 ~58), not any NAME elsewhere on the page.
    header = next((w for w in page.words if w.text == "NAME" and w.x0 < 100 and w.cy > 100), None)
    if header:
        rows: Dict[int, List[Word]] = {}
        for w in page.words:
            if w.cy > header.cy + 6 and w.text != "SPELLS":
                rows.setdefault(round(w.cy / 4), []).append(w)
        for _, ws in sorted(rows.items()):
            ws.sort(key=lambda w: w.x0)
            # Measured column geometry, identical on all three sheets:
            #   PREP marker x0 ~31 | NAME x0 42-88 (ends by x1 ~112) | SOURCE x0 151-208
            #   (ends by x1 ~229) | SAVE/ATK x0 234+ | TIME x0 260 | RANGE/COMP/DURATION/REF beyond.
            # Two clean gutters: 112-151 and 229-234, so split on x0 at 148 and 230. The old cut at
            # 200 sat INSIDE the source column, so every source landed in the name ("Booming Blade
            # Wizard", "Mage Hand Telekinetic") and multi-word sources straddled the line, leaving
            # fragments like "Prepared)" at the head of the detail.
            body = [w for w in ws if w.x0 >= 42]
            # The PREP column carries TWO markers, not one: "O" for a preparable spell and "P" for
            # always-prepared. Filtering only "O" left "P" glued to the front of the name.
            prepared = any(w.text == "P" for w in ws if w.x0 < 42)
            name = " ".join(w.text for w in body if w.x0 < 148).strip()
            source = " ".join(w.text for w in body if 148 <= w.x0 < 230).strip()
            detail = " ".join(w.text for w in body if w.x0 >= 230).strip()
            # Skip section headers ("=== 1st LEVEL ==="), the cantrip banner, and the legal footer.
            if (not name or name.startswith("===") or "CANTRIP" in name.upper()
                    or "AT WILL" in name.upper() or name.startswith("TM ") or "©" in name):
                continue
            spells["list"].append({
                "name": name,
                "source": source or None,
                "always_prepared": prepared,
                "detail": detail or None,
            })
    return spells


def parse_equipment(pages: List[Page]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    seen = set()
    CURRENCY = {"CP", "SP", "EP", "GP", "PP"}
    for p in pages:
        eq = p.first("EQUIPMENT", exact=False)
        if not eq:
            continue
        region = [w for w in p.words if w.cy < eq.cy - 4 and w.cy > eq.cy - 260]
        # D&D Beyond uses TWO equipment layouts and they do NOT share column positions. Measured on
        # every equipment page of every sheet:
        #   main EQUIPMENT page (carries the currency ledger and ATTUNED MAGIC ITEMS)
        #     currency labels x0 ~22, currency AMOUNTS x0 ~52-71, carry-weight values x0 ~52-71
        #     left  NAME x0 ~114 | QTY x0 ~274 | WEIGHT x0 ~307 (values end by x ~333)
        #     right NAME x0 ~350 | QTY x0 ~511 | WEIGHT x0 ~545
        #   ADDITIONAL EQUIPMENT pages (no currency ledger; columns sit ~50pt further left)
        #     left  NAME x0 ~40  | QTY x0 ~236 | WEIGHT x0 ~270 (values end by x ~292)
        #     right NAME x0 ~315 | QTY x0 ~511 | WEIGHT x0 ~545
        # One band pair cannot serve both: bands tuned to the main page chop the front off every
        # name on the additional pages, and bands tuned to the additional pages let the currency
        # amounts into the main page's left column. The left band must start after the far-left
        # strip (main page only) and the split must fall in the gutter between the LEFT table's
        # weight values and the RIGHT table's names, which sits at ~340 on the main page and ~295
        # on the additional pages.
        additional = any(w.text == "ADDITIONAL" for w in p.words)
        bands = [(0, 295), (295, 612)] if additional else [(100, 345), (345, 612)]
        for xlo, xhi in bands:
            col = [w for w in region if xlo <= w.cx < xhi and w.text not in CURRENCY]
            by_y: Dict[int, List[Word]] = {}
            for w in col:
                by_y.setdefault(round(w.cy / 5), []).append(w)
            for _, ws in sorted(by_y.items()):
                ws.sort(key=lambda w: w.x0)
                name_parts, detail_parts, hit_num = [], [], False
                for w in ws:
                    if not hit_num and re.fullmatch(r"\d+", w.text):
                        hit_num = True
                    (detail_parts if hit_num else name_parts).append(w.text)
                name = " ".join(name_parts).strip()
                up = name.upper()
                # Real inventory rows have a quantity number (hit_num). The carry-weight stat box
                # (WEIGHT CARRIED / ENCUMBERED / "152.3 lb.") has no qty, so require hit_num to drop it.
                if (name and hit_num and up not in ("NAME", "EQUIPMENT", "ADDITIONAL EQUIPMENT",
                        "NAME QTY", "ATTUNED MAGIC ITEMS", "QTY", "WEIGHT", "WEIGHT CARRIED",
                        "ENCUMBERED", "PUSH/DRAG/LIFT") and len(name) > 1
                        and not name.startswith("===") and "©" not in name and not up.startswith("TM ")):
                    key = name.lower()
                    if key not in seen:
                        seen.add(key)
                        items.append({"name": name, "detail": " ".join(detail_parts).strip() or None})
    return items


def parse_sheet(pdf_path: str) -> Dict[str, Any]:
    pages = load_pages(pdf_path)
    p1 = pages[0] if pages else Page()
    return {
        "identity": parse_identity(p1),
        "abilities": parse_abilities(p1),
        "saves": parse_saves(p1),
        "skills": parse_skills(p1),
        "combat": parse_combat(p1),
        "proficiencies": parse_proficiencies(p1),
        "attacks": parse_attacks(p1),
        "features": parse_features(pages[1:] if len(pages) > 1 else []),
        "bio": parse_bio(pages),
        "spells": parse_spells(pages),
        "equipment": parse_equipment(pages[1:4] if len(pages) > 1 else []),
        "_meta": {"pages": len(pages), "source": "dndbeyond_pdf"},
    }


def _fix_mojibake(obj: Any) -> Any:
    """Repair the common UTF-8-as-Latin1 mojibake (â€¢ -> •, â€™ -> ') that appears when the text is
    mis-decoded on some Windows setups. Applied to every string in the parsed tree."""
    if isinstance(obj, str):
        if "Ã" in obj or "â€" in obj:
            try:
                return obj.encode("latin-1").decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                return obj
        return obj
    if isinstance(obj, list):
        return [_fix_mojibake(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _fix_mojibake(v) for k, v in obj.items()}
    return obj


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python parse_ddb_sheet.py <sheet.pdf> [--out out.json]", file=sys.stderr)
        return 2
    parsed = _fix_mojibake(parse_sheet(sys.argv[1]))
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(parsed, fh, ensure_ascii=False, indent=2)
        print(f"wrote {out}")
    else:
        # ensure_ascii=True here so a mis-configured console can't mangle the bytes on stdout.
        print(json.dumps(parsed, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
