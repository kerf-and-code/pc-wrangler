// Service worker: receives normalized Six Axes events from the content-script
// relay and POSTs them to the ingest endpoint. Runs with host_permissions, so
// the cross-origin POST to pc-wrangler is not CORS-blocked.
//
// Contract: page-hook.js (MAIN world) normalizes Beyond20 rolls into the exact
// shape /api/vtt/ingest expects, matching components/table-tap.tsx. content.js
// (isolated) relays them here as:
//   { type: "six-axes-events", events: [ ...normalized events ] }
// This worker only attaches the share code and ships the batch. It does NOT
// normalize, because the server does not either.

const INGEST = "https://pc-wrangler.vercel.app/api/vtt/ingest";
const MAX_EVENTS_PER_BATCH = 50; // server rejects larger batches with 400

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
      // Logged so you can watch it in the service-worker console during section 8.
      console.log("[Six Axes] ingest", res.status, data);
      sendResponse({ ok: res.ok, status: res.status, data });
    } catch (e) {
      console.log("[Six Axes] ingest error", String(e));
      sendResponse({ ok: false, error: String(e) });
    }
  });

  return true; // keep the message channel open for the async response
});
