# The Six Axes Guide

Everything in one place: what each part of the app does, how to set up from scratch, how to run a game night, and how to turn what you capture into a better table.

## What Six Axes is

Six Axes turns what happens at your table into recaps your players actually read and analytics you can act on. It captures two streams: what was said (per-speaker voice from your Discord sessions, or in-person recordings) and what mechanically happened (dice rolls, damage, and hit points from D&D Beyond via Beyond20). Both land on the same session timeline.

Consent comes first, always. Nothing is recorded until each player agrees, consent is logged per player per session, and you can delete recordings on request. The transcription step is gated on consent being on file.

The name comes from the six axes the disposition model tracks for every character: the Character, the Encounter, the System, the Table, the World, and Presence.

## A tour of your side (the GM tabs)

**Table.** Your home base. Start here is the six-step checklist that walks you from an empty account to a running table. Workspace is where campaigns live. Roster is where you add characters, copy each player's personal invite link, bind their inventories, and grab the one session link your whole table uses.

**Play.** Game-night operations. Sessions is the log: schedule sessions, keep notes, and generate recaps. Capture holds the audio side: recordings uploaded per character and the queue into transcription. Review is where you approve or reject the events the extractor proposes from transcripts before they enter your story record. Check-in is the live runner for marking attendance and logging events as you play.

**Story.** Your campaign's memory. Codex holds entries for people, places, and threads. Timeline lays events out in order. Search finds anything by name, place, item, or phrase, or shows everything tied to one PC.

**Insight.** The analytics. Dispositions is the model view across the six axes per character. Reliability double-codes your transcripts and reports agreement (Cohen's kappa), so you know how trustworthy the extraction is. Dashboard translates everything into plain-language table health flags. Mechanics is the descriptive statistics of the dice: roll counts, natural 20s and 1s, the d20 distribution, damage dealt, and hit points over the session.

**Power.** The engine room. This is where you run the disposition model after new sessions are transcribed and reviewed, so the Insight pages reflect your latest data.

**Inventory.** The player inventory instrument. Players take it once via their personal invite link, and their answers bind to their character on the Roster page, feeding the disposition model.

## A tour of the player side (one link)

Players get exactly one URL for the whole campaign: the session link you copy from the Roster tab. It opens a flat portal with everything they need.

**Inventory.** The one-time inventory that ties their preferences to their character.

**Schedule.** Upcoming sessions with RSVP, also available as buttons right in your Discord server.

**Recaps.** Every 'previously on' you have shared, in one place.

**Check-in.** A quick post-session pulse: how the session felt, resubmittable.

**Chat.** Private party chat, with visibility windows only if you grant them.

**Record.** The session page. Recording consent lives here, the in-person self-recorder lives here, and the Table Tap lives here: with Beyond20 set up, a player keeps this tab open and their attacks, saves, damage, and HP changes flow into your recaps and Mechanics automatically.

## Set up from scratch

Budget about twenty minutes for you, and two minutes per player. The Start here checklist tracks most of this automatically.

1. Create your account and your campaign in the Table workspace. Name the table, pick the system.
2. Add your players' characters on the Roster tab. A name per player is enough to begin.
3. Send each player their personal invite link from the Roster (the Copy player invite button on their character). Opening it ties their inventory to that character.
4. Connect Discord: invite the Six Axes bot to your server, then run /setup code:<your share code> in the channel where you want recaps and RSVPs posted. Players run /claim once to link their Discord account to their character.
5. Copy the session link from the Roster tab (the Table Tap card) and pin it in your Discord channel. This is the one link players use all campaign.
6. Have each player who plays through D&D Beyond do the one-time Beyond20 setup: add your site to Beyond20's Custom Domains (the card shows the exact line) and press Apply, then enable D&D Beyond digital dice so captured numbers match what the table sees.
7. Schedule your first session on the Sessions page. Players get RSVP buttons in Discord and a reminder the day before.
8. Optional but recommended before your first real night: run a short test. Join voice, /record, say a few words, /stop, and have one player roll something with the session page open. If a recap chunk and a Mechanics row show up, everything is wired.

## Run a game night

Once set up, a session costs you three Discord commands and two clicks in the app.

1. Before the game: post /session in your Discord channel so the table sees the time in their own timezone and can RSVP.
2. Start the session in the app (Sessions page). Recording and roll capture both attach to the open session.
3. Players open the pinned session link and tap I consent (or use the consent button the bot posts). Players on Beyond20 just leave that tab open in the background.
4. Everyone joins the voice channel, then you run /record. The bot joins, posts the consent notice, and captures each speaker on their own track. Rolls made on D&D Beyond flow in alongside, attributed to each character.
5. Play. If someone new joins voice mid-session, nothing breaks; long sessions are captured in rotating chunks automatically.
6. When you wrap, run /stop. The bot finishes, uploads per-speaker audio, and files it as a draft capture for the session.
7. End the session in the app.
8. Playing in person instead? Skip /record: each player opens the same session link on their phone and uses the self-recorder on the Record page. Same pipeline from there.

## Collect the insights

After a session, the raw material becomes readable and countable in this order:

1. Queue transcription from the Capture page. This is consent-gated: it only runs for players whose consent is on file for that session.
2. Review the proposed events. The extractor reads the transcript and suggests story beats per character; you approve, edit, or reject each on the Review page. Only approved events enter your story record.
3. Generate the recap on the Sessions page and share it: email to players, posted to your Discord channel, or both. It lands on the players' Recaps page too.
4. Open Insight, then Mechanics for the dice story of the night: who rolled, the d20 distribution, crits and fumbles, damage by type, and each character's hit points over the session. The verified-numbers figure tells you how many players have digital dice enabled.
5. Run the engine on the Power page when you have new reviewed sessions. This updates Dispositions across the six axes.
6. Check Reliability occasionally. It re-codes a transcript independently and reports agreement, so you know how much to trust the extraction on your table's audio.
7. Glance at the Dashboard for plain-language flags about table balance.

## What to do with them

The point of all this is not the charts. It is five small moves that make the next session better:

1. Open the next session with the recap. Two minutes of 'previously on' gets everyone back in the story and rewards the players who read it early.
2. Balance the spotlight. If Mechanics shows a player rolling half as often as everyone else, or Dispositions shows an axis going quiet, write one scene for them into your next prep.
3. Turn the dice into table lore. The nat 1 and nat 20 ledger is shareable gold: call back the fumble, celebrate the clutch 20. Players love seeing their disasters documented.
4. Read the HP sparklines as a pacing instrument. If nobody dipped below 75 percent, the night may have been low-stakes; if someone flatlined near zero twice, check the Check-in pulses before turning the difficulty up again.
5. Pick exactly one Dashboard flag per session and address it in prep. One deliberate adjustment a week compounds; five at once is noise.

## Troubleshooting

**The session page says waiting for Beyond20.** The site is not in Beyond20's Custom Domains yet, or Apply was not pressed, or the tab was not reloaded after. Fix all three, in that order. The domain line to add is shown right on the page.

**Rolls show as unverified in Mechanics.** That player has Beyond20 broadcasting formulas instead of results. Have them enable D&D Beyond digital dice in Beyond20's options; from then on their numbers match what the table sees.

**A player's rolls say unlinked.** The session page shows a Link your character picker the moment an unlinked roll arrives. One tap fixes it, and earlier rolls from that player are attributed retroactively.

**/record says there is no open session.** Start the session in the app first (Sessions page). Recording and rolls both need an open session to attach to.

**The bot does not join voice.** Join the voice channel yourself before (or right after) running /record; the bot follows the person who requested the recording. If a recording is stuck, /stop clears it.

**Transcription will not queue.** That is the consent gate working. Check that every attending player has consent logged for this session, via the session page checkbox or the Discord I consent button.

**A roll appeared in Roll20 but not in Six Axes.** Damage rolled from the button inside Roll20's chat never leaves Roll20. Roll attacks and damage from the D&D Beyond sheet (with digital dice and auto-roll damage on) and everything is captured.

---

Generated from the in-app guide. Edit lib/help-content.mjs and re-run this script.
