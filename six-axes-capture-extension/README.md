# Six Axes Capture (browser extension)

Sends a player's D&D Beyond rolls to their Six Axes table **without** the Beyond20
custom-domain step or a VTT tab. The player installs Beyond20 (as before) plus this
extension, pastes their campaign code once, and rolls flow while a session is open.

## Why it exists
Beyond20's "Custom Domains" step is the #1 pilot friction (slow, and it silently fails
in some Edge setups). Browsers don't let a website configure another extension, so the
only ways to remove that step are (A) parse D&D Beyond rolls ourselves, or (B) capture
Beyond20's roll DOM events on the D&D Beyond page itself. This is **Option B**.

## How it works
- `content.js` runs on `*.dndbeyond.com`, listens for `Beyond20_Roll` /
  `Beyond20_RenderedRoll` DOM events, and forwards them to the background worker.
- `background.js` POSTs to `/api/vtt/ingest` with the saved campaign code.
- `popup.html/js` stores the campaign code in `chrome.storage.sync`.

## Before shipping (two must-dos)
1. **Verify Beyond20 fires roll events on the DDB page.** Load the unpacked extension,
   open a D&D Beyond character sheet, open the devtools console, and roll. Confirm the
   `Beyond20_RenderedRoll` (or `Beyond20_Roll`) listener fires. If it does NOT fire on
   the DDB page (only on a VTT page), switch to Option A (parse DDB rolls directly).
2. **Align the POST payload with Table Tap.** `/api/vtt/ingest` already accepts what the
   Table Tap component sends. Match `background.js`'s body to that exact shape (keys and
   normalization) so the server parses extension rolls identically. If ingest rejects the
   extension's cross-origin POST, add the extension origin (or a shared header) on the
   server side.

## Load it for testing (Chrome/Edge)
1. Go to `chrome://extensions` (or `edge://extensions`).
2. Enable Developer mode.
3. "Load unpacked" and select this folder.
4. Click the extension, paste a campaign code, Save.
5. Open a D&D Beyond sheet (with a Six Axes session open) and roll.

## Publishing (later)
- Chrome Web Store + Edge Add-ons + Firefox AMO (Firefox needs a manifest tweak for
  `background.scripts` instead of `service_worker`).
- Store review is typically a few days. Once listed, player setup becomes: install
  Beyond20 + install Six Axes Capture + paste code. No custom domain, ever.

## Roadmap
- Auto-fill the campaign code from a Six Axes link (deep link the popup) so players
  don't paste anything.
- Option A (Beyond20-free) capture as a fallback / eventual simplification.
