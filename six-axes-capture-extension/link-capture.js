// Runs ONLY on https://pc-wrangler.vercel.app/x/<code>. Its single job: read the
// campaign code from the URL and add it to the player's saved set of table codes in
// chrome.storage.sync, so clicking a GM's setup link never requires pasting, and a
// player in several campaigns accumulates all their codes instead of overwriting.
// Then it tells the page it succeeded so the page can show a confirmation. This is
// the only place the extension touches pc-wrangler, and it only reads a code from
// the path.

(function () {
  var MAX_CODES = 20;

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
        window.postMessage({ __sixaxesLink: true, ok: true, code: code }, window.location.origin);
      });
    });
  } catch (e) {
    window.postMessage({ __sixaxesLink: true, ok: false, reason: "exception" }, window.location.origin);
  }
})();
