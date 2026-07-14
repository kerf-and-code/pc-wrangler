# The Six Axes Guide

Everything in one place: what each part of the app does, how to set up from scratch, how to run a game night, and how the app builds your world, your prep, and your story as you play.

## What Six Axes is

Six Axes turns what happens at your table into recaps your players actually read and analytics you can act on. It captures two streams: what was said (per-speaker voice from your Discord sessions, or in-person recordings) and what mechanically happened (dice rolls, damage, and hit points from D&D Beyond). Both land on the same session timeline.

And it builds itself as you play. Your Codex fills in with the people, places, and factions you narrate; your prep sheet suggests what to run next; your campaign writes up as a shareable chronicle; and each player gets an honest, play-derived read of how they actually play.

Consent comes first, always. Nothing is transcribed until each player has agreed, consent is logged, and the pipeline refuses to run without it. Session audio is deleted automatically 60 days after it is recorded, whether or not anyone asks: the transcript and the moments drawn from it stay, the recording of a person's voice does not.

The name comes from the six axes the disposition model tracks: Voice, Tactics, Arcana, Rapport, Exploration, and Nerve. It reads them for each character, and, once a player has played more than one, for the player underneath them.

## A tour of your side (the GM tabs)

**Table.** Your home base. Start here is the checklist that walks you from an empty account to a running, recorded table. Workspace is where campaigns live, and where you build your cast: pick class, subclass, species, and lineage or subrace from real lists rather than typing them, and edit any character in place afterwards without losing their history. Roster is where you copy each player's personal invite link and grab the one setup link your whole table uses.

**Play.** Game-night operations. Sessions is the log and recap home: schedule sessions, edit the drafted recap, and send it by email or post it to Discord (two separate buttons, one shared draft, so what you see is what goes out). Capture holds the upload path and the per-session consent opt-outs. Review is where you approve or reject the events the extractor proposes, and where one click turns a captured NPC, place, or faction into a Codex entry. Encounters balances a fight against the party actually sitting at your table tonight. Check-in is the live runner: mark attendance, read player check-ins and chat.

**Story.** Your campaign's memory, most of it self-filling. Codex holds people, places, lore, and your cast, and each NPC accretes what your narration said about it. Prep is your next-session sheet: open threads, NPCs in play, the table's boundaries, and a planner you can pre-fill with one tap (Suggest prep). Timeline lays your arcs and loot out session by session. Map is your campaign map: upload the world, drop pins, and link each to a place, NPC, or piece of lore. Search finds anything by name, place, item, or phrase.

**Insight.** The analytics. Dispositions shows the six axes per character, what each player said versus how they actually played, and beneath that a read on each PLAYER across every character they have ever run. It refreshes on its own after you finish reviewing a session. Reliability double-codes your transcripts and reports agreement (Cohen's kappa). Dashboard translates everything into plain-language table-health flags. Mechanics is the descriptive dice stats: roll counts, natural 20s and 1s, the d20 distribution, damage dealt, and hit points over the session.

## A tour of the player side

Players see three groups. Two are about the table they arrived through; one is about them.

**This table.** Inventory (the questionnaire that ties their play preferences to this character, and where they set their lines and veils), Journal (their story so far, including how they actually play across the six axes, drawn from logged sessions rather than their own answers), Recaps, Lore (what their character has learned, party-visible entries plus anything you revealed to them personally), Map, and Chat (private party chat, with visibility windows only if they grant them).

**Session.** Schedule (upcoming sessions with RSVP, and the availability polls you post, answered in Discord), Record (the in-person self-recorder), and Check-in (a quick post-session pulse, resubmittable).

**You.** The part that is theirs, not the table's. Campaigns lists every table they play at. Characters is their whole stable across all of them. Threads is a private tracker for favors owed, grudges, and hooks they have not followed up, and nobody else can see it, not even you. Codex gathers what they have learned across every campaign. Your profile is the questionnaire taken AS THEMSELVES rather than as a character. Settings is where they export everything you hold about them, or delete their account.

## Guests and accounts

A player can start as a guest. Claiming a character with the invite link is enough to play: no signup, no password, nothing to remember.

But a guest lives only in that browser. Clear the history and the character goes with it. So the app offers them an account (Discord, Google, or an emailed link), and linking one changes nothing else: same character, same history, same everything. Nothing is reset and nothing is lost. It only makes it durable.

The reason it matters to you is the stable. Once a player has an account, every character they have ever played is one person's, and the model can read the player underneath the characters. A veteran's new PC then starts from how that person tends to play, rather than from nothing.

## Set up from scratch

Budget about twenty minutes for you, and about a minute per player. The Start here checklist tracks most of this automatically.

1. Create your account and your campaign in the Table workspace. Name the table, pick the system.
2. Build your cast on the Workspace. Class, subclass, species, and lineage or subrace all come from real lists you pick from, so nothing gets mistyped. If you use third-party content, switch the partner toggles on and it appears in the lists. Anything can be edited later in place, so a half-filled character now is fine.
3. Send each player their personal invite link from the Roster (the Copy player invite button). Opening it claims their character and, if they want, lets them save it to an account.
4. Connect Discord: invite the Six Axes bot to your server, then run /setup code:<your share code> in the channel where you want recaps and polls posted. Players run /claim once to link their Discord account to their character, and that is also where they consent to being recorded.
5. Copy the player setup link from the Roster (the Table Tap card) and pin it in your Discord channel. Any player who rolls on D&D Beyond installs Beyond20 and Six Axes Capture, clicks that link once, and is done. No custom domains, no keeping a tab open.
6. Schedule your first session on the Sessions page: propose a few times, players tap the ones they can make in Discord, and you confirm the winner (which creates the session). Tick Make recurring for a standing weekly game.
7. Optional but recommended before your first real night: run a short test. Join voice, /record, say a few words, /stop, and have one player roll something. If events show up on Review and a Mechanics row appears, everything is wired.

## Run a game night

The short version: everyone joins voice, you run /record, you play, you run /stop. Everything after that happens on its own until it needs your judgement.

1. Players consent once, when they claim their character. There is no consent prompt at record time and no tab to keep open: if they have the capture extension, their rolls just arrive.
2. Everyone joins the voice channel, then you run /record. The bot joins, captures each speaker on their own track, opens a session, and links you as the narrator. Rolls made on D&D Beyond flow in alongside, attributed to each character. To record into a specific session number, add session:2.
3. Play. If someone new joins voice mid-session, nothing breaks; long sessions are captured in rotating chunks automatically.
4. When you wrap, run /stop. The bot uploads per-speaker audio, and then transcription and event extraction start on their own. You do not have to press anything.
5. Playing in person instead? Skip /record: each player opens the session link on their phone and uses the self-recorder on the Record page, or you upload per-player audio on the Capture page. Same pipeline from there.

**Somebody does not want to be recorded.** That is fine and it does not stop the session. On the Capture page you can opt any character out of any session; their track is excluded from transcription and from analysis, and everyone else records normally. A player can also withdraw at any time by telling you, and they are excluded from that session onward.

## Collect the insights

After a session the raw material becomes readable in this order. Only one step needs you.

1. Transcription starts on its own after /stop. It is consent-gated: if someone at the table has neither consented nor been opted out, the job stops and tells you so rather than recording them anyway.
2. Extraction follows automatically, and the proposed events are usually waiting by the time you look.
3. Review them. This is the human checkpoint, and it is the only one. Approve, edit, or reject each; use the confidence threshold to accept the obvious ones in a click. While you are here, Accept + create turns any captured NPC, place, or faction into a Codex entry.
4. When you decide the last proposal, the session finishes itself. The recap is drafted, and the disposition model refreshes. There is no Done button to remember, and if you deliberately want to leave some proposals undecided, a button appears to let you.
5. Edit the drafted recap on the Session Log, then send it: Email and Post to Discord are separate buttons over the same draft, so whatever you see on screen is exactly what goes out.
6. Open Insight, then Mechanics for the dice story: who rolled, the d20 distribution, crits and fumbles, damage by type, and each character's hit points.
7. Check Reliability occasionally, and glance at the Dashboard for plain-language flags about table balance.

## Reading the dispositions

Every character gets a read across the six axes, and it comes in two parts. The prior is what the player said about themselves in the questionnaire. The posterior is how they actually played, drawn from the events you approved. The gap between them is the interesting part, and the model does not assume the questionnaire is right: it estimates how much self-report predicts behaviour, per axis, from your data.

**The player behind the characters.** Once someone has played more than one character, the model also reads THEM: how that person tends to play, pooled across everything they have run. A new character then starts shrunk toward that rather than toward nothing, and sharpens as it earns its own evidence.

**What players see, and what they do not.** A player always sees their own character's posterior on their Journal. They do NOT see the read on themselves unless you share it. That one is a claim about the person rather than the character, so it is yours to offer: on Insight, then Dispositions, each player has a Share with them button. It is reversible, and they still choose whether to look.

**Read the intervals, not just the number.** A posterior built on one session with no questionnaire is mostly the model's prior wearing a number. Where that is true, the app says so in plain language and draws the uncertainty band under the score. Wide band, thin evidence. Do not build a conversation with a player on a wide band.

## Build the world, the prep, and the story

Beyond capturing a session, Six Axes turns what it captured into a living campaign. Most of this is one tap or fully automatic.

**The Codex fills itself.** On Review, Accept + create turns a captured NPC, place, or faction into a Codex entry, deduped by name and seeded from what you narrated. NPCs, locations, and factions all self-populate; you just approve them.

**Balance the fight for the party you actually have.** On Play, then Encounters. Pick who showed up tonight, add the monsters, and it tells you where the fight lands. It supports both the 2024 XP budget and the 2014 thresholds-and-multiplier method, which genuinely disagree, so pick the one your table uses. If the module was written for four level-5 characters and you have three, it tells you how much to cut. And because it knows your party, it also tells you what they cannot do: no healer, no ranged option, no front line. That moves a fight's real danger further than any multiplier.

**Plan the next session.** The Prep sheet has a planner: jot the scenes and encounters you mean to run, link them to open threads or NPCs, set a difficulty by feel. Suggest prep pre-fills it in one tap, reading your stale threads and who has been quiet. Encounters can drop a balanced fight straight into it.

**The Living Map.** On Story, then Map, upload your campaign map and click to drop pins. Link each pin to a place, NPC, or lore entry, and set who can see it. Party-visible pins appear on the players' Map tab.

**Reveals.** On any Codex entry or NPC, Reveal to shows it to a specific player when the story earns it, even while it stays a secret to everyone else. It lands on that player's Lore tab. Party-visible entries already reach the whole table.

**The Campaign Journal.** Build the journal on Sessions stitches your recaps into one flowing chronicle, with the arcs, the loot ledger, the nat-20/nat-1 legends, and the cast. It gives you a public link you can share with anyone.

## Recording, consent, and what happens to it

You are recording your friends' voices. The app takes that seriously and so should you. This is the whole of it, in plain terms.

**Consent is once, not every session.** A player consents when they claim their character, and it stands for the campaign. They never see a consent prompt at record time, because being asked mid-game in front of everyone is not a free choice.

**The pipeline enforces it.** Transcription will not run if someone present has neither consented nor been opted out. This is not a warning you can click past: the job stops. If it does, the Capture page tells you who.

**Audio is deleted after 60 days.** Automatically, whether or not anyone asks, and nobody can extend it. The transcript and the moments drawn from it stay, because that is the campaign's record. The recording of a person's voice does not. Old moments will show as expired rather than playing, and that is the promise working.

**Players own their data.** On their Settings page, any player can export everything you hold about them, or delete their account. Deleting removes their recordings, their transcribed words, their questionnaire answers, and their notes. Their characters stay in your campaign with the personal link severed, because the story your table told together is yours as well as theirs.

**Your responsibility as GM.** Recording law varies, and some places require every person to agree. Say out loud when recording starts, especially on Discord, where the bot joining is the only signal. Be careful with minors: a parent or guardian should consent.

## What to do with them

The point of all this is not the charts. It is five small moves that make the next session better:

1. Open the next session with the recap. Two minutes of 'previously on' gets everyone back in the story and rewards the players who read it early.
2. Balance the spotlight. If Mechanics shows a player rolling half as often as everyone else, or Dispositions shows an axis going quiet, write one scene for them into your next prep (Suggest prep will already be nudging you toward it).
3. Turn the dice into table lore. The nat 1 and nat 20 ledger is shareable gold: call back the fumble, celebrate the clutch 20.
4. Read the HP sparklines as a pacing instrument. If nobody dipped below 75 percent, the night may have been low-stakes; if someone flatlined near zero twice, check the Check-in pulses before turning the difficulty up again.
5. Pick exactly one Dashboard flag per session and address it in prep. One deliberate adjustment a week compounds; five at once is noise.

## Troubleshooting

**A player's rolls are not arriving.** Check three things in this order. Is a session actually open? Rolls are dropped if nothing is live, and that looks exactly like a broken extension. Do they have BOTH Beyond20 and Six Axes Capture installed? And did they click your /x/ setup link, which is what tells the extension which campaign to send to?

**A player's first roll shows as unlinked.** That is expected, and it is not lost. Rolls attach to a character only once that character's D&D Beyond id is known, and the first roll is what teaches it. The extension popup grows a Link your character picker; the player chooses once, and every earlier roll is backfilled and every later one attributes on its own. Tell your players this in advance, or they will assume it failed.

**Rolls show as unverified in Mechanics.** That player has Beyond20 broadcasting formulas instead of results. Have them enable D&D Beyond digital dice in Beyond20's options; from then on their numbers match what the table sees.

**Transcription will not start.** That is the consent gate working. Someone at that table has neither consented nor been opted out. Fix it on the Capture page: opt them out for that session, or have them tap I consent in Discord.

**Recording into the right session.** /record opens a session automatically if none is live. After a false start, run /record session:2 to record into that exact number instead of creating a new one.

**The bot does not join voice.** Join the voice channel yourself before (or right after) running /record; the bot follows the person who requested the recording. If a recording is stuck, /stop clears it.

**A scheduling poll got no responses.** Players answer in Discord, so the bot must be able to post in your channel and players must have run /claim. If the poll did not appear at all, link the channel with /setup first.

**A player's Lore, Map, or Journal is empty.** Those are per-player and need the player to have claimed their character via their personal invite link. Until they claim, they see only party-visible items and no personal read.

**A character seems to be missing from party coverage.** It has no subclass recorded, or a subclass the catalog does not recognise. The Workspace roster flags them and gives you a fix link. A level 1 or 2 character with no subclass is fine and is not flagged, because it genuinely does not have one yet.

**An old moment will not play.** The audio was deleted under the 60-day retention policy. The transcript and the event are still there; the recording is not, and cannot be brought back. That is the policy working, not a fault.

---

Generated from the in-app guide. Edit lib/help-content.mjs and re-run this script.
