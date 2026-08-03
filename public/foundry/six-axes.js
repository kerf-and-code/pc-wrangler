/**
 * six-axes.js — a Foundry VTT module that sends rolls to Six Axes.
 *
 * WHAT IT SENDS, AND WHAT IT DOES NOT
 *   Rolls only: the dice, their faces, the total, and what the roll was for. It does not read chat
 *   text, character sheets, journal entries, tokens or audio. That is not a limitation to work
 *   around later; a table letting a module watch their game deserves a boundary they can state in
 *   one sentence, and "it sees dice" is that sentence.
 *
 * WHY THIS IS A MODULE AND NOT A BOT
 *   Foundry's audio is WebRTC peer-to-peer. There is no server-side mix to join the way a Discord
 *   bot joins a voice channel, so there is no equivalent of the Six Axes sidecar here. Rolls are
 *   also the part Foundry does BEST and the part no competitor captures, so they come first.
 *
 * IT REUSES THE EXISTING PIPELINE ENTIRELY
 *   POST /api/vtt/ingest already accepts { share_codes, events } authenticated by campaign share
 *   code, already allows source "foundry", and already routes an event to whichever of the held
 *   campaigns has a live session. Nothing server-side had to be built for this.
 *
 * ATTRIBUTION, AND ONE HONEST WART
 *   Six Axes links an external character to one of its own through characters.ddb_character_id, and
 *   /api/vtt/self-link is the page that writes it. That column is named for D&D Beyond because that
 *   is what needed it first, but the mechanism is general: an outside system's character id mapped
 *   to a Six Axes character. So this module sends the FOUNDRY ACTOR ID in that field and the whole
 *   linking flow works unchanged.
 *
 *   The column name now lies slightly. That is a real cost and worth renaming one day; it is not
 *   worth a schema migration and a second code path today to avoid.
 */

const MODULE = "six-axes";
const DEFAULT_ENDPOINT = "https://www.six-axes.com/api/vtt/ingest";

/* -------------------------------------------------------------------------- settings */

Hooks.once("init", () => {
  game.settings.register(MODULE, "shareCode", {
    name: "Table code",
    hint: "From your GM: Table \u2192 Roster \u2192 Table Tap. Without it nothing is sent anywhere.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  game.settings.register(MODULE, "enabled", {
    name: "Send rolls to Six Axes",
    hint: "Turn off to stop sending without losing your table code.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // GM-only by default. A Foundry world already broadcasts every roll to every client, so if each
  // player also sent them, one roll would arrive five times. The GM's client sees them all and is
  // the single sender; players can opt in only if their GM is not running Foundry themselves.
  game.settings.register(MODULE, "sendAsPlayer", {
    name: "Send my rolls even when I am not the GM",
    hint: "Leave off unless your GM has told you otherwise. Normally the GM's client sends everything, and turning this on makes every roll arrive twice.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE, "endpoint", {
    name: "Endpoint",
    hint: "Only change this if you are self-hosting Six Axes.",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_ENDPOINT,
  });
});

Hooks.once("ready", () => {
  const code = (game.settings.get(MODULE, "shareCode") || "").trim();
  if (!code) {
    if (game.user.isGM) {
      ui.notifications.info("Six Axes: add your table code in Module Settings to start capturing rolls.");
    }
    return;
  }
  if (sending()) console.log(`${MODULE} | capturing rolls for this table`);
});

function sending() {
  if (!game.settings.get(MODULE, "enabled")) return false;
  if (!(game.settings.get(MODULE, "shareCode") || "").trim()) return false;
  return game.user.isGM || game.settings.get(MODULE, "sendAsPlayer");
}

/* -------------------------------------------------------------------------- capture */

Hooks.on("createChatMessage", (message) => {
  try {
    if (!sending()) return;
    const rolls = message.rolls ?? [];
    if (!rolls.length) return;
    for (const roll of rolls) queue(buildEvent(message, roll));
    schedule();
  } catch (err) {
    // A module must never break someone's session. Log and carry on.
    console.warn(`${MODULE} | could not read a roll`, err);
  }
});

/**
 * Map a Foundry Roll onto the event shape /api/vtt/ingest expects.
 *
 * The dice shape is Beyond20's - [{ faces, results: [n] }] - because that is what the Mechanics
 * page reads. Matching an existing consumer beats inventing a tidier format that nothing displays.
 */
function buildEvent(message, roll) {
  const actorId = message.speaker?.actor ?? null;
  const actor = actorId ? game.actors?.get(actorId) : null;

  const dice = (roll.dice ?? []).map((d) => ({
    faces: d.faces,
    // Only dice that COUNTED. Foundry marks a dropped or rerolled die inactive, and including them
    // would put a discarded natural 1 into the distribution as though it had happened.
    results: (d.results ?? []).filter((r) => r.active !== false).map((r) => r.result),
  })).filter((d) => Number.isFinite(d.faces) && d.results.length);

  const d20 = dice.find((d) => d.faces === 20);
  const nat = d20 && d20.results.length === 1 ? d20.results[0] : null;

  return {
    source: "foundry",
    // See the note at the top: the Foundry actor id travels in the D&D Beyond field, so the
    // existing self-link flow attributes it with no new machinery.
    ddb_character_id: actorId,
    actor_name: actor?.name ?? message.speaker?.alias ?? null,
    event_type: classify(message, roll),
    name: cleanFlavor(message.flavor) || roll.formula || null,
    // canonical: Foundry rolled these itself. No transcription, no speech recognition, no one
    // reading a die across a table.
    fidelity: "canonical",
    rolled_at: new Date(message.timestamp ?? Date.now()).toISOString(),
    rolls: {
      total: roll.total,
      dice,
      formula: roll.formula,
      critical_success: nat === 20,
      critical_failure: nat === 1,
      advantage: advantageOf(roll),
    },
  };
}

/**
 * What kind of roll this was.
 *
 * The dnd5e system tags its own messages, which is exact, so that is tried first. Flavor text is
 * the fallback for other systems and for free rolls typed into chat, and it is a guess - which is
 * why anything unrecognised lands on "other" rather than being forced into a category it might not
 * belong to. A wrong label is worse than a vague one here: "other" is honest, whereas a damage roll
 * miscounted as an attack quietly corrupts the encounter maths.
 */
function classify(message, roll) {
  const f = message.flags ?? {};
  const t = f.dnd5e?.roll?.type ?? f.dnd5e?.messageType ?? null;
  const map = {
    attack: "to-hit",
    damage: "damage",
    save: "saving-throw",
    ability: "ability",
    skill: "skill",
    death: "death-save",
    tool: "skill",
  };
  if (t && map[t]) return map[t];

  const s = `${message.flavor ?? ""} ${roll.formula ?? ""}`.toLowerCase();
  if (/initiative/.test(s)) return "initiative";
  if (/death\s*sav/.test(s)) return "death-save";
  if (/attack|to\s*hit/.test(s)) return "to-hit";
  if (/damage|healing/.test(s)) return "damage";
  if (/sav(e|ing)/.test(s)) return "saving-throw";
  if (/check|ability/.test(s)) return "skill";
  return "other";
}

/** Foundry expresses advantage as a kh/kl modifier on the d20 term. */
function advantageOf(roll) {
  const f = (roll.formula ?? "").toLowerCase();
  if (/d20[^+\-]*kh/.test(f)) return 1;
  if (/d20[^+\-]*kl/.test(f)) return -1;
  return 0;
}

function cleanFlavor(flavor) {
  if (!flavor) return null;
  // Flavor often arrives as HTML from system automation.
  const text = String(flavor).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 200) || null;
}

/* -------------------------------------------------------------------------- sending */

let pending = [];
let timer = null;

function queue(event) {
  pending.push(event);
  // A single combat round can produce a dozen rolls in a few seconds. Batching keeps that to one
  // request, and caps the queue so a runaway macro cannot fill memory.
  if (pending.length > 200) pending = pending.slice(-200);
}

function schedule() {
  if (timer) return;
  timer = setTimeout(flush, 4000);
}

async function flush() {
  timer = null;
  const events = pending;
  pending = [];
  if (!events.length) return;

  const code = (game.settings.get(MODULE, "shareCode") || "").trim().toLowerCase();
  const endpoint = (game.settings.get(MODULE, "endpoint") || DEFAULT_ENDPOINT).trim();
  if (!code) return;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share_codes: [code], events }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`${MODULE} | ingest refused ${res.status}`, body.slice(0, 300));
      // 4xx means the request itself is wrong - a bad code, no live session - and retrying will not
      // fix it. Only a network or server failure is worth another go, and only once, so a table
      // that has lost its connection does not build an unbounded backlog.
      if (res.status >= 500) requeue(events);
      else if (res.status === 401 || res.status === 403) notifyOnce(
        "Six Axes did not recognise your table code. Check Module Settings.",
      );
      return;
    }
    const out = await res.json().catch(() => ({}));
    if (out?.unmatched_ddb_ids?.length) {
      notifyOnce(
        "Six Axes captured rolls from characters it does not recognise yet. Open your table link and link them once.",
      );
    }
  } catch (err) {
    console.warn(`${MODULE} | could not reach Six Axes`, err);
    requeue(events);
  }
}

function requeue(events) {
  pending = events.concat(pending).slice(-200);
  if (!timer) timer = setTimeout(flush, 30000);
}

let notified = false;
function notifyOnce(text) {
  if (notified) return;
  notified = true;
  if (game.user.isGM) ui.notifications.warn(`Six Axes: ${text}`);
}

// Send whatever is queued before the window closes, so the last roll of the night is not lost to
// someone shutting the tab the moment combat ends.
window.addEventListener("beforeunload", () => { if (pending.length) void flush(); });
