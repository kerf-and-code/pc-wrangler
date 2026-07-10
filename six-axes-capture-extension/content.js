// Runs in the ISOLATED world on D&D Beyond pages. It cannot read Beyond20's
// event detail directly (that is why page-hook.js runs in the MAIN world), so
// its only job is to receive already-normalized events from page-hook.js via
// window.postMessage and forward them to the service worker, which POSTs them
// to the Six Axes ingest endpoint.

(function () {
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
