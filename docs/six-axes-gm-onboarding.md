# Six Axes: GM Onboarding

*From an empty account to a recorded, reviewed session. About twenty minutes of your time, about a minute of each player's.*

The **Start here** checklist in the app (Home → Start here) tracks most of this. This document is the version you can read on the bus; **The Owner's Manual** explains every page once you are running, and **Your First Two Sessions** walks the first two nights.

## Before you start

You need one way to capture your table's voice:

- **Playing online?** A Discord server you can invite a bot to. It records each player on their own track, and it is how your players claim their characters and consent.

- **Playing in person?** A laptop or tablet in the middle of the table. Nothing else.

And players. They do not need accounts to start, and they install nothing unless they roll on D&D Beyond or in Roll20. You do **not** need a VTT (Six Axes has its own tabletop), a paid plan, or anyone to sign up for anything.

## How the menu is laid out

The menu runs in the order your week does. On a laptop it sits down the left side; on a phone, the tabs along the bottom. **Find** (Ctrl+K, or Cmd+K on a Mac) jumps to any page, Codex entry, NPC or session.

| **Group**   | **Pages**                                                                   |
|-------------|-----------------------------------------------------------------------------|
| **Home**    | Start here, Workspace, Roster                                               |
| **Prep**    | Prep sheet, Encounters, Monster maker, Timeline                             |
| **Session** | Tonight, Tabletop, Combat, Roll, Compendium, GM screen, Record in person    |
| **After**   | Review, Speakers, Transcripts, Session log, Player check-ins, Capture       |
| **World**   | Codex, Image maps, World builder, Import, Publish, Search, Ask the campaign |
| **Insight** | Dispositions, Mechanics, Calibration, Dashboard, Reliability                |
| **You**     | Your own character sheet, campaigns, characters, library, notes, settings   |

## 1. Make a campaign

Home → **Workspace**. Name it and pick the system. Thirty seconds. Each campaign can also set the language it plays in, which transcription and recaps follow.

Already have a prepared world? **Duplicate campaign** in a campaign's settings copies it into a fresh campaign: Codex, calendar, stat blocks, look and language. **Import** (World) brings in notes from Obsidian, World Anvil or documents, for review before anything is created.

## 2. Build your cast

Still on the Workspace, add each player character. Class, subclass, species and lineage come from real lists you pick from, so nothing gets mistyped. Third-party content appears once you switch its partner toggle on.

> **Levels matter more than they look.** The encounter balancer and the party-coverage panel both read them, and a character with no level is quietly left out of both. Set them when you know them; every field stays editable.

## Or let your players build their own

Players who sign in get **Quick build** (a D&D character in three steps), the full builder, a library of builds, and a D&D Beyond sheet importer. Anything they build still lands on your Roster. Hand them the Player Guide.

## 3. Connect Discord

Skip this if you play in person.

1.  Invite the Six Axes bot to your server (the button is on the Workspace).

2.  Press **Copy /setup command** on the Workspace and paste it into the channel where you want recaps and polls. The code inside works once, within a day, so nobody else with your share code can move your table to another server.

3.  Decide whether people in your server who are not at the table may **watch** it in the Discord Activity. The switch is on the Workspace and starts off.

## 4. Get your players onto their characters

## The Discord route (recommended)

1.  Each player runs **/claim** in your channel, picks their character, reads the short note about recording and taps **I consent**.

2.  Then **/mypage**. The bot sends them a private link; they sign in with the same Discord account and every character of theirs, in every campaign of yours, attaches at once.

## The link route

Home → **Roster** → **Copy player invite** next to a character. That link is personal to one character: send it privately. Useful for in-person tables and players not in your Discord.

> **Consent is per person, and it is checked as the audio arrives.** On Discord the bot keeps audio only from people who have consented and are not opted out for that session. Anyone else's audio, at the table or not, is discarded as it arrives and cannot be recovered afterwards. A player who has not consented can tap I consent in Discord, or press I consent to recording in their Settings, and is recorded from about a minute later.

## 5. Get the rolls in

Home → **Roster** → the **Table Tap** card → copy the **player setup link** and pin it in Discord.

## D&D Beyond and Roll20 players

Each player installs **Six Axes Capture** from the Chrome Web Store (search for Six Axes Capture, or chromewebstore.google.com/detail/six-axes-capture/melooildenlcecpmfblaijdgdhdhnpim). It works in Chrome, and in Edge once Allow extensions from other stores is on. Then:

- **D&D Beyond:** they also install **Beyond20**, and click your setup link once.

- **Roll20:** they open the extension, press **Turn on Roll20**, and reload the game. No GM needs Roll20 Pro. Each roll goes to the character with the same name, so player characters need their Roll20 names; Insight → Mechanics lists any name that did not match.

- If they open your setup link while signed in and press **Connect the extension to me**, their rolls count as verified.

> **Tell them about the first D&D Beyond roll.** It will not attribute to their character: the app has to learn their D&D Beyond id, and that roll teaches it. The extension popup shows a Link your character picker. They choose once, every earlier roll is backfilled, and every later one attributes on its own. Unwarned, they will roll, see nothing, and assume it is broken.

## Foundry tables

In Foundry, **Add-on Modules → Install Module**, and paste **https://www.six-axes.com/foundry/module.json** as the manifest URL. Enable it and paste your table code into its settings. It sends dice only: no chat, no sheets, no audio. Most Foundry tables talk over Discord, so the bot records the voice and the module sends the rolls. Foundry's own built-in audio is not supported.

## Or play on the Six Axes tabletop

Session → **Tabletop** is a full shared table: maps, tokens, fog, walls, templates, handouts, cards and dice. Rolls made there go straight into the session, with nothing to install.

## 6. Schedule the first session

After → **Session log**. Propose a few times; players tap the ones they can make in Discord; confirm the winner, which creates the session. Tick **Make recurring** for a standing weekly game. Players get a notification and can add it to their calendar.

## 7. Do a two-minute test

**On Discord:** join voice, run /record, say a few words, run /stop, and have one player roll something. **In person:** Session → Record in person, thirty seconds, stop.

If events appear on **Review** and a row appears on **Mechanics**, every part of the chain is wired. You would much rather find out now than at 8pm on game night.

## What happens on game night

Open Session → **Tonight**. It picks tonight's session (the live one, else an open one, else the next scheduled one) and walks the night top to bottom: mark who is here, check recording consent, go live, start the recording, log moments, jump into a running fight, then **End and process**. **Open the tabletop** puts the table in its own window for a second screen.

## Playing online

Everyone joins voice, you run **/record**, you play, you run **/stop**. Then you do nothing: transcription starts on its own, extraction follows, and by the time you look the proposed events are usually waiting. If someone has not consented, the reply to /record names them.

> **A restart no longer costs the night.** The bot saves each minute of a recording as it goes. If it restarts mid-session it rejoins and carries on, missing only a minute or so; if it cannot rejoin, it finishes the recording from what it saved. Either way it says so in your channel.

## Playing in person

Session → **Record in person** on a laptop or tablet in the middle of the table. Confirm everyone agrees, press Start, and Stop when you wrap. The recording is saved on the device as it goes, so a closed tab loses nothing, and it uploads when you stop. Watch the level meter for a moment at the start.

One microphone holds everyone, so consent here is all or nothing: everyone at the table agrees, or it does not record. Afterwards, After → **Speakers** shows each separated voice with a sample line; tell it who is who. Lines from a voice you have not named are left out rather than guessed at.

## Then: Review

**There is exactly one thing for you to do.** After → **Review**: approve, edit or reject each proposed event. When you decide the last one, the session finishes itself: the recap is drafted and the disposition model refreshes. Edit the recap on the **Session log** and send it: **Email** and **Post to Discord** are separate buttons over the same draft.

## Recording and consent, in four sentences

Consent is given once per campaign, when a player claims, and is never asked mid-game in front of the table. The bot keeps only consenting players' audio and discards everyone else's as it arrives, so a missing consent can only be fixed before the moment it matters. Players can stop being recorded at any time (Stop recording me in Settings, or /consent choice:off), and you can opt anyone out of a session on After → Capture. Audio is deleted 60 days after it is recorded, automatically, and nobody can extend it.

**Your part:** say out loud when recording starts. On Discord the bot joining the channel is the only signal.

## Running it together

**Co-GMs.** On the Workspace, the GMs panel invites another GM with a single-use link that works for 7 days. A co-GM runs everything you do except deleting or trashing the campaign, handing it over, and choosing who else is a GM.

**Handing over.** Hand over to another GM moves the campaign, its stat blocks and its data to them. **Download campaign (zip)** takes everything with you at any time. A trashed campaign can be restored for 30 days.

## Later, when you are ready

- **Share a player's read** on Insight → Dispositions (Share with them), once the numbers mean something.

- **Publish** (World) a public page of your campaign, item by item, in a look of your choosing.

- **World builder** (World) paints a hex world, runs the city, dungeon, building and bastion generators, and builds battle maps that can find their own walls.

- **Ask the campaign** (World) answers questions from your transcripts and Codex, with every claim linked to its source.

- **Calibration** (Insight) sets each finished fight against the difficulty the DMG math gave it.

## What you get, and when

| **When**                   | **What**                                                                                                |
|----------------------------|---------------------------------------------------------------------------------------------------------|
| **Straight away**          | The session timeline: what was said, what was rolled. The tabletop, the compendium and the fight tools. |
| **After you review**       | Recaps, the Codex filling itself, arcs and loot on the Timeline                                         |
| **After a session or two** | Mechanics (the dice story), the Dashboard's table-health flags                                          |
| **After several sessions** | Dispositions that mean something; Calibration after ten measured fights                                 |

## The five-minute version

- Make a campaign, add characters (or let players build their own).

- Discord: Copy /setup command and paste it. Players /claim, tap I consent, then /mypage.

- Rolls: pin the setup link; players install Six Axes Capture from the Chrome Web Store (plus Beyond20, or Turn on Roll20). Foundry tables install the module.

- Game night: Session → Tonight. /record, play, /stop. Or Record in person, then name the voices.

- Review the events. Send the recap.

---

Generated from the Word document of the same name (updated 12 November 2026). Edit the document and regenerate with pandoc.
