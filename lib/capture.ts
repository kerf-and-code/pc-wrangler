// lib/capture.ts (2026-11-12, push 49: audit round 2, U4)
//
// Where players install Six Axes Capture. The setup page (/x/<code>), the GM's table card and the home
// page's integrations all link here. While this was empty they said plainly that the extension was not in
// the store yet, instead of naming an extension with no way to get it.
//
// Push 53 (2026-11-12): the Chrome Web Store listing is live, so the link is filled in. The not-listed
// wording stays for the day the listing is ever pulled: empty the URL and every page falls back to it.

export const CAPTURE_STORE_URL = "https://chromewebstore.google.com/detail/six-axes-capture/melooildenlcecpmfblaijdgdhdhnpim";

export const CAPTURE_NOT_LISTED = "not in the Chrome Web Store yet: ask your GM how to install it";
