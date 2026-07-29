#!/usr/bin/env python3
"""
parse_ddb_fields.py - Read a D&D Beyond character-sheet PDF via its FORM FIELDS.

D&D Beyond exports the sheet as a filled form: every page carries Widget annotations whose /T is a
stable field name and whose /V is the value. So the structured data is already in the file and none
of it has to be recovered from rendered glyph positions.

Emits the SAME JSON shape as parse_ddb_sheet.py (the coordinate parser) so the two can be diffed and
so lib/ddb-import.ts consumes either without changes. The coordinate parser remains the fallback for
FLATTENED exports, which carry no annotations.

The browser equivalent of the whole loader here is pdf.js page.getAnnotations(), which returns
{ fieldName, fieldValue, rect } per widget. No coordinate maths, no tokenizer, no y-flip.

Usage:
    python parse_ddb_fields.py <sheet.pdf> [--out x.json]
"""

from __future__ import annotations
import json
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

try:
    import pikepdf
except ImportError:  # pragma: no cover
    print("pikepdf required: py -m pip install pikepdf", file=sys.stderr)
    raise


# ---------------------------------------------------------------------------
# Field loading
# ---------------------------------------------------------------------------

def load_fields(pdf_path: str) -> Tuple[Dict[str, str], List[Dict[str, str]], List[Tuple[int, float, str, str]]]:
    """Return (merged, per_page, ordered).

    merged   - {stripped field name -> value} across every page. Safe ONLY for the single-instance
               fields (the page-1 stat block, bio, proficiencies).
    per_page - one dict per page, in page order. REQUIRED for the indexed families, because the
               template DOES reuse names across pages: a 4-page sheet carries FeaturesTraits4/5/6 on
               page 3 AND AGAIN on page 4, and restarts Eq Name at 26 on both page 3 and page 4.
               A flat merge silently drops the later page (it cost the fighter its feats and the
               rogue its species traits). The wizard has only two such pages, so this never shows on
               a single test sheet - it needs a 3-page one.
    ordered  - [(page, -y_top, name, value)] in reading order, for the spell table, where the
               "=== 1st LEVEL ===" headers are a separate family and position says which rows they
               govern.

    Field names are stripped because the template is inconsistent about trailing spaces
    ("DEXmod ", "Stealth ", "Wpn2 AtkBonus "). Internal spacing is preserved, because some names
    genuinely contain a double space ("CLASS  LEVEL").
    """
    merged: Dict[str, str] = {}
    per_page: List[Dict[str, str]] = []
    ordered: List[Tuple[int, float, str, str]] = []
    with pikepdf.open(pdf_path) as pdf:
        for pageno, page in enumerate(pdf.pages, start=1):
            page_fields: Dict[str, str] = {}
            per_page.append(page_fields)
            for a in page.get("/Annots", []) or []:
                try:
                    if a.get("/FT") != "/Tx":
                        continue
                    name = str(a.get("/T") or "").strip()
                    if not name:
                        continue
                    value = str(a.get("/V") or "")
                    if name not in page_fields or (not page_fields[name].strip() and value.strip()):
                        page_fields[name] = value
                    if name not in merged or (not merged[name].strip() and value.strip()):
                        merged[name] = value
                    rect = a.get("/Rect")
                    top = -float(rect[3]) if rect is not None else 0.0
                    ordered.append((pageno, top, name, value))
                except Exception:
                    continue
    ordered.sort(key=lambda r: (r[0], r[1]))
    return merged, per_page, ordered


def _s(fields: Dict[str, str], key: str) -> Optional[str]:
    v = (fields.get(key) or "").strip()
    return v or None


def _i(fields: Dict[str, str], key: str) -> Optional[int]:
    v = _s(fields, key)
    if not v:
        return None
    m = re.search(r"-?\d+", v.replace(",", ""))
    return int(m.group()) if m else None


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------

ABBR = ["str", "dex", "con", "int", "wis", "cha"]
ABIL_FIELD = {"str": "STR", "dex": "DEX", "con": "CON", "int": "INT", "wis": "WIS", "cha": "CHA"}
SAVE_FIELD = {
    "str": ("ST Strength", "StrProf"), "dex": ("ST Dexterity", "DexProf"),
    "con": ("ST Constitution", "ConProf"), "int": ("ST Intelligence", "IntProf"),
    "wis": ("ST Wisdom", "WisProf"), "cha": ("ST Charisma", "ChaProf"),
}
# The template's skill field names are irregular: "Animal" for Animal Handling, "SleightofHand" for
# the value but "SleightOfHandProf" for the marker. Map them explicitly rather than deriving.
SKILL_FIELD = [
    ("Acrobatics", "Acrobatics", "AcrobaticsProf"),
    ("Animal Handling", "Animal", "AnimalHandlingProf"),
    ("Arcana", "Arcana", "ArcanaProf"),
    ("Athletics", "Athletics", "AthleticsProf"),
    ("Deception", "Deception", "DeceptionProf"),
    ("History", "History", "HistoryProf"),
    ("Insight", "Insight", "InsightProf"),
    ("Intimidation", "Intimidation", "IntimidationProf"),
    ("Investigation", "Investigation", "InvestigationProf"),
    ("Medicine", "Medicine", "MedicineProf"),
    ("Nature", "Nature", "NatureProf"),
    ("Perception", "Perception", "PerceptionProf"),
    ("Performance", "Performance", "PerformanceProf"),
    ("Persuasion", "Persuasion", "PersuasionProf"),
    ("Religion", "Religion", "ReligionProf"),
    ("Sleight of Hand", "SleightofHand", "SleightOfHandProf"),
    ("Stealth", "Stealth", "StealthProf"),
    ("Survival", "Survival", "SurvivalProf"),
]


def parse_identity(f: Dict[str, str]) -> Dict[str, Any]:
    raw = _s(f, "CLASS  LEVEL") or _s(f, "CLASS LEVEL")
    classes: List[Dict[str, Any]] = []
    if raw:
        for part in raw.split("/"):
            m = re.match(r"\s*(.+?)\s+(\d+)\s*$", part.strip())
            if m:
                classes.append({"class": m.group(1).strip(), "level": int(m.group(2))})
    return {
        "name": _s(f, "CharacterName"),
        "class_level_raw": raw,
        "classes": classes,
        "primary_class": classes[0]["class"] if classes else None,
        "total_level": sum(c["level"] for c in classes) if classes else None,
        "species": _s(f, "RACE"),
        "background": _s(f, "BACKGROUND"),
        "player_name": _s(f, "PLAYER NAME"),
        "experience": _s(f, "EXPERIENCE POINTS"),
    }


def parse_abilities(f: Dict[str, str]) -> Dict[str, Optional[int]]:
    return {a: _i(f, ABIL_FIELD[a]) for a in ABBR}


def parse_saves(f: Dict[str, str]) -> Dict[str, Optional[int]]:
    return {a: _i(f, SAVE_FIELD[a][0]) for a in ABBR}


def parse_save_prof(f: Dict[str, str]) -> List[str]:
    """D&D Beyond marks a proficient save with a bullet in <Abil>Prof. It is stated outright, so no
    inference from modifier arithmetic is needed."""
    return [a for a in ABBR if (f.get(SAVE_FIELD[a][1]) or "").strip()]


def parse_skills(f: Dict[str, str]) -> List[Dict[str, Any]]:
    out = []
    for label, valkey, profkey in SKILL_FIELD:
        mark = (f.get(profkey) or "").strip().upper()
        tier = "expertise" if mark == "E" else ("proficient" if mark else None)
        out.append({"skill": label, "modifier": _i(f, valkey), "prof": tier})
    return out


def parse_combat(f: Dict[str, str]) -> Dict[str, Any]:
    return {
        "armor_class": _i(f, "AC"),
        "initiative": _i(f, "Init"),
        "proficiency_bonus": _i(f, "ProfBonus"),
        "speed": _s(f, "Speed"),
        "max_hp": _i(f, "MaxHP"),
        "hit_dice": _s(f, "Total"),
        "passive_perception": _i(f, "Passive1"),
        "passive_insight": _i(f, "Passive2"),
        "passive_investigation": _i(f, "Passive3"),
    }


def parse_defenses(f: Dict[str, str]) -> Dict[str, Any]:
    """The DEFENSES and SENSES boxes, which the coordinate parser never read at all."""
    d = _s(f, "Defenses") or ""
    res, imm = [], []
    for line in d.splitlines():
        line = line.strip()
        m = re.match(r"(Resistances|Immunities|Vulnerabilities)\s*-\s*(.+)$", line, re.I)
        if not m:
            continue
        vals = [x.strip() for x in re.split(r",|\band\b", m.group(2)) if x.strip()]
        (res if m.group(1).lower().startswith("resist") else imm).extend(vals)
    return {
        "raw": d or None,
        "resistances": res,
        "immunities": imm,
        "senses": _s(f, "AdditionalSenses"),
        "save_modifiers": _s(f, "SaveModifiers"),
    }


def parse_currency(f: Dict[str, str]) -> Dict[str, Optional[int]]:
    return {c.lower(): _i(f, c) for c in ("CP", "SP", "EP", "GP", "PP")}


def parse_proficiencies(f: Dict[str, str]) -> Dict[str, str]:
    """ProficienciesLang is one field carrying "=== ARMOR === ... === WEAPONS === ..." sections."""
    blob = f.get("ProficienciesLang") or ""
    out: Dict[str, str] = {}
    parts = re.split(r"===\s*([A-Z &]+?)\s*===", blob)
    for i in range(1, len(parts) - 1, 2):
        key = parts[i].strip().lower()
        val = re.sub(r"\s+", " ", parts[i + 1]).strip()
        if key and val:
            out[key] = val
    return out


def parse_attacks(f: Dict[str, str]) -> List[Dict[str, Any]]:
    out = []
    for i in range(1, 12):
        name = _s(f, "Wpn Name") if i == 1 else _s(f, f"Wpn Name {i}")
        if not name:
            continue
        out.append({
            "name": name,
            "hit": _s(f, f"Wpn{i} AtkBonus"),
            "damage": _s(f, f"Wpn{i} Damage"),
            "notes": _s(f, f"Wpn Notes {i}"),
        })
    return out


FEATURE_SOURCE = re.compile(r"\s*[\u2022\u00b7]\s*([A-Za-z][A-Za-z0-9-]*(?:\s+\d+)?)\s*$")


def parse_features(per_page: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """FeaturesTraits1..N carry the whole features section as multi-line text, in order, with REAL
    newlines. So the same "* name / bullet sub-option / | continuation" state machine the coordinate
    parser used applies directly, with no column stitching, no page-header exclusion and no y-bounds:
    the blobs simply concatenate."""
    blobs: List[str] = []
    for pf in per_page:
        keys = sorted(
            (k for k in pf if re.fullmatch(r"FeaturesTraits\d+", k)),
            key=lambda k: int(re.search(r"\d+", k).group()),
        )
        blobs.extend(pf[k] for k in keys)
    text = "\n".join(blobs)
    feats: List[Dict[str, Any]] = []
    cur_name: Optional[str] = None
    cur_src: Optional[str] = None
    cur_body: List[str] = []
    for raw_line in text.splitlines():
        s = raw_line.strip()
        if not s:
            continue
        m = re.match(r"^\*\s+(.*)", s)
        if m:
            if cur_name:
                feats.append({"name": cur_name, "source": cur_src, "desc": " ".join(cur_body).strip()})
            sm = FEATURE_SOURCE.search(m.group(1))
            cur_name = FEATURE_SOURCE.sub("", m.group(1)).strip()
            cur_src = sm.group(1) if sm else None
            cur_body = []
        elif re.match(r"^\|\s+", s):
            cur_body.append(re.sub(r"^\|\s+", "", s))
        elif cur_name and not s.startswith("==="):
            cur_body.append(s)
    if cur_name:
        feats.append({"name": cur_name, "source": cur_src, "desc": " ".join(cur_body).strip()})

    # Same first-wins dedupe as the coordinate parser, EXCEPT an entry carrying text beats an
    # earlier empty one: D&D Beyond lists a name once as a bare class-roster entry and again with
    # the granted content ("Weapon Mastery" then "Weapon Mastery / Longsword (Sap)").
    best: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    for ft in feats:
        key = ft["name"].lower()
        if not key or len(ft["name"]) <= 1:
            continue
        if key not in best:
            best[key] = ft
            order.append(key)
        elif not best[key]["desc"] and ft["desc"]:
            best[key] = ft
    return [best[k] for k in order]


BIO_FIELD = [
    ("gender", "GENDER"), ("age", "AGE"), ("size", "SIZE"), ("height", "HEIGHT"),
    ("weight", "WEIGHT"), ("alignment", "ALIGNMENT"), ("faith", "FAITH"),
    ("skin", "SKIN"), ("eyes", "EYES"), ("hair", "HAIR"),
    ("personality", "PersonalityTraits"), ("ideals", "Ideals"), ("bonds", "Bonds"),
    ("flaws", "Flaws"), ("backstory", "Backstory"), ("appearance", "Appearance"),
    ("allies_organizations", "AlliesOrganizations"), ("notes", "AdditionalNotes1"),
]


def parse_bio(f: Dict[str, str]) -> Dict[str, Any]:
    return {key: _s(f, field) for key, field in BIO_FIELD}


def parse_spells(f: Dict[str, str], ordered: List[Tuple[int, float, str, str]]) -> Dict[str, Any]:
    """Spell rows are spellName#/spellSource#/... families. The level a row belongs to comes from a
    SEPARATE family (spellHeader# "=== 1st LEVEL ===" and spellSlotHeader# "4 Slots OOOO"), and only
    page position says which rows a header governs, so walk the fields in reading order and carry the
    current header forward."""
    spells: Dict[str, Any] = {"save_dc": None, "attack_bonus": None, "slots": {}, "list": []}
    spells["save_dc"] = _i(f, "spellSaveDC0")
    spells["attack_bonus"] = _s(f, "spellAtkBonus0")

    # Slots pair with their level by INDEX: spellHeaderN gives the level, spellSlotHeaderN its slot
    # count. They cannot be paired by page position, because the slot header is laid out ABOVE its
    # own level header, which assigned every count to the previous level.
    for key, val in f.items():
        m = re.fullmatch(r"spellHeader(\d+)", key)
        if not m or not val.strip():
            continue
        label = val.upper()
        if "CANTRIP" in label:
            continue
        lm = re.search(r"(\d+)", label)
        slot = f.get(f"spellSlotHeader{m.group(1)}") or ""
        sm = re.search(r"(\d+)\s+Slots", slot)
        if lm and sm:
            spells["slots"][lm.group(1)] = int(sm.group(1))

    cur_level: Optional[int] = None
    for _page, _top, name, value in ordered:
        v = (value or "").strip()
        if re.fullmatch(r"spellHeader\d+", name) and v:
            label = v.upper()
            if "CANTRIP" in label:
                cur_level = 0
            else:
                m = re.search(r"(\d+)", label)
                cur_level = int(m.group(1)) if m else None
            continue
        if re.fullmatch(r"spellSlotHeader\d+", name):
            continue  # handled by index below, not by position
        m = re.fullmatch(r"spellName(\d+)", name)
        if not m or not v:
            continue
        i = m.group(1)
        nm = v
        ritual = bool(re.search(r"\s*\[R\]\s*$", nm))
        if ritual:
            nm = re.sub(r"\s*\[R\]\s*$", "", nm).strip()
        prepared = (f.get(f"spellPrepared{i}") or "").strip().upper() == "P"
        detail_parts = [
            _s(f, f"spellSaveHit{i}"), _s(f, f"spellCastingTime{i}"), _s(f, f"spellRange{i}"),
            _s(f, f"spellComponents{i}"), _s(f, f"spellDuration{i}"), _s(f, f"spellPage{i}"),
            _s(f, f"spellNotes{i}"),
        ]
        spells["list"].append({
            "name": nm,
            "level": cur_level,
            "source": _s(f, f"spellSource{i}"),
            "always_prepared": prepared,
            "ritual": ritual,
            # Kept for shape-compatibility with the coordinate parser, but now assembled from
            # DISCRETE fields rather than a mashed x-range, so the structured pieces are exact.
            "detail": " ".join(p for p in detail_parts if p) or None,
            "save_hit": _s(f, f"spellSaveHit{i}"),
            "casting_time": _s(f, f"spellCastingTime{i}"),
            "range": _s(f, f"spellRange{i}"),
            "components": _s(f, f"spellComponents{i}"),
            "duration": _s(f, f"spellDuration{i}"),
            "page_ref": _s(f, f"spellPage{i}"),
            "notes": _s(f, f"spellNotes{i}"),
        })
    return spells


def parse_equipment(per_page: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """Eq Name#/Eq Qty#/Eq Weight# are globally sequential across pages (0-25 on the equipment page,
    26-55 on the additional page), so a flat index walk is safe. Quantity and weight are their OWN
    fields, so no name/qty splitting and no duplicate collapsing: every row is distinct by index."""
    attuned = set()
    for pf in per_page:
        for k, v in pf.items():
            if re.fullmatch(r"Attuned Name\s*\d+", k) and v.strip():
                attuned.add(v.strip().lower())
    items: List[Dict[str, Any]] = []
    for pf in per_page:
        idx = sorted(
            int(re.search(r"\d+", k).group())
            for k in pf if re.fullmatch(r"Eq Name\s*\d+", k)
        )
        for i in idx:
            name = _s(pf, f"Eq Name{i}")
            if not name:
                continue
            qty = _s(pf, f"Eq Qty{i}")
            weight = _s(pf, f"Eq Weight{i}")
            items.append({
                "name": name,
                "detail": " ".join(x for x in (qty, weight) if x) or None,
                "attuned": name.lower() in attuned,
                "qty": int(qty.replace(",", "")) if qty and qty.replace(",", "").isdigit() else None,
                "weight": weight,
            })
    return items


# ---------------------------------------------------------------------------

def parse_sheet(pdf_path: str) -> Dict[str, Any]:
    f, per_page, ordered = load_fields(pdf_path)
    return {
        "identity": parse_identity(f),
        "abilities": parse_abilities(f),
        "saves": parse_saves(f),
        "save_prof": parse_save_prof(f),
        "skills": parse_skills(f),
        "combat": parse_combat(f),
        "defenses": parse_defenses(f),
        "currency": parse_currency(f),
        "proficiencies": parse_proficiencies(f),
        "attacks": parse_attacks(f),
        "features": parse_features(per_page),
        "bio": parse_bio(f),
        "spells": parse_spells(f, ordered),
        "equipment": parse_equipment(per_page),
        "_meta": {"source": "dndbeyond_pdf_fields", "field_count": len(f)},
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python parse_ddb_fields.py <sheet.pdf> [--out out.json]", file=sys.stderr)
        return 2
    parsed = parse_sheet(sys.argv[1])
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(parsed, fh, ensure_ascii=False, indent=2)
        print(f"wrote {out}")
    else:
        print(json.dumps(parsed, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
