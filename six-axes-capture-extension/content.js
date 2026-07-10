// Runs in the ISOLATED world on D&D Beyond pages. Two jobs:
//
// 1. Inject page-hook.js into the page's MAIN world by adding a script tag that
//    points at the packaged file. The isolated world cannot read Beyond20's
//    CustomEvent.detail, but a script running in the page's own world can. This
//    replaces the manifest "world": "MAIN" approach, which needs Chrome 111+ and
//    was not injecting.
//
// 2. Relay: receive the normalized events page-hook.js sends via
//    window.postMessage and forward them to the service worker, which POSTs to
//    the Six Axes ingest endpoint.

(function () {
  // --- Job 1: inject the page hook into the main world ---
  try {
    var s = document.createElement("script");
    s.src = chrome.runtime.getURL("page-hook.js");
    s.onload = function () { s.remove(); };
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    console.log("[Six Axes] failed to inject page hook", String(e));
  }

  // --- Job 2: relay normalized events from the hook to the worker ---
  window.addEventListener("message", function (event) {
    // Only trust messages from this same page, tagged by our hook.
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.__sixaxes !== true) return;

    if (data.kind === "events" && Array.isArray(data.events) && data.events.length > 0) {
      try {
        chrome.runtime.sendMessage({ type: "six-axes-events", events: data.events }, function (res) {
          if (chrome.runtime.lastError) return; // context invalidated on reload; ignore
          if (res && res.ok) {
            console.log("[Six Axes] sent " + data.events.length + " event(s), status " + res.status, res.data);
          } else if (res) {
            console.log("[Six Axes] send failed", res);
          }
        });
      } catch (e) {
        // extension context may be invalidated on reload; ignore
      }
    }
    // data.kind === "loaded" is available for a future connection indicator.
  });
})();
