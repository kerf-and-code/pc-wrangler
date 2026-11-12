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

## 2.4.1 (push 43): the popup says what Roll20 capture reads

The popup's Roll20 text now says plainly that it sends every roll in the Roll20 game's chat, other
players' included, with the names they roll under (audit round 2, T3). No behaviour change. Submit it
after 2.4.0 clears review, with the store listing text in docs/chrome-web-store-submission.md.

## Roll20 (2.4.0, push 38)
Rolls made inside Roll20 itself (`/r` commands and the 2024 D&D character sheet's buttons) are read
from the Roll20 chat by `roll20.js`. Roll20's own scripting cannot send anything out and needs a Pro
subscription, so the extension does it instead, and no GM needs Pro.

- **Off until the player turns it on.** Access to `app.roll20.net` is an optional permission. The
  popup's "Turn on Roll20" asks Chrome for it; `background.js` then registers `roll20.js` on Roll20
  game pages (and removes it if the permission is taken away). Nobody who only uses D&D Beyond is asked.
- **What it reads:** `div.message.rollresult` (`/r`) and `rolltemplate.dnd-2024--roll` (the 2024 sheet:
  attack, damage, saving throw, initiative, ability and skill rolls, with advantage and the dropped die).
- **What it leaves alone:** the default roll template, which is how Beyond20 posts D&D Beyond rolls.
  The extension already sends those from D&D Beyond, with the character's D&D Beyond id, so reading
  them here would count each twice. Chat, descriptions without a roll, and system messages are skipped.
- **Only new messages.** The chat history on screen when the game opens is not sent.
- **No double counting across players.** Every player with the extension sees every roll; each event
  carries its Roll20 message id and the server keeps one copy (p160).
- **Who rolled.** The server matches the name the roll was made under (the sheet's character name, or
  the speaker for `/r`) to a player character in a campaign with a session open.
- **Not read yet:** the older "D&D 5E by Roll20" (2014) sheet's templates. They need a sample of that
  sheet's chat before they can be read correctly.

Test it: load the unpacked extension, turn on Roll20 in the popup, open a Roll20 game with a Six Axes
session open, roll, and watch the page console for `[Six Axes] Roll20: sent ...`.

## Roadmap
- Auto-fill the campaign code from a Six Axes link (deep link the popup) so players
  don't paste anything.
- Option A (Beyond20-free) capture as a fallback / eventual simplification.
