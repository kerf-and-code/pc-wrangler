// Runs ONLY on the setup page: six-axes.com/x/<code>, or the older
// pc-wrangler.vercel.app/x/<code> for links pinned before the domain move. Its single job: read the
// campaign code from the URL and add it to the player's saved set of table codes in
// chrome.storage.sync, so clicking a GM's setup link never requires pasting, and a
// player in several campaigns accumulates all their codes instead of overwriting.
// Then it tells the page it succeeded so the page can show a confirmation. This is
// the only place the extension touches pc-wrangler, and it only reads a code from
// the path.
//
// 2.3.0 (audit B12): it also marks the page with data-sixaxes-capture="<version>", so the page can
// tell the extension is installed even if this script's message arrived before the page listened,
// and it accepts a roll key the page hands over after the signed-in player presses "Connect". The
// key is kept per table code in chrome.storage.sync under "ingestKeys" and sent with every batch,
// which is what lets the server count that player's rolls as verified.

(function () {
  var MAX_CODES = 20;
  var VERSION = chrome.runtime.getManifest().version;

  try { document.documentElement.setAttribute("data-sixaxes-capture", VERSION); } catch (e) { /* no DOM yet */ }

  // A roll key handed over by this page (components/roll-key.tsx). Only accepted from this window,
  // only for the code in this page's address, and only in the expected shape.
  window.addEventListener("message", function (e) {
    if (e.source !== window || e.origin !== window.location.origin) return;
    var d = e.data;
    if (!d || d.__sixaxesKey !== true) return;
    var here = codeFromPath();
    var key = typeof d.key === "string" ? d.key : "";
    if (!here || d.code !== here || key.indexOf("sxk_") !== 0 || key.length > 80) {
      window.postMessage({ __sixaxesKeySaved: true, ok: false, code: d.code }, window.location.origin);
      return;
    }
    try {
      chrome.storage.sync.get(["ingestKeys"], function (cfg) {
        var keys = (cfg && cfg.ingestKeys && typeof cfg.ingestKeys === "object") ? cfg.ingestKeys : {};
        keys[here] = key;
        chrome.storage.sync.set({ ingestKeys: keys }, function () {
          window.postMessage({ __sixaxesKeySaved: true, ok: !chrome.runtime.lastError, code: here }, window.location.origin);
        });
      });
    } catch (err) {
      window.postMessage({ __sixaxesKeySaved: true, ok: false, code: here }, window.location.origin);
    }
  });

  function codeFromPath() {
    // Expect /x/<code>. Take the segment after "x", strip query/hash noise.
    var parts = window.location.pathname.split("/").filter(Boolean); // ["x", "<code>"]
    var idx = parts.indexOf("x");
    var raw = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : "";
    return (raw || "").trim().toLowerCase().slice(0, 64);
  }

  var code = codeFromPath();
  if (!code) {
    window.postMessage({ __sixaxesLink: true, ok: false, reason: "no-code" }, window.location.origin);
    return;
  }

  try {
    chrome.storage.sync.get(["shareCodes", "shareCode"], function (cfg) {
      var list = Array.isArray(cfg && cfg.shareCodes) ? cfg.shareCodes.slice() : [];
      // Migrate a legacy single code into the list, then append this one.
      if (cfg && cfg.shareCode && list.indexOf(cfg.shareCode) === -1) list.push(cfg.shareCode);
      if (list.indexOf(code) === -1) list.push(code);
      // Dedup and cap.
      var seen = {};
      list = list.filter(function (c) { if (!c || seen[c]) return false; seen[c] = true; return true; }).slice(-MAX_CODES);

      chrome.storage.sync.set({ shareCodes: list, shareCode: code }, function () {
        if (chrome.runtime.lastError) {
          window.postMessage({ __sixaxesLink: true, ok: false, reason: "storage" }, window.location.origin);
          return;
        }
        window.postMessage({ __sixaxesLink: true, ok: true, code: code, version: VERSION }, window.location.origin);
      });
    });
  } catch (e) {
    window.postMessage({ __sixaxesLink: true, ok: false, reason: "exception" }, window.location.origin);
  }
})();
