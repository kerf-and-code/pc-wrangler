// Service worker: receives normalized Six Axes events from the content-script
// relay and POSTs them to the ingest endpoint. Runs with host_permissions, so
// the cross-origin POST to pc-wrangler is not CORS-blocked.
//
// It sends the player's full set of saved campaign codes; the server routes each
// roll to whichever of those campaigns is live and has the character. It also
// records any unmatched DDB character ids the server reports (rolls for a character
// not yet linked), paired with the actor name from the batch, into
// chrome.storage.local under "unmatched". The popup reads that to offer a self-link
// picker across all the player's campaigns.
//
// 2.4.0 (push 38): Roll20. Reading the Roll20 chat needs access to app.roll20.net, which is an OPTIONAL
// permission: nobody who only uses D&D Beyond is asked for it, and the store update does not disable
// the extension for them. The popup's "Turn on Roll20" asks for it; this worker then registers
// roll20.js on Roll20 game pages, and takes it away again if the permission is removed. Roll20 events
// arrive through the same "six-axes-events" message as Beyond20's.
//
// 2.3.0 (audit B12): it also sends the roll keys saved per table code ("ingestKeys", handed over on
// the table link page). A key proves the rolls are this player's, so the server counts them as
// verified; without one they still arrive, as unverified.

// The canonical host. The old vercel.app address still resolves and redirects, but a redirect on
// a cross-origin POST is not free: the browser re-issues it as a preflight against the new origin,
// so pointing straight at the real host avoids a round trip on every batch.
const INGEST = "https://www.six-axes.com/api/vtt/ingest";
const MAX_EVENTS_PER_BATCH = 50; // server rejects larger batches with 400

function recordUnmatched(batch, unmatchedIds) {
  if (!Array.isArray(unmatchedIds) || unmatchedIds.length === 0) return;
  const nameById = {};
  for (const e of batch) {
    if (e && e.ddb_character_id && e.actor_name) nameById[e.ddb_character_id] = e.actor_name;
  }
  chrome.storage.local.get(["unmatched"], (st) => {
    const map = (st && st.unmatched) || {};
    for (const id of unmatchedIds) {
      if (!id) continue;
      map[id] = nameById[id] || map[id] || null;
    }
    chrome.storage.local.set({ unmatched: map });
  });
}

// ---- Roll20 (2.4.0) ----
const ROLL20_ORIGINS = ["https://app.roll20.net/*"];
const ROLL20_SCRIPT = "sixaxes-roll20";
async function syncRoll20() {
  try {
    const has = await chrome.permissions.contains({ origins: ROLL20_ORIGINS });
    const reg = await chrome.scripting.getRegisteredContentScripts({ ids: [ROLL20_SCRIPT] });
    if (has && reg.length === 0) {
      await chrome.scripting.registerContentScripts([{
        id: ROLL20_SCRIPT, matches: ["https://app.roll20.net/editor*"], js: ["roll20.js"], runAt: "document_idle", persistAcrossSessions: true,
      }]);
      console.log("[Six Axes] Roll20 capture on");
    } else if (!has && reg.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [ROLL20_SCRIPT] });
      console.log("[Six Axes] Roll20 capture off");
    }
  } catch (e) {
    console.log("[Six Axes] Roll20 setup", String(e));
  }
}
chrome.runtime.onInstalled.addListener(syncRoll20);
chrome.runtime.onStartup.addListener(syncRoll20);
chrome.permissions.onAdded.addListener(syncRoll20);
chrome.permissions.onRemoved.addListener(syncRoll20);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "six-axes-roll20-sync") {
    syncRoll20().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (!msg || msg.type !== "six-axes-events") return;

  const events = Array.isArray(msg.events) ? msg.events : [];
  if (events.length === 0) {
    sendResponse({ ok: false, error: "No events in message." });
    return; // synchronous response, channel can close
  }

  chrome.storage.sync.get(["shareCodes", "shareCode", "ingestKeys"], async (cfg) => {
    // Prefer the saved set; fall back to a legacy single code.
    let codes = Array.isArray(cfg && cfg.shareCodes) ? cfg.shareCodes.filter(Boolean) : [];
    if (codes.length === 0 && cfg && cfg.shareCode) codes = [cfg.shareCode];
    if (codes.length === 0) {
      sendResponse({ ok: false, error: "No campaigns saved. Open the extension and add your table code." });
      return;
    }

    const keyMap = (cfg && cfg.ingestKeys && typeof cfg.ingestKeys === "object") ? cfg.ingestKeys : {};
    const keys = codes.map((c) => keyMap[c]).filter((k) => typeof k === "string" && k);

    const batch = events.slice(0, MAX_EVENTS_PER_BATCH);
    try {
      const res = await fetch(INGEST, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share_codes: codes, keys, events: batch }),
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (res.ok && data) recordUnmatched(batch, data.unmatched_ddb_ids);
      // Logged so you can watch it in the service-worker console during testing.
      console.log("[Six Axes] ingest", res.status, data);
      sendResponse({ ok: res.ok, status: res.status, data });
    } catch (e) {
      console.log("[Six Axes] ingest error", String(e));
      sendResponse({ ok: false, error: String(e) });
    }
  });

  return true; // keep the message channel open for the async response
});
