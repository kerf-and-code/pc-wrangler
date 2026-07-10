// Service worker: receives normalized Six Axes events from the content-script
// relay and POSTs them to the ingest endpoint. Runs with host_permissions, so
// the cross-origin POST to pc-wrangler is not CORS-blocked.
//
// It also records any unmatched DDB character ids the server reports (rolls that
// came in for a character not yet linked), paired with the actor name from the
// batch, into chrome.storage.local under "unmatched". The popup reads that to
// offer a self-link picker.

const INGEST = "https://pc-wrangler.vercel.app/api/vtt/ingest";
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "six-axes-events") return;

  const events = Array.isArray(msg.events) ? msg.events : [];
  if (events.length === 0) {
    sendResponse({ ok: false, error: "No events in message." });
    return; // synchronous response, channel can close
  }

  chrome.storage.sync.get(["shareCode"], async (cfg) => {
    const share = (cfg && cfg.shareCode) || "";
    if (!share) {
      sendResponse({ ok: false, error: "No share code set. Open the extension and paste your table code." });
      return;
    }

    const batch = events.slice(0, MAX_EVENTS_PER_BATCH);
    try {
      const res = await fetch(INGEST, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share_code: share, events: batch }),
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
