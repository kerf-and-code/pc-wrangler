# Six Axes Capture — Chrome Web Store Submission

Everything you need to paste into the Developer Dashboard. The listing itself is easy;
**the privacy section is what gets extensions rejected**, so most of this document is
about that.

Package: `six-axes-capture-extension/`, manifest v3, version 1.0.0.

---

## 0. Before you upload

- [ ] **Zip the CONTENTS, not the folder.** `manifest.json` must sit at the root of the
      archive. A nested folder is the single most common rejection on first submission.
- [ ] Confirm the three icons exist: `icon-16.png`, `icon-48.png`, `icon-128.png`.
- [ ] **Publish the privacy policy first.** The store form requires a public URL and will
      not let you submit without one. `https://pc-wrangler.vercel.app/privacy` works today.
- [ ] One-time developer registration fee ($5) if this is your first extension.

**Submit UNLISTED first.** It gets you a working install link for your own players
without exposing a v1.0.0 to public review and public ratings. Flip to Public once a real
table has used it through a full session. Changing visibility later does not re-trigger
full review.

---

## 1. Store listing

**Name**
```
Six Axes Capture
```

**Summary** (132 characters max)
```
Sends your D&D Beyond dice rolls to your Six Axes campaign. No custom domains, no extra tab.
```

**Description**

```
Six Axes Capture connects your D&D Beyond dice rolls to your table's Six Axes campaign.

WHAT IT DOES

Your GM shares a one-tap setup link. You install this extension, click the link, and you
are done. Every roll you make on D&D Beyond is sent to your campaign's session timeline,
attributed to your character, alongside the rest of the table's.

WHY IT EXISTS

Without it, connecting D&D Beyond to Six Axes meant adding a custom domain inside Beyond20's
settings and keeping a separate browser tab open for the whole session. It took about half an
hour to set up five players, and it silently failed to save for some of them. This extension
removes that step entirely.

WHAT YOU NEED

- Beyond20 (the extension that already handles D&D Beyond rolls)
- A campaign code from your GM, or the setup link they send you

HOW IT WORKS

The extension listens for roll events that Beyond20 already fires on the D&D Beyond page,
normalizes them, and sends them to your campaign. If a roll cannot be matched to a character,
the popup offers to link it once, and every future roll from that character attaches
automatically.

WHAT IT DOES NOT DO

It does not read your D&D Beyond account, your characters, or anything on the page other
than the roll events Beyond20 broadcasts. It does not track your browsing. It runs only on
D&D Beyond and on your own campaign's setup page, and nowhere else.
```

**Category:** Entertainment
**Language:** English

---

## 2. Graphics

| Asset | Size | Required |
|---|---|---|
| Store icon | 128×128 | Yes |
| Screenshot | 1280×800 or 640×400 | **At least one** |
| Small promo tile | 440×280 | No |

**The one screenshot that does the work:** the extension popup open beside a D&D Beyond
character sheet, with a roll that has just fired. It shows what it is in one glance. If you
want a second, use the `/x/<code>` setup page saying "You're all set."

---

## 3. Privacy — the part that gets you rejected

The reviewer checks that **every permission you request is justified, and that the
justification matches what the code actually does.** Vague answers get bounced.

### Single purpose

```
Sends dice rolls made on D&D Beyond to the user's own Six Axes campaign.
```

Keep it to one sentence. "Single purpose" means single. Anything that reads like two
purposes invites a rejection.

### Permission justifications

**`storage`**
```
Stores the campaign code the user pastes in (or that arrives via their GM's setup link), so
they do not have to re-enter it every session. Also caches the identifiers of rolls that
could not yet be matched to a character, so the popup can offer to link them. No personal
data is stored.
```

**Host permission: `https://*.dndbeyond.com/*`**
```
The extension must run on D&D Beyond because that is where the dice are rolled. It listens
for the roll events that Beyond20 broadcasts on the page and reads nothing else from it.
```

**Host permission: `https://pc-wrangler.vercel.app/*`**
```
Two uses. The extension sends captured rolls to the user's campaign at this domain. It also
runs on the /x/<code> setup page so that clicking the GM's link saves the campaign code
automatically instead of the player typing it.
```

**`scripting` / injected page script (if flagged)**
```
The extension injects a small script into the D&D Beyond page so it can read the roll data
Beyond20 publishes. Chrome isolates extension content scripts from the page, and the roll
details are not readable from that isolated context. The injected script ships inside the
extension package. No code is fetched or executed from a remote server.
```

That last paragraph matters. Injecting a script into a page is exactly the pattern reviewers
look at hardest, so explain *why it is necessary* and *that it is not remote code* in the
same breath.

### Remote code

**Answer: No.**

```
No remote code. The page-hook script is part of the extension package and is injected from
the package itself. Nothing is downloaded or evaluated at runtime.
```

Answering "Yes" here triggers a much slower, stricter review. Answer "No" **and be right** —
if you later add anything that loads a script from a server, you must come back and change
this.

### Data usage disclosures

Tick these, and only these:

| Category | Collected? | What to say |
|---|---|---|
| Personally identifiable information | **No** | |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | **No** | The campaign code is a shared code, not a credential |
| Personal communications | No | |
| Location | No | |
| Web history | **No** | |
| User activity | **Yes** | "Dice rolls the user makes on D&D Beyond, sent to their own campaign" |
| Website content | No | |

Then all three certifications:
- [ ] Not being sold to third parties
- [ ] Not being used or transferred for purposes unrelated to the single purpose
- [ ] Not being used or transferred to determine creditworthiness or for lending

All three are true. The rolls go to the user's own campaign and nowhere else.

**Privacy policy URL:** `https://pc-wrangler.vercel.app/privacy`

---

## 4. After approval

Two constants are currently empty strings and need the live store URL:

- `app/x/[code]/page.tsx` → `CAPTURE_STORE_URL = ""`
- `components/table-tap-card.tsx` → `CAPTURE_STORE_URL = ""`

Fill both with the store listing URL, then:

```
git add app/x/[code]/page.tsx components/table-tap-card.tsx
git commit -m "Extension: point the install links at the live Chrome Web Store listing"
git push
```

Until then the install text renders as instructions rather than a link, which works but
makes the player do the finding.

---

## 5. Two things to fix in the same pass

**A one-word change to the store listing later.** The extension is hardcoded to
`pc-wrangler.vercel.app`. When Six Axes moves to its real domain, the host permission
changes, which means **a new version and a new review**. Either move the domain first, or
add the future domain to the host permissions **now** so the later change is a version bump
and not a re-review. Adding a host permission you do not yet use is not a rejection risk;
needing to add one after launch is a delay.

**Firefox is nearly free.** Firefox Add-ons takes the same MV3 package with one edit:
`background.scripts` instead of `background.service_worker` in the manifest. If any of your
players use Firefox, it is worth the ten minutes.

---

## 6. Expected timeline

- Unlisted: usually a few hours to two days.
- Public, first submission: a few days, occasionally longer if the injected-script
  justification is thin. Which is why section 3 is written the way it is.
