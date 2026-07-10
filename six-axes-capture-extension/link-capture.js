// Runs ONLY on https://pc-wrangler.vercel.app/x/<code>. Its single job: read the
// campaign code from the URL and save it to chrome.storage.sync under the same
// "shareCode" key the popup uses, so a player who clicks the GM's link never has
// to paste anything. Then it tells the page it succeeded, so the page can show a
// confirmation. This is the only place the extension touches pc-wrangler, and it
// only reads a code from the path.

(function () {
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
    chrome.storage.sync.set({ shareCode: code }, function () {
      if (chrome.runtime.lastError) {
        window.postMessage({ __sixaxesLink: true, ok: false, reason: "storage" }, window.location.origin);
        return;
      }
      window.postMessage({ __sixaxesLink: true, ok: true, code: code }, window.location.origin);
    });
  } catch (e) {
    window.postMessage({ __sixaxesLink: true, ok: false, reason: "exception" }, window.location.origin);
  }
})();
