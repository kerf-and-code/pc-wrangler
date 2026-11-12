// Six Axes Capture 2.4.0 (push 38): rolls made in Roll20.
//
// Registered by background.js on app.roll20.net/editor pages once the player turns Roll20 on in the
// popup (an optional permission). It runs in the isolated world and only READS the Roll20 chat: each new
// chat message that carries a roll becomes a Six Axes event and goes to the background worker through
// the same "six-axes-events" message as Beyond20's rolls, then to /api/vtt/ingest.
//
// What it reads (from real Roll20 chat markup, November 2026):
//   /r and /roll         div.message.rollresult: the formula ("rolling d20+5"), each die in
//                        .diceroll.dNN .didroll, the total in .rolled, the speaker in .by
//   the 2024 D&D sheet   rolltemplate.dnd-2024--roll: the character in .meta__character-name, the roll
//                        in .header__title, its kind in [data-rollsubcategory] (Attack, Damage, Saving
//                        Throw, Initiative...), the total in .die__total--preferred, advantage in
//                        dnd-2024__header--Advantage / --Disadvantage, each die in the title of
//                        .rt-formula__evaluated-string ("Rolling 2d20kh1 = (5 dropped + 13)")
// What it leaves alone:
//   the default roll template (sheet-rolltemplate-default). Beyond20 posts D&D Beyond rolls that way,
//   and this extension already sends those from D&D Beyond itself, with the character's D&D Beyond id;
//   reading them here too would count every one twice.
//   chat, emotes, descriptions with no roll (rolltemplate.dnd-2024--chat), system messages.
//
// The chat history already on screen when the game opens is not sent: only messages that appear
// afterwards. Every player with the extension sees every roll, so each event carries the Roll20 message
// id and the server keeps one copy.

(function () {
  if (window.__sixAxesRoll20Loaded) return;
  window.__sixAxesRoll20Loaded = true;

  function txt(el) { return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : ""; }
  function num(s) { var n = parseInt(String(s || "").replace(/[^0-9-]/g, ""), 10); return isFinite(n) ? n : null; }

  // "Bobert Wildman(AC 17 PP 14 DC 15):" -> "Bobert Wildman"; "Bobert (GM):" stays "Bobert (GM)" for
  // the server, which drops "(GM)" itself.
  function speakerName(s) {
    var t = String(s || "").replace(/:\s*$/, "").trim();
    if (!/\(gm\)$/i.test(t)) t = t.replace(/\s*\([^)]*\)\s*$/, "").trim();
    return t.slice(0, 200) || null;
  }

  // The dice inside a Roll20 tooltip: "Rolling 2d20kh1 = (<span class="basicdiceroll dropped">5</span>+
  // <span class="basicdiceroll">13</span>)". Returns kept and dropped faces, with the die size taken from
  // the formula.
  function tooltipDice(title) {
    var t = String(title || "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    var m = /Rolling\s+([^=]+?)\s*=/.exec(t);
    var formula = m ? m[1].trim() : null;
    var faces = null;
    var fm = formula ? /\d*d(\d+)/i.exec(formula) : null;
    if (fm) faces = parseInt(fm[1], 10);
    var kept = [], dropped = [];
    var re = /<span class="([^"]*)">\s*(-?\d+)\s*<\/span>/g, x;
    while ((x = re.exec(t))) {
      var v = parseInt(x[2], 10);
      if (/dropped/.test(x[1])) dropped.push(v); else kept.push(v);
    }
    return { formula: formula, faces: faces, kept: kept, dropped: dropped };
  }

  var CATEGORY = {
    "attack": "to-hit", "damage": "damage", "healing": "other", "saving throw": "saving-throw",
    "death saving throw": "death-save", "initiative": "initiative", "ability check": "ability",
    "ability": "ability", "skill": "skill", "skill check": "skill",
  };
  function kindOf(category, title) {
    var c = String(category || "").trim().toLowerCase();
    if (CATEGORY[c]) return CATEGORY[c];
    var t = String(title || "").toLowerCase();
    if (/death sav/.test(t)) return "death-save";
    if (/saving throw|\bsave\b/.test(t)) return "saving-throw";
    if (/initiative/.test(t)) return "initiative";
    if (/damage/.test(t)) return "damage";
    if (/check/.test(t)) return "ability";
    return "other";
  }

  function base(msg, actor, kind, name, rolls) {
    return {
      source: "roll20",
      external_id: msg.getAttribute("data-messageid"),
      ddb_character_id: null,
      actor_name: actor,
      event_type: kind,
      name: name ? String(name).slice(0, 200) : null,
      // Roll20 rolls the dice on its own server; the server still stores this as unverified unless the
      // sender proves the character is theirs
      fidelity: "canonical",
      rolled_at: new Date().toISOString(),
      rolls: rolls,
      state: null,
    };
  }

  // /r 1d20+5
  function fromRollResult(msg, speaker) {
    var total = num(txt(msg.querySelector(".rolled")));
    if (total === null) return [];
    var formula = txt(msg.querySelector(".formula")).replace(/^rolling\s+/i, "") || null;
    var groups = {}, dropped = [];
    var dice = msg.querySelectorAll(".diceroll");
    for (var i = 0; i < dice.length; i++) {
      var d = dice[i];
      var fm = /\bd(\d+)\b/.exec(d.className || "");
      var faces = fm ? parseInt(fm[1], 10) : null;
      var v = num(txt(d.querySelector(".didroll")));
      if (v === null) continue;
      if (/\bdropped\b/.test(d.className || "")) { dropped.push({ faces: faces, value: v }); continue; }
      var key = String(faces);
      (groups[key] = groups[key] || { faces: faces, results: [] }).results.push(v);
    }
    var list = Object.keys(groups).map(function (k) { return groups[k]; });
    var keptSum = list.reduce(function (s, g) { return s + g.results.reduce(function (a, b) { return a + b; }, 0); }, 0);
    var lone20 = list.length === 1 && list[0].faces === 20 && list[0].results.length === 1 ? list[0].results[0] : null;
    return [base(msg, speaker, "other", formula, {
      formula: formula, total: total, modifier: total - keptSum, dice: list, dropped: dropped,
      advantage: /kh1/i.test(formula || "") ? 1 : /kl1/i.test(formula || "") ? -1 : 0,
      critical_success: lone20 === null ? null : lone20 === 20,
      critical_failure: lone20 === null ? null : lone20 === 1,
      gm_only: /\bprivate\b/.test(msg.className || ""),
      roll20: { player_id: msg.getAttribute("data-playerid"), character_id: msg.getAttribute("data-characterid") },
    })];
  }

  // the 2024 D&D sheet
  function fromDnd2024(msg, tpl, speaker) {
    if (!/dnd-2024--roll/.test(tpl.className || "")) return [];   // a description card, no roll
    var totalEl = tpl.querySelector(".die__total--preferred") || tpl.querySelector(".total__value");
    var total = num(totalEl && (totalEl.getAttribute("data-result") || txt(totalEl)));
    if (total === null) return [];
    var actor = txt(tpl.querySelector(".meta__character-name")) || speaker;
    var title = txt(tpl.querySelector(".header__title"));
    var catEl = tpl.querySelector("[data-rollsubcategory]");
    var kind = kindOf(catEl && catEl.getAttribute("data-rollsubcategory"), title);
    var header = tpl.querySelector(".dnd-2024__header");
    var hc = header ? header.className : "";
    var advantage = /--Advantage\b/.test(hc) ? 1 : /--Disadvantage\b/.test(hc) ? -1 : 0;
    var groups = {}, dropped = [], formulas = [];
    var evals = tpl.querySelectorAll(".rt-formula__evaluated-string");
    for (var i = 0; i < evals.length; i++) {
      var td = tooltipDice(evals[i].getAttribute("title") || evals[i].getAttribute("original-title"));
      if (td.formula) formulas.push(td.formula);
      if (td.faces === null) continue;
      var key = String(td.faces);
      var g = (groups[key] = groups[key] || { faces: td.faces, results: [] });
      g.results = g.results.concat(td.kept);
      for (var j = 0; j < td.dropped.length; j++) dropped.push({ faces: td.faces, value: td.dropped[j] });
    }
    var list = Object.keys(groups).map(function (k) { return groups[k]; });
    var keptSum = list.reduce(function (s, gg) { return s + gg.results.reduce(function (a, b) { return a + b; }, 0); }, 0);
    var isD20 = kind === "to-hit" || kind === "saving-throw" || kind === "skill" || kind === "ability" || kind === "initiative" || kind === "death-save";
    var d20 = groups["20"] && groups["20"].results.length === 1 ? groups["20"].results[0] : null;
    var dmgType = null;
    var br = tpl.querySelector(".header__damage-breakdown");
    if (br) dmgType = txt(br).replace(/\s*-?\d+\s*$/, "").trim() || null;
    return [base(msg, actor, kind, title, {
      formula: formulas.join(" + ") || null, total: total, modifier: total - keptSum, dice: list, dropped: dropped,
      advantage: advantage,
      critical_success: isD20 && d20 !== null ? d20 === 20 : null,
      critical_failure: isD20 && d20 !== null ? d20 === 1 : null,
      damage_type: kind === "damage" ? dmgType : null,
      roll_type: catEl ? String(catEl.getAttribute("data-rollsubcategory") || "").trim().slice(0, 32) : null,
      gm_only: /\bprivate\b/.test(msg.className || ""),
      roll20: { player_id: msg.getAttribute("data-playerid"), character_id: msg.getAttribute("data-characterid") },
    })];
  }

  /** The Six Axes events in one Roll20 chat message (none for chat, descriptions and Beyond20 cards). */
  function parseMessage(msg, speaker) {
    if (!msg || !msg.getAttribute || !msg.getAttribute("data-messageid")) return [];
    var cls = msg.className || "";
    if (/\bsystem\b|\bnews\b/.test(cls)) return [];
    if (/\brollresult\b/.test(cls)) return fromRollResult(msg, speaker);
    var tpl = msg.querySelector("rolltemplate.dnd-2024");
    if (tpl) return fromDnd2024(msg, tpl, speaker);
    return [];
  }
  // tests load this file into a page and call it directly
  window.__sixAxesRoll20Parse = parseMessage;
  window.__sixAxesRoll20Speaker = speakerName;

  // ---- watching the chat ----
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;

  var seen = new Set();
  var lastSpeaker = null;
  var queue = [];
  var timer = null;

  function speakerOf(msg) {
    var by = msg.querySelector(":scope > .by");
    if (by) lastSpeaker = speakerName(txt(by));
    return lastSpeaker;
  }
  function flush() {
    timer = null;
    while (queue.length) {
      var batch = queue.splice(0, 50);
      try {
        chrome.runtime.sendMessage({ type: "six-axes-events", events: batch }, function (res) {
          if (chrome.runtime.lastError) return;
          console.log("[Six Axes] Roll20: sent " + batch.length + " roll(s)", res && res.status, res && res.data);
        });
      } catch { /* the extension was reloaded; this page needs a reload too */ }
    }
  }
  function take(msg, send) {
    var id = msg.getAttribute && msg.getAttribute("data-messageid");
    if (!id) return;
    var speaker = speakerOf(msg);
    if (seen.has(id)) return;
    seen.add(id);
    if (!send) return;
    var events = parseMessage(msg, speaker);
    if (!events.length) return;
    queue.push.apply(queue, events);
    if (!timer) timer = setTimeout(flush, 800);
  }
  function scan(root, send) {
    if (root.matches && root.matches("[data-messageid]")) take(root, send);
    var list = root.querySelectorAll ? root.querySelectorAll("[data-messageid]") : [];
    for (var i = 0; i < list.length; i++) take(list[i], send);
  }

  function start(chat) {
    // what is on screen now is history: remember it, send nothing
    scan(chat, false);
    var obs = new MutationObserver(function (records) {
      for (var r = 0; r < records.length; r++) {
        var added = records[r].addedNodes;
        for (var a = 0; a < added.length; a++) if (added[a].nodeType === 1) scan(added[a], true);
      }
    });
    obs.observe(chat, { childList: true, subtree: true });
    console.log("[Six Axes] Roll20 capture watching the chat");
  }
  (function wait(tries) {
    var chat = document.getElementById("textchat");
    if (chat) {
      // give Roll20 a moment to finish drawing the history before treating anything as new
      setTimeout(function () { start(chat); }, 3000);
      return;
    }
    if (tries < 120) setTimeout(function () { wait(tries + 1); }, 1000);
  })(0);
})();
