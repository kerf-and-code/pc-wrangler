// Runs in the MAIN world on D&D Beyond pages. This is the only world that can
// read Beyond20's CustomEvent.detail (an isolated content script gets null).
// It listens for Beyond20's roll events, normalizes them into the exact shape
// /api/vtt/ingest expects, and window.postMessage's them to content.js (the
// isolated relay), which forwards them to the service worker.
//
// The normalizers below are a verbatim port of components/table-tap.tsx so that
// extension rolls parse identically to tab-captured rolls. If you change the
// normalization in Table Tap, change it here too.

(function () {
  if (window.__sixAxesHookLoaded) return;
  window.__sixAxesHookLoaded = true;

  var EVENT_TYPES = new Set([
    "to-hit",
    "damage",
    "saving-throw",
    "skill",
    "ability",
    "initiative",
    "death-save",
    "hp-update",
    "conditions",
    "combat",
    "custom",
    "other",
  ]);

  function mapRollType(t) {
    var s = typeof t === "string" ? t : "";
    if (EVENT_TYPES.has(s)) return s;
    if (s === "attack" || s === "spell-attack") return "to-hit";
    if (s === "hit-dice") return "other";
    if (s === "digital-dice") return "other";
    return "other";
  }

  function extractDice(roll) {
    var dice = [];
    var modifier = 0;
    var sign = 1;
    var parts = Array.isArray(roll && roll.parts) ? roll.parts : [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (typeof part === "string") {
        sign = part.trim() === "-" ? -1 : 1;
      } else if (typeof part === "number") {
        modifier += sign * part;
        sign = 1;
      } else if (part && typeof part === "object" && Array.isArray(part.rolls)) {
        var results = [];
        for (var j = 0; j < part.rolls.length; j++) {
          var r = part.rolls[j];
          if (r && typeof r.roll === "number") results.push(r.roll);
        }
        dice.push({ faces: typeof part.faces === "number" ? part.faces : null, results: results });
      }
    }
    return { dice: dice, modifier: modifier };
  }

  function characterState(ch) {
    if (!ch || typeof ch !== "object") return null;
    return {
      hp: ch.hp != null ? ch.hp : null,
      max_hp: ch["max-hp"] != null ? ch["max-hp"] : null,
      temp_hp: ch["temp-hp"] != null ? ch["temp-hp"] : null,
      conditions: Array.isArray(ch.conditions) ? ch.conditions : [],
      exhaustion: ch.exhaustion != null ? ch.exhaustion : null,
    };
  }

  // Turn one Beyond20 RenderedRoll payload into zero or more normalized events.
  function normalizeRenderedRoll(payload) {
    var req = payload && payload.request;
    var ch = req && req.character;
    var isMonster = ch && ch.type && ch.type !== "Character";
    var ddbId = !isMonster && ch && ch.id ? String(ch.id).slice(0, 64) : null;
    var actor = ch && ch.name ? String(ch.name).slice(0, 200) : null;
    var fidelity = payload && payload.rendered === "fallback" ? "unverified" : "canonical";
    var rolledAt = new Date().toISOString();
    var name = (req && req.name) || (payload && payload.title) || null;
    var state = characterState(ch);
    var events = [];

    var attackRolls = Array.isArray(payload && payload.attack_rolls) ? payload.attack_rolls : [];
    for (var a = 0; a < attackRolls.length; a++) {
      var aroll = attackRolls[a];
      if (!aroll || typeof aroll !== "object") continue;
      var aex = extractDice(aroll);
      var type = mapRollType(aroll.type);
      var isD20 =
        type === "to-hit" ||
        type === "saving-throw" ||
        type === "skill" ||
        type === "ability" ||
        type === "initiative" ||
        type === "death-save";
      events.push({
        source: "beyond20",
        ddb_character_id: ddbId,
        actor_name: actor,
        event_type: type,
        name: name ? String(name).slice(0, 200) : null,
        fidelity: fidelity,
        rolled_at: rolledAt,
        rolls: {
          formula: aroll.formula != null ? aroll.formula : null,
          total: aroll.total != null ? aroll.total : null,
          modifier: aex.modifier,
          dice: aex.dice,
          advantage: req && req.advantage != null ? req.advantage : 0,
          discarded: aroll.discarded === true,
          critical_success: isD20 ? aroll["critical-success"] === true : null,
          critical_failure: isD20 ? aroll["critical-failure"] === true : null,
        },
        state: state,
      });
    }

    var damageRolls = Array.isArray(payload && payload.damage_rolls) ? payload.damage_rolls : [];
    for (var d = 0; d < damageRolls.length; d++) {
      var entry = damageRolls[d];
      var label = Array.isArray(entry) ? entry[0] : null;
      var droll = Array.isArray(entry) ? entry[1] : entry;
      if (!droll || typeof droll !== "object") continue;
      var dex = extractDice(droll);
      events.push({
        source: "beyond20",
        ddb_character_id: ddbId,
        actor_name: actor,
        event_type: "damage",
        name: name ? String(name).slice(0, 200) : null,
        fidelity: fidelity,
        rolled_at: rolledAt,
        rolls: {
          formula: droll.formula != null ? droll.formula : null,
          total: droll.total != null ? droll.total : null,
          modifier: dex.modifier,
          dice: dex.dice,
          damage_type: typeof label === "string" ? label.replace(/ Damage$/i, "") : null,
        },
        state: state,
      });
    }

    // Item and description cards carry no rolls; skip them.
    return events;
  }

  function post(events) {
    if (!Array.isArray(events) || events.length === 0) return;
    try {
      window.postMessage({ __sixaxes: true, kind: "events", events: events }, window.location.origin);
    } catch (e) {
      // ignore
    }
  }

  // Mirror Table Tap's listener helper: Beyond20 events name their args in
  // event.detail (an array), spread into the callback.
  function listen(name, cb) {
    document.addEventListener(
      "Beyond20_" + name,
      function (evt) {
        var detail = (evt && evt.detail) || [];
        cb.apply(null, detail);
      },
      false
    );
  }

  listen("Loaded", function () {
    try {
      window.postMessage({ __sixaxes: true, kind: "loaded" }, window.location.origin);
    } catch (e) {}
  });
  listen("NewSettings", function () {
    try {
      window.postMessage({ __sixaxes: true, kind: "loaded" }, window.location.origin);
    } catch (e) {}
  });

  listen("RenderedRoll", function (payload) {
    post(normalizeRenderedRoll(payload));
  });

  listen("UpdateHP", function (request, name, hp, maxHp, tempHp) {
    var ch = request && request.character;
    post([
      {
        source: "beyond20",
        ddb_character_id: ch && ch.id ? String(ch.id).slice(0, 64) : null,
        actor_name: typeof name === "string" ? name.slice(0, 200) : null,
        event_type: "hp-update",
        name: null,
        fidelity: "canonical",
        rolled_at: new Date().toISOString(),
        rolls: null,
        state: { hp: hp != null ? hp : null, max_hp: maxHp != null ? maxHp : null, temp_hp: tempHp != null ? tempHp : null },
      },
    ]);
  });

  listen("UpdateConditions", function (request, name, conditions, exhaustion) {
    var ch = request && request.character;
    post([
      {
        source: "beyond20",
        ddb_character_id: ch && ch.id ? String(ch.id).slice(0, 64) : null,
        actor_name: typeof name === "string" ? name.slice(0, 200) : null,
        event_type: "conditions",
        name: null,
        fidelity: "canonical",
        rolled_at: new Date().toISOString(),
        rolls: null,
        state: {
          conditions: Array.isArray(conditions) ? conditions : [],
          exhaustion: exhaustion != null ? exhaustion : null,
        },
      },
    ]);
  });
})();
