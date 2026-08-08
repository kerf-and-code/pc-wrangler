#!/usr/bin/env python3
"""
fetch_srd.py - pull STRUCTURED class, subclass and species data from the 5e-bits SRD database.

WHY THIS EXISTS
    lib/srd/classes-2024.json holds 218 class feature entries and 98 of them ask the player to
    choose something - Weapon Mastery, Expertise, Fighting Style, every subclass pick. All 98 are
    PROSE in a `desc` field, so the Forge cannot offer them as choices; it can only print them.

    The 5e-bits SRD database models a choice as a first-class object:

        "proficiency_choices": [
          { "desc": "Choose two from ...", "choose": 2, "type": "proficiencies",
            "from": { "option_set_type": "options_array",
                      "options": [ { "option_type": "reference",
                                     "item": { "index": "skill-acrobatics", "name": "Skill: Acrobatics" } } ] } }
        ]

    That is the missing half. The same shape appears on starting equipment, on race ability bonuses
    and proficiencies, and on features that branch (Fighting Style's options live under
    feature_specific.subfeature_options).

WHAT IT IS NOT
    It is not a scraper. It reads openly licensed JSON from a public repository, which is both
    sturdier than parsing someone's HTML and ground we are allowed to stand on. 5e.tools and similar
    publish no API, license nothing for redistribution, and reorganise without notice.

THE EDITION CAVEAT, STATED PLAINLY
    This is SRD 5.1 - the 2014 rules. There is no 2024 equivalent with structured choices that I
    have found. So this gives the Forge a complete 2014 path and nothing for 2024, and the 2024
    choice data will have to be authored by hand for the twelve core classes. Anything written here
    lands in *-2014.json files only, and never touches the 2024 files.

RUN IT
    py fetch_srd.py --inspect              # print the real shapes, write nothing
    py fetch_srd.py --json lib/srd         # fetch and write the app-shaped files

    --inspect FIRST. The mapper below was written from the API documentation rather than from the
    data, and this project has been bitten repeatedly by assuming a shape instead of reading one.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

REPO = "5e-bits/5e-database"

# What each dataset is called, matched case-insensitively against the repo's file list. Deliberately
# NOT a hardcoded path: the first version of this guessed src/2014/5e-SRD-Classes.json from memory
# and got a 404, which is the same "assume a shape instead of reading one" mistake this project
# keeps paying for. The tree is listed once and the paths are found in it.
WANT = {
    "classes":    ["classes"],
    "levels":     ["levels"],
    "features":   ["features"],
    "subclasses": ["subclasses"],
    "races":      ["races"],
    "subraces":   ["subraces"],
    "traits":     ["traits"],
}

_PATHS: dict[str, str] = {}


def _get(url: str, timeout: int = 60):
    req = urllib.request.Request(url, headers={
        # GitHub refuses the default Python user agent on some endpoints.
        "User-Agent": "six-axes-srd-fetch",
        "Accept": "application/vnd.github+json",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def discover(verbose: bool = True) -> dict[str, str]:
    """List the repo once and find each dataset's real path."""
    if _PATHS:
        return _PATHS
    tree = None
    for ref in ("main", "master"):
        try:
            raw = _get(f"https://api.github.com/repos/{REPO}/git/trees/{ref}?recursive=1")
            tree = json.loads(raw.decode("utf-8")).get("tree") or []
            if tree:
                if verbose:
                    print(f"  listed {REPO}@{ref}: {len(tree)} entries")
                break
        except Exception as e:
            if verbose:
                print(f"  {ref}: {e}")
    if not tree:
        raise SystemExit(
            "Could not list the repository. Check the network, then open\n"
            f"  https://github.com/{REPO}\n"
            "and tell me the path to the JSON files."
        )

    jsons = [t["path"] for t in tree if t.get("type") == "blob" and t.get("path", "").lower().endswith(".json")]

    for key, words in WANT.items():
        # Prefer a 2014/SRD path when several match, since 2024 files may sit alongside now.
        cands = [p for p in jsons if all(w in p.lower() for w in words)]
        cands.sort(key=lambda p: (0 if "2014" in p else 1, 0 if "srd" in p.lower() else 1, len(p)))
        if cands:
            _PATHS[key] = cands[0]

    if verbose:
        print("  resolved paths:")
        for k in WANT:
            print(f"    {k:<11} {_PATHS.get(k) or 'NOT FOUND'}")
        missing = [k for k in WANT if k not in _PATHS]
        if missing:
            print("\n  Some datasets were not found. Every .json in the repo:")
            for p in sorted(jsons)[:60]:
                print("   ", p)
    return _PATHS


def fetch(name: str) -> list:
    paths = discover(verbose=False)
    path = paths.get(name)
    if not path:
        raise SystemExit(f"No file found for '{name}'. Run --discover to see what is in the repo.")
    url = f"https://raw.githubusercontent.com/{REPO}/HEAD/{path}"
    print(f"  fetching {name:<11} {path} ...", end="", flush=True)
    data = json.loads(_get(url).decode("utf-8"))
    if isinstance(data, dict):
        # Some datasets are wrapped; take the first list value.
        data = next((v for v in data.values() if isinstance(v, list)), [])
    print(f" {len(data)} records")
    return data


# --------------------------------------------------------------------------- inspect

def describe(value, depth=0, max_depth=3):
    """A compact shape of a value: types and keys, not contents."""
    pad = "  " * (depth + 2)
    if isinstance(value, dict):
        if depth >= max_depth:
            return "{...}"
        out = []
        for k, v in list(value.items())[:24]:
            out.append(f"{pad}{k}: {describe(v, depth + 1, max_depth)}")
        return "{\n" + "\n".join(out) + "\n" + "  " * (depth + 1) + "}"
    if isinstance(value, list):
        if not value:
            return "[]"
        return f"[{len(value)} x {describe(value[0], depth + 1, max_depth)}]"
    if isinstance(value, str):
        return f'"{value[:48]}{"..." if len(value) > 48 else ""}"'
    return type(value).__name__


def inspect() -> int:
    """
    Print what the data ACTUALLY looks like. The point is to check three specific things before
    trusting the mapper: where choices live, how they are shaped, and whether feature options
    (Fighting Style and friends) are structured or are prose after all.
    """
    data = {k: fetch(k) for k in WANT}

    print("\n" + "=" * 72)
    print("CLASS - first record, top level")
    print("=" * 72)
    c = data["classes"][0]
    print(f"  name: {c.get('name')}")
    for k, v in c.items():
        print(f"  {k}: {describe(v, 0, 2)}")

    print("\n" + "=" * 72)
    print("THE CHOICE SHAPE - this is the whole reason for the exercise")
    print("=" * 72)
    for cls in data["classes"]:
        for ch in cls.get("proficiency_choices") or []:
            print(f"  {cls['name']}:")
            print(json.dumps(ch, indent=4)[:1200])
            break
        break

    print("\n" + "=" * 72)
    print("FEATURES WITH OPTIONS - Fighting Style, Metamagic, Manoeuvres, Expertise")
    print("=" * 72)
    withopts = [f for f in data["features"] if f.get("feature_specific")]
    print(f"  features carrying feature_specific: {len(withopts)} of {len(data['features'])}")
    for f in withopts[:2]:
        print(f"\n  {f.get('class', {}).get('name')} L{f.get('level')} {f.get('name')}")
        print(json.dumps(f.get("feature_specific"), indent=4)[:1000])

    print("\n" + "=" * 72)
    print("HOW MANY FEATURES ARE CHOICES, AND HOW MANY ARE STRUCTURED")
    print("=" * 72)
    tot = len(data["features"])
    structured = len(withopts)
    prosechoice = sum(
        1 for f in data["features"]
        if not f.get("feature_specific")
        and any("choose" in str(d).lower() or "your choice" in str(d).lower() for d in (f.get("desc") or []))
    )
    print(f"  total features          : {tot}")
    print(f"  structured options      : {structured}")
    print(f"  prose-only choices left : {prosechoice}")
    print("  ^ the third number is what would still need hand-authoring")

    print("\n" + "=" * 72)
    print("RACE - ability bonuses and their options")
    print("=" * 72)
    r = data["races"][0]
    for k in ("name", "ability_bonuses", "ability_bonus_options", "starting_proficiency_options",
              "language_options", "traits", "subraces", "speed", "size"):
        if k in r:
            print(f"  {k}: {describe(r[k], 0, 3)}")

    print("\n" + "=" * 72)
    print("LEVELS - per-level feature roster")
    print("=" * 72)
    lv = data["levels"][0]
    for k, v in lv.items():
        print(f"  {k}: {describe(v, 0, 2)}")

    print("\nNothing was written. Send this output and the mapper can be finished against it.")
    return 0



# ============================================================================ OPEN5E (2024 / SRD 5.2)
#
# The 5e-bits database above is SRD 5.1 only. SRD 5.2 - the 2024 rules - is published under
# CC-BY-4.0 and Open5e serves it, which is the same API fetch_bestiary.py already pulls monsters
# from. Same discipline as everywhere else here: DISCOVER what the endpoints are and what they
# return before mapping anything, because every time this project has assumed a shape it has cost a
# round trip.
#
# Filtering is done CLIENT SIDE on document.gamesystem.key, exactly as fetch_bestiary.py does, so
# there is no query-parameter guessing to get wrong.

OPEN5E = "https://api.open5e.com"
O5E_CANDIDATES = [
    "/v2/classes/",
    # 2024 renamed races to SPECIES, so /v2/races/ 404s. These are the plausible names; probing is
    # cheaper than reading changelogs and it reports what is actually there.
    "/v2/species/", "/v2/speciestraits/", "/v2/races/", "/v2/subraces/", "/v2/racetraits/",
    "/v2/spells/", "/v2/backgrounds/", "/v2/feats/", "/v2/items/", "/v2/itemcategories/",
    "/v1/classes/", "/v1/races/",
]


def o5e_page(url: str, retries: int = 3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "six-axes-srd-fetch",
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            # A 4xx is an answer, not a blip. Retrying it three times only slows the failure down
            # and buries the status code that would have explained it.
            body = ""
            try:
                body = e.read().decode("utf-8", "replace")[:200]
            except Exception:       # noqa: BLE001
                pass
            raise RuntimeError(f"HTTP {e.code} {e.reason} :: {body}") from e
        except Exception as e:      # noqa: BLE001 - transport blips are worth a retry
            last = e
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"giving up on {url}: {last}")


def o5e_all(path: str, limit: int = 500) -> list:
    """Walk a paginated Open5e list by following its own next link."""
    out, url, page = [], f"{OPEN5E}{path}?limit={limit}", 0
    while url:
        page += 1
        payload = o5e_page(url)
        batch = payload.get("results") or []
        out.extend(batch)
        print(f"    page {page}: +{len(batch)} (have {len(out)} of {payload.get('count')})")
        url = payload.get("next")
    return out


def open5e_inspect() -> int:
    print("Probing Open5e endpoints ...")
    live = {}
    for path in O5E_CANDIDATES:
        try:
            payload = o5e_page(f"{OPEN5E}{path}?limit=1")
            live[path] = payload.get("count")
            print(f"  {path:<22} OK   count={payload.get('count')}")
        except Exception as e:      # noqa: BLE001
            print(f"  {path:<22} --   {e}")

    def gs_key(r):
        doc = r.get("document") or {}
        if not isinstance(doc, dict):
            return "?"
        return ((doc.get("gamesystem") or {}) or {}).get("key") or "?"

    for path in [p for p in ("/v2/classes/", "/v2/species/", "/v2/races/", "/v2/backgrounds/",
                             "/v2/feats/") if p in live]:
        print("\n" + "=" * 72)
        print(f"{path}")
        print("=" * 72)
        rows = o5e_all(path)

        keys = {}
        for r in rows:
            doc = r.get("document") or {}
            k = f"{(doc.get('key') if isinstance(doc, dict) else '') or '?'} / {gs_key(r)}"
            keys[k] = keys.get(k, 0) + 1
        print("  document / gamesystem keys:")
        for k, n in sorted(keys.items(), key=lambda kv: -kv[1]):
            print(f"    {k:<34} {n}")

        # The 2024 SRD record, not whichever the API happened to return first. The first pass showed
        # an Adventurer's Guide entry, which says nothing about the ruleset being targeted.
        srd = [r for r in rows if gs_key(r) == "5e-2024"]
        if not srd:
            print("  (no 5e-2024 records here)")
            continue
        base = [r for r in srd if not r.get("subclass_of")]
        print(f"\n  5e-2024: {len(srd)} records, {len(base)} of them base (no subclass_of)")
        rec = (base or srd)[0]
        print(f"  sample: {rec.get('name')}")
        for k, v in rec.items():
            print(f"    {k}: {describe(v, 0, 2)}")

        # gained_at is the level placement and data_for_class_table is the per-level table. Both
        # decide whether a Class tab can be built from this at all, so print them in full.
        feats = rec.get("features") or []
        if feats:
            print(f"\n  first feature of {rec.get('name')}, in full:")
            print(json.dumps(feats[0], indent=4)[:1400])
            withtable = [f for f in feats if f.get("data_for_class_table")]
            print(f"\n  features carrying data_for_class_table: {len(withtable)} of {len(feats)}")
            if withtable:
                print(json.dumps(withtable[0].get("data_for_class_table"), indent=4)[:700])
            types = {}
            for f in feats:
                t = f.get("feature_type") or "?"
                types[t] = types.get(t, 0) + 1
            print(f"  feature_type values: {types}")

    print("\nNothing was written. Send this and the 2024 mapper can be written against it.")
    return 0


# ---------------------------------------------------------------- Open5e 2024 mapping
#
# WHAT THIS BUYS, MEASURED FROM THE LIVE API RATHER THAN HOPED FOR
#   CLASSES  12 base + 12 subclasses under srd-2024, each with features carrying `gained_at`
#            (structured LEVELS) and `data_for_class_table` (the progression columns: proficiency
#            bonus, rage count, sneak attack dice). The app has neither today, and classes-2024.json
#            additionally suffers OCR table bleed. Clear win.
#   SPECIES  9 records with TYPED traits ({name, desc, type: "SIZE"}), which beats an untyped blob.
#   BACKGROUNDS and FEATS are NOT fetched: srd-2024 carries 4 and 17 of them, against the 123 and
#            223 already in the repo. Pulling those would be a downgrade dressed as an update.
#
# WHAT IT DOES NOT BUY, AND THIS IS THE IMPORTANT ONE
#   Choices are still PROSE. "You gain the Ability Score Improvement feat ... or another feat of
#   your choice" is a desc string, not an option list. The 2014 5e-bits data has real Choice objects
#   for proficiencies and equipment; the 2024 SRD as published here does not. So a 2024 Class tab
#   gets correct level placement and a correct class table, and its CHOICES still have to be
#   authored by hand.

def o5e_levels(feature: dict) -> list:
    """Levels a feature is gained at, sorted. The API returns them unordered - Barbarian's ASI
    arrives as 12, 16, 4, 8 - and a level roster built from that reads as nonsense."""
    out = []
    for g in feature.get("gained_at") or []:
        lv = (g or {}).get("level")
        if isinstance(lv, int):
            out.append(lv)
    return sorted(set(out))


def map_o5e_class(c: dict, all_rows: list) -> dict:
    key = c.get("key")
    feats = c.get("features") or []

    # A feature can be gained at several levels (ASI at 4/8/12/16), so one record becomes several
    # roster entries rather than being filed under whichever level happened to be first.
    by_level: dict[int, list] = {}
    table_cols: list = []
    for f in feats:
        ftype = f.get("feature_type") or ""
        if f.get("data_for_class_table"):
            table_cols.append({
                "name": f.get("name"),
                "type": ftype,
                "by_level": {
                    str(d.get("level")): d.get("column_value")
                    for d in f.get("data_for_class_table") or []
                    if isinstance(d, dict) and d.get("level") is not None
                },
            })
        if ftype not in ("CLASS_LEVEL_FEATURE", ""):
            continue          # table rows are columns, not features you gain
        for lv in o5e_levels(f):
            by_level.setdefault(lv, []).append({
                "name": f.get("name"),
                "desc": f.get("desc") or "",
                # Prose, flagged. The UI can show a picker where this is False and the rules text
                # where it is True, rather than silently rendering an empty list.
                "choice_is_prose": bool(
                    f.get("desc") and any(w in (f.get("desc") or "").lower()
                                          for w in ("of your choice", "choose "))),
            })

    hp = c.get("hit_points") or {}
    return {
        "name": c.get("name"),
        "key": key,
        "edition": "2024",
        "source": ((c.get("document") or {}).get("key")),
        "hit_dice": c.get("hit_dice") or hp.get("hit_dice"),
        "hit_points_at_1st_level": hp.get("hit_points_at_1st_level"),
        "hit_points_at_higher_levels": hp.get("hit_points_at_higher_levels"),
        "caster_type": c.get("caster_type"),
        "primary_abilities": [ref_name(a) for a in (c.get("primary_abilities") or [])],
        "saving_throws": [ref_name(a) for a in (c.get("saving_throws") or [])],
        "subclasses": [
            {"name": r.get("name"), "key": r.get("key")}
            for r in all_rows if ((r.get("subclass_of") or {}) or {}).get("key") == key
        ],
        "features_by_level": [
            {"level": lv, "features": by_level[lv]} for lv in sorted(by_level)
        ],
        # The progression table, which the app has no equivalent of at all.
        "class_table": table_cols,
    }


def map_o5e_species(sp: dict) -> dict:
    traits = sp.get("traits") or []
    typed = {}
    for t in traits:
        ty = (t.get("type") or "").upper()
        if ty:
            typed.setdefault(ty, []).append(t.get("desc") or "")
    return {
        "name": sp.get("name"),
        "key": sp.get("key"),
        "edition": "2024",
        "source": ((sp.get("document") or {}).get("key")),
        "is_subspecies": bool(sp.get("is_subspecies")),
        "subspecies_of": ((sp.get("subspecies_of") or {}) or {}).get("name"),
        # Kept BOTH ways: the ordered list for display, and a type index because SIZE and SPEED are
        # the two the derivation engine actually needs to read.
        "traits": [
            {"name": t.get("name"), "desc": t.get("desc") or "",
             "type": t.get("type") or "", "order": t.get("order")}
            for t in traits
        ],
        "by_type": typed,
    }


def open5e_write(outdir: str) -> int:
    def gs(r):
        doc = r.get("document") or {}
        return (((doc.get("gamesystem") or {}) or {}).get("key") or "") if isinstance(doc, dict) else ""

    print("Fetching Open5e classes ...")
    classes_all = o5e_all("/v2/classes/")
    print("Fetching Open5e species ...")
    species_all = o5e_all("/v2/species/")

    c24 = [r for r in classes_all if gs(r) == "5e-2024"]
    base = [r for r in c24 if not r.get("subclass_of")]
    subs = [r for r in c24 if r.get("subclass_of")]
    s24 = [r for r in species_all if gs(r) == "5e-2024"]

    classes = [map_o5e_class(c, c24) for c in base]
    subclasses = [map_o5e_class(c, c24) for c in subs]
    species = [map_o5e_species(r) for r in s24]

    os.makedirs(outdir, exist_ok=True)
    targets = [
        (os.path.join(outdir, "classes-2024-structured.json"), classes),
        (os.path.join(outdir, "subclasses-2024-structured.json"), subclasses),
        (os.path.join(outdir, "species-2024-structured.json"), species),
    ]
    for path, payload in targets:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=1, ensure_ascii=False)
        print(f"  wrote {path}  ({len(payload)} records, {os.path.getsize(path) // 1024} KB)")

    withtable = sum(1 for c in classes if c["class_table"])
    prose = sum(1 for c in classes for lv in c["features_by_level"]
                for f in lv["features"] if f["choice_is_prose"])
    print(f"\n  classes with a progression table : {withtable} of {len(classes)}")
    print(f"  feature entries whose choice is PROSE : {prose}")
    print("    ^ these still need authoring; the 2024 SRD publishes no option lists")
    print("\n  Backgrounds and feats deliberately NOT fetched: srd-2024 has 4 and 17,")
    print("  against 123 and 223 already in lib/srd. Pulling them would be a downgrade.")
    print("\n  Nothing existing was overwritten.")
    return 0

# --------------------------------------------------------------------------- mapping
#
# WRITTEN FROM THE DOCUMENTATION, NOT FROM THE DATA. Run --inspect first and correct anything that
# does not match. Every function below is deliberately defensive: it returns an empty structure
# rather than raising, so one unexpected shape does not lose the whole fetch.

def ref_name(o) -> str:
    if isinstance(o, dict):
        return o.get("name") or o.get("index") or ""
    return str(o or "")


def map_choice(ch: dict) -> dict | None:
    """
    One choice: how many, from what. Flattened to names because the Forge stores names, not indexes.
    Anything whose option set is not a plain array (nested choices, "all of type X") is kept with its
    description and an empty option list, so the UI can show the rule and fall back to prose rather
    than silently dropping it.
    """
    if not isinstance(ch, dict):
        return None
    frm = ch.get("from") or {}
    opts = []
    if isinstance(frm, dict) and frm.get("option_set_type") == "options_array":
        for o in frm.get("options") or []:
            if not isinstance(o, dict):
                continue
            item = o.get("item") or o.get("of") or {}
            n = ref_name(item)
            if n:
                opts.append(n)
    return {
        "desc": ch.get("desc") or "",
        "choose": ch.get("choose"),
        "type": ch.get("type") or "",
        "options": opts,
        # True when we could not flatten it, so the UI knows to show prose instead of an empty picker.
        "unstructured": bool(frm) and not opts,
    }


def map_class(c: dict, levels: list, features: list) -> dict:
    idx = c.get("index")
    by_level: dict[int, list] = {}
    for f in features:
        if (f.get("class") or {}).get("index") != idx or f.get("subclass"):
            continue
        lvl = f.get("level")
        if not isinstance(lvl, int):
            continue
        spec = f.get("feature_specific") or {}
        # Confirmed key from the live data: expertise_options (Bard L3/L10, Rogue). The others are
        # the documented siblings; taking them all costs nothing and missing one costs a picker.
        sub = (spec.get("subfeature_options") or spec.get("expertise_options")
               or spec.get("invocations") or spec.get("terrain_type_options")
               or spec.get("enemy_type_options"))
        by_level.setdefault(lvl, []).append({
            "name": f.get("name"),
            "desc": " ".join(f.get("desc") or []),
            # THE PART THAT DOES NOT EXIST TODAY: a feature that branches carries its branches.
            "choice": map_choice(sub) if isinstance(sub, dict) else None,
        })

    prog = []
    for lv in levels:
        if (lv.get("class") or {}).get("index") != idx or lv.get("subclass"):
            continue
        prog.append({
            "level": lv.get("level"),
            "prof_bonus": lv.get("prof_bonus"),
            "features": [ref_name(x) for x in (lv.get("features") or [])],
            "class_specific": lv.get("class_specific") or {},
            "spellcasting": lv.get("spellcasting") or None,
        })
    prog.sort(key=lambda x: x.get("level") or 0)

    return {
        "name": c.get("name"),
        "index": idx,
        "edition": "2014",
        "hit_die": c.get("hit_die"),
        "saving_throws": [ref_name(s) for s in (c.get("saving_throws") or [])],
        "proficiencies": [ref_name(p) for p in (c.get("proficiencies") or [])],
        # The structured skill/tool picks that were prose before.
        "proficiency_choices": [m for m in (map_choice(x) for x in (c.get("proficiency_choices") or [])) if m],
        "starting_equipment": [
            {"item": ref_name(e.get("equipment")), "quantity": e.get("quantity")}
            for e in (c.get("starting_equipment") or []) if isinstance(e, dict)
        ],
        "starting_equipment_options": [
            m for m in (map_choice(x) for x in (c.get("starting_equipment_options") or [])) if m
        ],
        "subclasses": [ref_name(s) for s in (c.get("subclasses") or [])],
        "spellcasting_ability": ref_name((c.get("spellcasting") or {}).get("spellcasting_ability")),
        "features_by_level": [
            {"level": lv, "features": by_level[lv]} for lv in sorted(by_level)
        ],
        "progression": prog,
    }


def map_subclass(sc: dict, features: list) -> dict:
    """
    SRD 5.1 carries exactly ONE subclass per class - Berserker, Champion, Life Domain and so on.
    That is the SRD's limit, not the API's, and the app's own subclasses.json already lists 189
    including partnered content. So this is mapped for its FEATURE TEXT and level placement rather
    than for the roster.
    """
    idx = sc.get("index")
    by_level: dict[int, list] = {}
    for f in features:
        if (f.get("subclass") or {}).get("index") != idx:
            continue
        lvl = f.get("level")
        if not isinstance(lvl, int):
            continue
        spec = f.get("feature_specific") or {}
        sub = (spec.get("subfeature_options") or spec.get("expertise_options")
               or spec.get("invocations") or spec.get("terrain_type_options")
               or spec.get("enemy_type_options"))
        by_level.setdefault(lvl, []).append({
            "name": f.get("name"),
            "desc": " ".join(f.get("desc") or []),
            "choice": map_choice(sub) if isinstance(sub, dict) else None,
        })
    return {
        "name": sc.get("name"),
        "index": idx,
        "class": ref_name(sc.get("class")),
        "flavor": sc.get("subclass_flavor") or "",
        "desc": " ".join(sc.get("desc") or []),
        "edition": "2014",
        "features_by_level": [{"level": lv, "features": by_level[lv]} for lv in sorted(by_level)],
    }


def map_race(r: dict, subraces: list, traits: list) -> dict:
    tr_by_index = {t.get("index"): t for t in traits if isinstance(t, dict)}

    def trait_list(items):
        out = []
        for t in items or []:
            full = tr_by_index.get((t or {}).get("index")) or {}
            out.append({"name": ref_name(t), "desc": " ".join(full.get("desc") or [])})
        return out

    subs = []
    for s in subraces:
        if (s.get("race") or {}).get("index") != r.get("index"):
            continue
        subs.append({
            "name": s.get("name"),
            "desc": s.get("desc") or "",
            "ability_bonuses": [
                {"ability": ref_name(b.get("ability_score")), "bonus": b.get("bonus")}
                for b in (s.get("ability_bonuses") or []) if isinstance(b, dict)
            ],
            "traits": trait_list(s.get("racial_traits")),
        })

    return {
        "name": r.get("name"),
        "index": r.get("index"),
        "edition": "2014",
        "size": r.get("size"),
        "speed": r.get("speed"),
        "ability_bonuses": [
            {"ability": ref_name(b.get("ability_score")), "bonus": b.get("bonus")}
            for b in (r.get("ability_bonuses") or []) if isinstance(b, dict)
        ],
        # Half-elf's "+1 to two of your choice" and friends: a real picker rather than a footnote.
        "ability_bonus_options": map_choice(r.get("ability_bonus_options")) if r.get("ability_bonus_options") else None,
        "starting_proficiencies": [ref_name(p) for p in (r.get("starting_proficiencies") or [])],
        "starting_proficiency_options": map_choice(r.get("starting_proficiency_options")) if r.get("starting_proficiency_options") else None,
        "languages": [ref_name(l) for l in (r.get("languages") or [])],
        "language_options": map_choice(r.get("language_options")) if r.get("language_options") else None,
        "traits": trait_list(r.get("traits")),
        "subraces": subs,
    }


def write_json(outdir: str) -> int:
    data = {k: fetch(k) for k in WANT}

    classes = [map_class(c, data["levels"], data["features"]) for c in data["classes"]]
    subclasses = [map_subclass(sc, data["features"]) for sc in data["subclasses"]]
    races = [map_race(r, data["subraces"], data["traits"]) for r in data["races"]]

    # The features that ASK for a choice in prose but carry no structure. This is the hand-authoring
    # surface, and writing it out is the point: a number in a console scrolls away, a file can be
    # worked through. Sorted by class then level so it reads like a to-do list.
    import re as _re
    prose = []
    for f in data["features"]:
        if f.get("feature_specific"):
            continue
        text = " ".join(f.get("desc") or [])
        if not _re.search(r"\bchoose\b|\byour choice\b|\bone of the following\b|\bselect\b", text, _re.I):
            continue
        prose.append({
            "class": ref_name(f.get("class")),
            "subclass": ref_name(f.get("subclass")) or None,
            "level": f.get("level"),
            "name": f.get("name"),
            "desc": text,
        })
    prose.sort(key=lambda x: (x["class"], x["level"] or 0, x["name"] or ""))

    os.makedirs(outdir, exist_ok=True)
    # NEW filenames on purpose. These do NOT overwrite classes-2014.json or species-2014.json, which
    # the Forge already reads: a fetch that quietly replaced live data with a mapper nobody had
    # verified is exactly the kind of change that is hard to notice and hard to undo.
    targets = [
        (os.path.join(outdir, "classes-2014-structured.json"), classes),
        (os.path.join(outdir, "subclasses-2014-structured.json"), subclasses),
        (os.path.join(outdir, "species-2014-structured.json"), races),
        (os.path.join(outdir, "class-choices-to-author.json"), prose),
    ]
    for path, payload in targets:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=1, ensure_ascii=False)
        print(f"  wrote {path}  ({len(payload)} records, {os.path.getsize(path) // 1024} KB)")

    structured = sum(
        1 for c in classes for lv in c["features_by_level"] for f in lv["features"] if f.get("choice")
    )
    print(f"\n  class features carrying a STRUCTURED choice: {structured}")
    print(f"  classes with structured proficiency choices : "
          f"{sum(1 for c in classes if c['proficiency_choices'])} of {len(classes)}")
    print(f"  races with an ability-bonus choice          : "
          f"{sum(1 for r in races if r['ability_bonus_options'])} of {len(races)}")
    print(f"  prose-only choices still needing authoring  : {len(prose)}")
    print("    -> class-choices-to-author.json, sorted by class and level")
    print("\n  Nothing existing was overwritten. Diff these against the current files before wiring them in.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Fetch structured SRD 5.1 class and species data.")
    ap.add_argument("--discover", action="store_true", help="just list the repo and resolve paths")
    ap.add_argument("--open5e", metavar="DIR",
                    help="fetch the 2024 SRD classes and species from Open5e into DIR")
    ap.add_argument("--open5e-inspect", action="store_true",
                    help="probe Open5e for 2024/SRD 5.2 class and species data, write nothing")
    ap.add_argument("--inspect", action="store_true", help="print the real shapes and write nothing")
    ap.add_argument("--json", metavar="DIR", help="write app-shaped files into DIR (e.g. lib/srd)")
    args = ap.parse_args()

    if args.open5e:
        return open5e_write(args.open5e)
    if args.open5e_inspect:
        return open5e_inspect()
    if args.discover:
        discover(verbose=True)
        return 0
    if args.inspect:
        discover(verbose=True)
        return inspect()
    if args.json:
        return write_json(args.json)
    ap.print_help()
    print("\nRun --inspect first. The mapper was written from documentation, not from the data.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
