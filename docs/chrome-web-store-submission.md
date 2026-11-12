# Six Axes Capture: Chrome Web Store Submission

Everything you need to paste into the Developer Dashboard. The listing itself is easy;
**the privacy section is what gets extensions rejected**, so most of this document is
about that.

Package: `six-axes-capture-extension/`, manifest v3, version 2.4.1.

Push 43 (12 November 2026): rewritten for 2.4.x. Roll20 support adds an OPTIONAL host
permission (`https://app.roll20.net/*`) and the `scripting` permission, and the Roll20 reader
sees every roll in a game's chat, including other players' rolls and the names they roll
under. Sections 1 and 3 say so plainly. Submit 2.4.1 only after 2.4.0 has cleared review.

---

## 0. Before you upload

- [ ] **Zip the CONTENTS, not the folder.** `manifest.json` must sit at the root of the
      archive. A nested folder is the single most common rejection on first submission.
      Leave the older `six-axes-capture-extension-v*.zip` files out of the new zip.
- [ ] Confirm the three icons exist: `icon-16.png`, `icon-48.png`, `icon-128.png`.
- [ ] **Publish the privacy policy first.** The store form requires a public URL and will
      not let you submit without one. `https://pc-wrangler.vercel.app/privacy` works today,
      and from push 43 it describes the Roll20 capture.
- [ ] One-time developer registration fee ($5) if this is your first extension.

**Submit UNLISTED first.** It gets you a working install link for your own players
without exposing the extension to public review and public ratings. Flip to Public once a
real table has used it through a full session. Changing visibility later does not
re-trigger full review.

---

## 1. Store listing

**Name**
```
Six Axes Capture
```

**Summary** (132 characters max)
```
Sends your D&D Beyond rolls, and if you turn it on your Roll20 game's chat rolls, to your Six Axes table.
```

**Description**

```
Six Axes Capture connects the dice rolls at your table to your campaign on Six Axes.

WHAT IT DOES

Your GM shares a one-tap setup link. You install this extension, click the link, and you
are done. Rolls you make on D&D Beyond (with Beyond20) are sent to your campaign's session
timeline, attributed to your character, while your GM has a session open.

If your table plays in Roll20, you can also turn on Roll20 from the extension's popup. Chrome
asks you to allow access to app.roll20.net. Once allowed, the extension reads the rolls posted
in your Roll20 game's chat and sends them to your campaign. Roll20 is off until you turn it
on, and you can turn it off again from the same popup.

WHAT IT SENDS FROM ROLL20

The Roll20 chat is shared by everyone in the game, so with Roll20 turned on the extension
reads every roll in that chat, not only yours: the dice and totals, the name each roll was
made under, and Roll20's ids for the message, the player and the character. Each roll is matched to a
character with the same name in your campaign. Rolls the GM makes privately in Roll20 are
shown to the GM only. A roll seen by several players at the table is stored once.

WHAT YOU NEED

- A campaign code from your GM, or the setup link they send you
- Beyond20, if you roll on D&D Beyond (not needed if you only play in Roll20)

HOW IT WORKS

On D&D Beyond the extension listens for the roll events Beyond20 already fires on the page,
normalizes them, and sends them to your campaign. If a roll cannot be matched to a character,
the popup offers to link it once, and every future roll from that character attaches
automatically. In Roll20 it reads new chat messages that are rolls and ignores everything
else in the chat.

WHAT IT DOES NOT DO

It does not read your D&D Beyond or Roll20 account, your characters, or ordinary chat
messages. It does not track your browsing. It runs only on D&D Beyond, on Roll20 game pages
if you turned Roll20 on, and on your own campaign's setup page, and nowhere else.
```

**Category:** Entertainment
**Language:** English

---

## 2. Graphics

| Asset | Size | Required |
|---|---|---|
| Store icon | 128x128 | Yes |
| Screenshot | 1280x800 or 640x400 | **At least one** |
| Small promo tile | 440x280 | No |

**The one screenshot that does the work:** the extension popup open beside a D&D Beyond
character sheet, with a roll that has just fired. If you want a second, use the popup with
the Roll20 switch visible, or the `/x/<code>` setup page saying "You're all set."

---

## 3. Privacy: the part that gets you rejected

The reviewer checks that **every permission you request is justified, and that the
justification matches what the code actually does.** Vague answers get bounced.

### Single purpose

```
Sends dice rolls made on D&D Beyond or in a Roll20 game to the user's own Six Axes campaign.
```

Keep it to one sentence. Two sources for the same thing (dice rolls to the user's
campaign) is still one purpose; do not describe the setup link or the account connection
as separate features.

### Permission justifications

**`storage`**
```
Stores the campaign code the user pastes in (or that arrives via their GM's setup link), so
they do not have to re-enter it every session, and the roll key created when the user
connects the extension to their Six Axes account, so their rolls can be confirmed as theirs.
Also caches the identifiers of rolls that could not yet be matched to a character, so the
popup can offer to link them.
```

**`scripting`**
```
Used only to register and unregister the extension's own Roll20 content script (roll20.js,
shipped in the package) when the user turns Roll20 on or off in the popup. Because Roll20
access is an optional permission, the script cannot be declared statically; it is registered
with chrome.scripting.registerContentScripts after the user grants app.roll20.net, and removed
when that permission is removed. No code is fetched from a server or built from strings.
```

**Host permission: `https://*.dndbeyond.com/*`**
```
The extension must run on D&D Beyond because that is where the dice are rolled. It listens
for the roll events that Beyond20 broadcasts on the page and reads nothing else from it.
```

**Optional host permission: `https://app.roll20.net/*`**
```
Requested only when the user presses Turn on Roll20 in the popup, and removable from the same
place. With it, the extension reads roll messages in the Roll20 game chat (dice, totals, the
name the roll was made under, and Roll20's message, player and character ids) and sends them to the
user's own campaign. It ignores non-roll chat messages and reads nothing else on the page.
```

**Host permissions: `https://pc-wrangler.vercel.app/*`, `https://six-axes.com/*`, `https://www.six-axes.com/*`**
```
The Six Axes service, at its current and future addresses. The extension sends captured rolls
to the user's campaign there. It also runs on the /x/<code> setup page so that clicking the
GM's link saves the campaign code automatically instead of the player typing it.
```

**Injected page script (if flagged)**
```
On D&D Beyond the extension injects a small script (page-hook.js, shipped in the package and
listed in web_accessible_resources) so it can read the roll data Beyond20 publishes. Chrome
isolates extension content scripts from the page, and the roll details are not readable from
that isolated context. No code is fetched or executed from a remote server.
```

Injecting a script into a page is exactly the pattern reviewers look at hardest, so explain
*why it is necessary* and *that it is not remote code* in the same breath.

### Remote code

**Answer: No.**

```
No remote code. Every script, including the D&D Beyond page hook and the Roll20 content
script, is part of the extension package. Nothing is downloaded or evaluated at runtime.
```

Answering "Yes" here triggers a much slower, stricter review. Answer "No" **and be right**:
if you later add anything that loads a script from a server, you must come back and change
this.

### Data usage disclosures

Tick these, and only these:

| Category | Collected? | What to say |
|---|---|---|
| Personally identifiable information | **Yes** | "With Roll20 turned on: the names rolls are made under in the Roll20 game chat (usually character names, sometimes a player's display name) and Roll20's player and character ids, including for other players in the same game" |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | **No** | The campaign code is a shared table code and the roll key only marks rolls as the user's; neither signs anyone in |
| Personal communications | **No** | Only roll messages are read; ordinary chat is ignored |
| Location | No | |
| Web history | **No** | |
| User activity | **Yes** | "Dice rolls made on D&D Beyond, and with Roll20 turned on, the rolls in the user's Roll20 game chat, sent to their own campaign" |
| Website content | **Yes** | "Roll messages in the Roll20 game chat (dice and totals), only with Roll20 turned on" |

Ticking PII and website content is the honest answer once Roll20 is in. A reviewer who
finds names leaving the page with PII unticked rejects the version; one who sees it
disclosed with a clear reason usually does not.

Then all three certifications:
- [ ] Not being sold to third parties
- [ ] Not being used or transferred for purposes unrelated to the single purpose
- [ ] Not being used or transferred to determine creditworthiness or for lending

All three are true. The rolls go to the user's own campaign and nowhere else.

**Privacy policy URL:** `https://pc-wrangler.vercel.app/privacy`

---

## 4. After approval

Two constants are currently empty strings and need the live store URL:

- `app/x/[code]/page.tsx`: `CAPTURE_STORE_URL = ""`
- `components/table-tap-card.tsx`: `CAPTURE_STORE_URL = ""`

Fill both with the store listing URL, then:

```
git add "app/x/[code]/page.tsx" components/table-tap-card.tsx
git commit -m "Extension: point the install links at the live Chrome Web Store listing"
git push
```

Until then the install text renders as instructions rather than a link, which works but
makes the player do the finding.

---

## 5. Notes

**Domain move.** The manifest already lists six-axes.com and www.six-axes.com, so moving the
service to its real domain is a version bump, not a new host permission.

**Firefox is nearly free.** Firefox Add-ons takes the same MV3 package with one edit:
`background.scripts` instead of `background.service_worker` in the manifest. Check that
optional host permissions and `scripting.registerContentScripts` behave the same there
before relying on Roll20 in Firefox.

---

## 6. Expected timeline

- Unlisted: usually a few hours to two days.
- Public, or any version that adds a permission: a few days, occasionally longer if the
  injected-script or scripting justification is thin. Which is why section 3 is written the
  way it is.
