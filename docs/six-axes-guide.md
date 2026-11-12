# The Six Axes Guide

Everything in one place: what each part of the app does, how to set up from scratch, how to run a game night, and how the app builds your world, your prep, and your story as you play.

## What Six Axes is

Six Axes turns what happens at your table into recaps your players actually read and analytics you can act on. It captures two streams: what was said (per-speaker voice from your Discord sessions, or in-person recordings) and what mechanically happened (dice rolls, damage, and hit points from D&D Beyond, Roll20, a Foundry game with the Six Axes module, or the Six Axes tabletop). Both land on the same session timeline.

And it builds itself as you play. Your Codex fills in with the people, places, and factions you narrate; your prep sheet suggests what to run next; your campaign writes up as a shareable chronicle; and each player gets an honest, play-derived read of how they actually play.

Consent comes first, always. A player's voice is not recorded until they have agreed: the Discord bot discards the audio of anyone who has not consented as it arrives, consent is logged, and transcription refuses to run without it. Session audio is deleted automatically 60 days after it is recorded, whether or not anyone asks: the transcript and the moments drawn from it stay, the recording of a person's voice does not.

The name comes from the six axes the disposition model tracks: Voice, Tactics, Arcana, Rapport, Exploration, and Nerve. It reads them for each character, and, once a player has played more than one, for the player underneath them.

## What's new

The newest changes first. Each one says where to find it.

**12 November 2026: smaller fixes around the table.** On the tabletop, a problem in any panel (handouts, pins, effects, scenes, floors, uploads) now also shows on the map, where you are looking. Removing tokens can be undone for a few seconds, Reveal all asks once before showing the players the whole map, and one-word token names show two letters (Fi and Fo, not F and F). A character's public wiki page now saves itself as you type, like the private sections, and says Saving, Saved or Not saved with Retry. Greyed-out buttons on the sheet, the session recap and the card panel say why beside them, not only on hover. Opening Your journal without a table link takes you to your table, or lets you pick one. A retired character no longer shows Level -1, the menu's campaign box keeps the campaign's name on a sheet, the Rolls popover closes with Escape, and the card panel explains why nobody is listed to hand a card to. The player setup link now says Six Axes Capture is not in the Chrome Web Store yet, instead of naming it with no link.

**12 November 2026: your campaign's data goes with it.** A stat block you make while working in a campaign now belongs to that campaign, so its co-GMs can use it and an export, a Duplicate or a handover takes it along; blocks you made earlier in your library that only one of your campaigns uses have moved into it. Players never see stat blocks. The campaign export now includes saved scene snapshots, fog, your Roll20 name choices, every campaign setting (calendar, codex look) and the library blocks its encounters use; Settings, Download my data adds your email choices, your stat blocks and card decks, and the campaigns you run. A Duplicate keeps the codex look and no longer says who handed out each card. When a co-GM leaves or you hand a campaign over, the webhooks they made stop, unused co-GM invites are cancelled, and you are no longer told you stopped being a co-GM of a campaign you gave away. Old rate-limit records, delivered webhooks, read notifications and finished invites are now cleared out on a schedule. The licenses page now says plainly that Six Axes includes statistics from D&D books outside the SRD, in its own words, which are not open content.

**12 November 2026: 2014 characters and attacks.** A 2014 character now has spell slots on the sheet and can cast; a 2014 warlock's pact slots come back on a short rest. 2014 rages, ki, Channel Divinity, Action Surge and Indomitable are tracked from the 2014 rules. The sheet also tracks Bardic Inspiration, Wild Shape, Action Surge, Indomitable, Second Wind (2014), Arcane Recovery and Sorcerous Restoration. In 2024, rages and Second Wind now come back one at a time on a short rest, as the rules say. A monk's weapons use the better of Strength and Dexterity, and every weapon on the Actions tab has a small picker for the ability it attacks with (a Pact of the Blade weapon on Charisma, Shillelagh on Wisdom); Auto follows the rules.

**12 November 2026: numbers you can trust.** The usage panel on Reliability, the Roster's event counts and a session's events are counted in full; before, anything past the first 1,000 records was left out without a word. The usage panel also gives an estimated cost at the rates in the costing model (transcription after silence-trim, recaps and notes, storage and compute, in-person rooms). Mechanics can be limited to one source of rolls, to verified rolls, or to rolls matched to a character. A session left open more than 18 hours stops taking rolls from D&D Beyond and Roll20, so a player's rolls from their other games do not land in it, and Tonight says so. Changing how many days a month has in the in-game calendar keeps every date where it was.

**12 November 2026: fights and saves.** Saving throws on the tabletop, in the Discord Activity and on the Initiative page start from the save bonus on your character sheet instead of +0 (open and save your sheet once so it is stored). A save waiting on your character now shows on the sheet itself: the Initiative button says save due, a banner offers Roll the save, and the turn tracker opens. The Initiative page your GM shares can show and answer it too when you are signed in. After a save, a line says how it went. On a phone, a pending save, the round chip and Target everyone inside open the side panel. A total you typed yourself only ever answers a save. When the GM and a player change the fight at the same moment, neither change is lost. Co-GMs' pings and hidden tokens now count as the GM's. Fights started on the tabletop are calibrated (monsters from the library keep their CR, and 2014 monsters make a 2014 fight), and Calibration lists fights that were never ended. If the fight has a different maximum HP from your sheet, the sheet says so instead of overflowing.

**12 November 2026: Roll20 rolls you can trust.** Apply now works on Roll20 attack cards at the tabletop, and the cards say Roll20 instead of D&D Beyond. A Roll20 roll keeps the time it was made, so chat history Roll20 shows late is no longer counted as tonight's rolls (extension 2.4.2, and the server checks too). Insight, Mechanics has a Roll20 names list: every name rolled under this session, where its rolls went, and a picker to send it to a character or mark it as not a player character; earlier rolls move with your choice. Two player characters with the same name, or a name that is also an NPC's, no longer send rolls to a player character by guesswork. The dice tab counts the die advantage dropped, so a fairness read is no longer high.

**12 November 2026: recording consent and Roll20.** The Discord bot now keeps audio only from people who have consented and are not opted out for that session. Anyone else in the voice channel, at the table or not, has their audio discarded as it arrives; it is never written down. Someone who consents mid-session is recorded from about a minute later. Players can stop recording themselves with Stop recording me in Settings or /consent off. The privacy page and the extension now say plainly that turning on Roll20 reads every roll in that game's chat, other players' included, with the names they roll under. Google Analytics on the public pages loads only if you press Allow.

**12 November 2026: who can reach your table.** Linking Discord now uses a one-time code: on the Workspace, Copy /setup command makes a fresh one each time, good for a day, so a player who has your share code cannot move your recaps or your table to another server. The Workspace also has a switch for whether people in your Discord server who are not at the table may watch it in the Discord Activity; it starts off. A player who leaves the table, or whom you remove, no longer sees the live table. Recording your own side needs you to be signed in as that character's player (opening your invite link on the device is enough). Private Roll20 rolls stay with the GM, and a world-map marker no longer names a person you have hidden.

**11 November 2026: replay from the timeline, and fixes for players.** On the Timeline, each place, person and faction a session touched has a play button that replays the first moment it came up in that session's recording. Players now see their campaign's public wiki link on their character page (it always said the GM had not published), markers on the player world map show their place and person again, and the Forge says why a character will not open: deleted, on another account, or in a campaign in the trash.

**11 November 2026: encounter calibration.** Insight, Calibration sets each finished D&D fight against the difficulty the DMG math gives it, next to how it actually went: rounds, the party's HP lost, and how often someone dropped. Six Axes now measures every fight as it runs, whichever screen runs it, so fights from today on count; older fights did not record starting HP and are left out. Below ten measured fights it shows the numbers but concludes nothing, because a few fights cannot tell your table from chance.

**11 November 2026: Roll20 rolls.** The Six Axes Capture extension can now read the rolls made inside Roll20: /r commands and the 2024 D&D sheet's attack, damage, save, initiative, ability and skill rolls, advantage included. Open the extension, press Turn on Roll20, and reload the game. No GM needs Roll20 Pro. Each roll goes to the character with the same name in a campaign with a session open, and a roll seen by several players counts once. Rolls Beyond20 sends from D&D Beyond into Roll20 keep coming from D&D Beyond, so nothing is counted twice.

**11 November 2026: area saves from the table.** Place a template over the area on the tabletop (a cone for a breath weapon), click it, and press Target everyone inside. On the Combat page, the monster whose turn it is now has those targets picked under Save effects hit, marked as coming from the table. Press Use on the save action (Cold Breath, say) and each player gets the save on their screen, on the tabletop, the Initiative page and in the Discord Activity. They roll it there, or type the total they rolled with their own dice, and the damage comes off at once: all of it on a failure, half on a success.

**11 November 2026: cards to hand out.** On the tabletop's Cards tab, the GM can hand out a chosen card: under a deck, press Hand out a card, pick a player, and Give the one you want. Make a deck of your own for inspiration, boons, banes or anything else (one card per line). A card someone gives you is marked Gift. Use it shows it to the table and sends it back to its deck, ready to give again. Save to my library keeps a copy of a deck for all your campaigns; From my library adds it to another table. Players see their cards in the Discord Activity too, and can use or play them there.

**11 November 2026: Six Axes inside Discord.** Six Axes runs as a Discord Activity. In a voice channel of a server linked with /setup, open Activities and pick Six Axes: everyone in the call sees the table's map with its tokens and fog, the turn order, and the rolls. Players move their own token (tap it, then the square), roll any dice with advantage or disadvantage, and roll initiative for their character straight into the fight; the GM can roll hidden. Someone in the call who is not linked to a character sees the table only if the GM has turned on watching for that campaign (Workspace); otherwise they are asked to sign in. To play, sign in to Six Axes with Discord on the website or run /claim. The full table, with every tool, stays on the website.

**11 November 2026: hex grids and the campaign graph.** A tabletop scene can be played on hexes: in the Scenes tab, set Grid to Hexes (pointed or flat top) and nudge the hexes until they sit on the ones printed on your map. Tokens and the ruler snap to hexes and moves in a fight count in hexes; fog, walls and templates stay on the squares underneath. And the Codex has a Graph tab: every connection between your places, cast, factions, items and lore as one picture you can filter, hover and click. A published codex gets the same picture, How it all connects, showing only what readers can already see.

**11 November 2026: walls from a map image, and codex looks.** Bought a map pack or exported from Dungeondraft? Open the map in the battle map editor (World builder), pick Sight walls, and press Find walls in the image: Six Axes reads the dark lines and solid dark areas along the grid and proposes walls, dashed blue. Move the sensitivity until they look right, keep them, then add doors and erase any it got wrong. And on Publish, pick a look for your public codex: the original gold Forge, or Frost, Verdant, Crimson or Arcane, each in dark and light.

**11 November 2026: one fight, several maps.** An encounter can span several tabletop scenes: the decks of a ship, the floors of a tower, or both halves of a split party fighting at once. On Encounters, pick the maps under the monsters and choose which map each monster starts on. When the fight runs, Put all on the table on the Combat page puts every token on its own map, and the turn order stays one list for everyone. On the tabletop the GM sees which map each combatant is on, jumps there with one click, and gets a Go there when the turn passes to someone on another map. Players still see only the map they are on.

**11 November 2026: quick build.** New players can make a D&D character in three steps: pick a class (or take the class quiz and press Build this character), a species and a background, and a name. Six Axes places the standard array in the class's usual order, adds the background's bonus, packs the class's and background's starting gear with its gold, and opens the Forge with a note on the few picks left (skills, species options, spells). Find it on Your characters and in your library, or at /me/quick-build. 2024 rules.

**11 November 2026: in-game calendar.** Keep track of time in your world. On the Timeline, pick a calendar to start from (real-world months, twelve months of 30 days, or thirteen of 28), rename its months, change their lengths, name the days of the week and add an era. Move the date forward as the story does, from the Timeline or from Tonight, and mark each session with the in-game date it started on: the Timeline then reads like "14 Month 3 1203 AF, 12 days after session 6". Duplicate campaign copies the calendar too.

**11 November 2026: the tabletop and fights.** Player characters now join a fight with their AC, hit points (including damage already taken), initiative bonus and speed from their sheets, whether the fight starts from Encounters, Combat or the tabletop. Characters pick this up the next time their sheet is saved in the Forge. On the tabletop, click an area template and press Target everyone inside to target every creature it touches with one saving throw effect, and fire or radiant templates now light the area around them in a dim or dark scene. Duplicate campaign now copies the table's language too.

**10 November 2026: ask the campaign.** Ask the campaign, under World in the menu: ask a question in your own words ("what did we promise the harbourmaster?") and get a short answer drawn from your transcripts, story beats, Codex, cast and recaps, with each claim numbered back to its source. Sources open the Codex entry or session they came from, and recorded moments play from the line. Also new today: Duplicate campaign on the Workspace copies a prepared world into a fresh campaign, the tabletop keeps scene snapshots you can restore, and each campaign can set the language it plays in, for transcription and recaps.

**10 November 2026: running the table together.** Co-GMs. On the Workspace, the GMs panel lets the campaign's owner invite another GM with a single-use link that works for 7 days. A co-GM runs everything you do except deleting or trashing the campaign, handing it over, and choosing who else is a GM. They can step down from the same panel.

**10 November 2026: notifications.** A bell in the menu, for GMs and players. Players hear when a session is scheduled, moved or cancelled and when a recap goes out; GMs hear about RSVPs, players joining, recordings ready to review or failed, and co-GM changes. A daily email digest of anything unread is off until you turn it on in Settings.

**10 November 2026: the party inventory and other systems.** The party's shared stash and purse now sit at the bottom of Tonight, so you can seed loot and pay out coins without opening a sheet. Players in Pathfinder 2e, Daggerheart, Draw Steel and Lancer get the stash on their sheet page too, along with an At the table tracker for hit points and their system's resources. The PF2e Forge now records feats by level, spells and gear.

**10 November 2026: rules.** Feats now count once wherever they came from, which fixes Tough adding twice its hit points when taken at a level or from a background; Boon of Fortitude, the 2024 Defense style and Alert in both editions now change the sheet. A 2014 character is now offered the 2014 choices (Fighting Styles, Expertise at 3 and 10, Magical Secrets, the 2014 invocations, Favored Enemy and the rest) instead of the 2024 ones.

**10 November 2026: calendars and the app.** Add to calendar on a session, and a calendar link on your Campaigns page that keeps your calendar app up to date. Six Axes can be installed to a phone's home screen. Players can leave a table (their character is kept in their library), and anyone can start their own game from the Campaigns page.

**9 November 2026: the tabletop.** Card decks, floors, 3D dice, and add-ons with webhooks. See The tabletop below for how each works, and the developer reference at /developers for add-ons.

## A tour of your side (the GM menu)

The menu runs in the order your week does: Home, Prep, Session, After, World and Insight. On a laptop every group is listed down the left side; click a group's name to fold it away, and the group you are in always stays open. The campaign you are working in is named at the top. On a phone or tablet, the tabs along the bottom open each group's pages, and More holds Home, Insight and Help. Find (Ctrl+K, or Cmd+K on a Mac) jumps to any page, Codex entry, NPC or session from anywhere.

**Home.** Your home base. Start here is the checklist that walks you from an empty account to a running, recorded table. Workspace is where campaigns live, and where you build your cast: pick class, subclass, species, and lineage or subrace from real lists rather than typing them, and edit any character in place afterwards without losing their history. Roster is where you copy each player's personal invite link and grab the one setup link your whole table uses. Your play style is the questionnaire, taken as yourself. On the Workspace, a campaign's settings hold Download campaign (zip), Duplicate campaign, Hand over to another GM, and Move to trash; the GMs panel invites a co-GM; and the trash at the bottom restores a campaign for 30 days.

**Prep.** Getting ready for next session. Prep is your next-session sheet: open threads, NPCs in play, the table's boundaries, and a planner you can pre-fill with one tap (Suggest prep). Encounters balances a fight against the party actually sitting at your table, and saves it. Monster maker builds your own stat blocks, from scratch or from any monster in the compendium. Timeline lays your arcs and loot out session by session, and keeps in-game time: pick a calendar (or name your own months), move the world's date as the story moves, and each session shows the date it happened and how long after the one before. Tonight shows the date too, with +1 day and +1 week.

**Session.** Game night. Tonight runs the whole night from one page, top to bottom: mark who is here (with their RSVPs beside them), check recording consent, go live or start a new session, start the recording, log moments as you play, jump back into a running fight, then End and process, and afterwards see what is waiting in Review, whether the recap is drafted, and whether the next session is scheduled. Combat runs a fight: press Run this encounter on Encounters and it opens with initiative, HP, conditions, and one-click attack and damage rolls from each monster's stat block, logged to the session (N and P move the turn); players follow the turn order on their Initiative page, without monster HP and without monsters you have hidden. Roll is a logged dice roller for your monsters, so their rolls count in the Mechanics stats next to the players'. Compendium looks up any spell, monster, item, class, subclass, species, feat or rule by typing or by voice, filtered by category and book. GM screen is a board you pin compendium cards to for the session. Tabletop opens the shared table for the campaign you are working in: battle maps, tokens, handouts and rolls that you and your players see at once (Open the tabletop on Tonight puts it in its own window, for a second screen). Record in person turns a laptop or tablet into the table's microphone: one recording of the whole room, saved on the device as it goes so a closed tab loses nothing, uploaded when you stop.

**After.** Once the session ends. Review is where you approve or reject the moments Six Axes noted from the recording, and where one click turns a captured NPC, place, or faction into a Codex entry. Speakers is the in-person follow-up: the app separates the voices in a room recording, and you tell it which voice is which character. Transcripts lets you read, filter and download any session's transcript. Session log is the log and recap home: schedule sessions, edit the drafted recap, and send it by email or post it to Discord (two separate buttons, one shared draft, so what you see is what goes out). Player check-ins shows what each player said in their post-session check-in, plus party chat and attendance. Capture holds the upload path and the per-session consent opt-outs.

**World.** Your campaign's memory, most of it self-filling. Codex holds people, places, lore, and your cast, and each NPC accretes what your narration said about it. Its Graph tab draws every connection between them at once. Image maps is for a map picture you already have: upload it, drop pins, and link each to a place, NPC, or piece of lore. World builder is for painting a hex world from scratch, with markers and regions, and holds the City, Dungeon, Building and Bastion generators. Import brings in notes you already have (Obsidian, World Anvil, documents) for review before anything is created. Publish puts a public page of your campaign online, showing only what you choose, with a cover image and a look of your choosing (Forge, Frost, Verdant, Crimson or Arcane). Search finds anything by name, place, item, or phrase, and its results open the thing they name. Ask the campaign answers a question in your own words from the campaign's transcripts, story beats, Codex, cast and recaps, and every claim links to where it came from; it finds things by the words you use, so name the person, place or thing.

**Insight.** The analytics. Dispositions shows the six axes per character, what each player said versus how they actually played, and beneath that a read on each PLAYER across every character they have ever run. It refreshes on its own after you finish reviewing a session. Reliability double-codes your transcripts and reports agreement (Cohen's kappa). Dashboard translates everything into plain-language table-health flags. Mechanics is the descriptive dice stats: roll counts, natural 20s and 1s, the d20 distribution, damage dealt, and hit points over the session. For Roll20 tables, Mechanics also lists every name rolled under and where its rolls went, so you can send a name to the right character or mark a monster as not a player character. Calibration sets each finished D&D fight against the difficulty the DMG math gave it, next to how it actually went. Reliability also shows what the campaign used in the last 30 days: AI calls, image renders and transcription minutes.

## A tour of the player side

Players see three groups. Two are about the table they arrived through; one is about them.

**This table.** Play style (the questionnaire that ties their play preferences to this character, and where they set their lines and veils), Journal (their story so far, including how they actually play across the six axes, drawn from logged sessions rather than their own answers), Recaps, Lore (what their character has learned, party-visible entries plus anything you revealed to them personally), Image map, World map, and Chat (private party chat, with visibility windows only if they grant them).

**Session.** Schedule (upcoming sessions with RSVP, and the availability polls you post, answered in Discord), Tabletop (the shared table, once they have claimed a character and signed in; on it, select their token and press Open sheet for their character; in a voice channel the same table opens inside Discord from Activities), Initiative (the turn order of a fight the GM is running, whose turn it is, and conditions on the party), Record (the in-person self-recorder), and Check-in (a quick post-session pulse, resubmittable).

**You.** The part that is theirs, not the table's. Campaigns lists every table they play at. Characters is their whole stable across all of them. Threads is a private tracker for favors owed, grudges, and hooks they have not followed up, and nobody else can see it, not even you. Codex gathers what they have learned across every campaign. You as a player is the play-style questionnaire taken AS THEMSELVES, across every campaign; Character play style (This table) is the same questions answered as one character. Settings is where they export everything you hold about them, or delete their account.

## Guests and accounts

A player can start as a guest. Claiming a character with the invite link is enough to play: no signup, no password, nothing to remember.

But a guest lives only in that browser. Clear the history and the character goes with it. So the app offers them an account (Discord, Google, or an emailed link), and linking one changes nothing else: same character, same history, same everything. Nothing is reset and nothing is lost. It only makes it durable.

The reason it matters to you is the stable. Once a player has an account, every character they have ever played is one person's, and the model can read the player underneath the characters. A veteran's new PC then starts from how that person tends to play, rather than from nothing.

## Set up from scratch

Budget about twenty minutes for you, and about a minute per player. The Start here checklist tracks most of this automatically.

1. Create your account and your campaign in the Table workspace. Name the table, pick the system.
2. Build your cast on the Workspace. Class, subclass, species, and lineage or subrace all come from real lists you pick from, so nothing gets mistyped. If you use third-party content, switch the partner toggles on and it appears in the lists. Anything can be edited later in place, so a half-filled character now is fine.
3. Send each player their personal invite link from the Roster (the Copy player invite button). Opening it claims their character and, if they want, lets them save it to an account.
4. Connect Discord: invite the Six Axes bot to your server, press Copy /setup command on the Workspace, and paste it in the channel where you want recaps and polls posted. The code in it works once, within a day, so a player who has your share code cannot move your campaign to another server. Players run /claim once to link their Discord account to their character, and that is also where they consent to being recorded.
5. Copy the player setup link from the Roster (the Table Tap card) and pin it in your Discord channel. Each player installs Six Axes Capture (plus Beyond20 if they roll on D&D Beyond), clicks that link once, and is done. Players in a Roll20 game also open the extension and press Turn on Roll20; it then reads every roll in that game's chat, other players' included. If they open the link while signed in and press Connect the extension to me, their rolls count as verified. Playing in Foundry? The Foundry page (six-axes.com/foundry) has the module and its roll key.
6. Schedule your first session on the Sessions page: propose a few times, players tap the ones they can make in Discord, and you confirm the winner (which creates the session). Tick Make recurring for a standing weekly game.
7. Optional but recommended before your first real night: run a short test. Join voice, /record, say a few words, /stop, and have one player roll something. If events show up on Review and a Mechanics row appears, everything is wired.

## Run a game night

The short version: everyone joins voice, you run /record, you play, you run /stop. Everything after that happens on its own until it needs your judgement.

Easiest of all: open Session, then Tonight. It picks tonight's session for you (the live one, else an open one, else the next scheduled one) and walks every step below in order, linking to the full page for anything deeper.

**Find anything fast.** On any GM page press Ctrl+K (Cmd+K on a Mac), or click Find or jump in the sidebar. Type a few letters to jump to a page, a Codex entry, an NPC, a player character or a session in your active campaign. Whatever you type can also be looked up in the Compendium, or saved on the spot as a new GM-only note or NPC, handy when the party asks the innkeeper's name and you just made it up.

1. Players consent once, when they claim their character. There is no consent prompt at record time and no tab to keep open: if they have the capture extension, their rolls just arrive.
2. Everyone joins the voice channel, then you run /record. The bot joins, captures each speaker on their own track, opens a session, and links you as the narrator. Rolls made on D&D Beyond flow in alongside, attributed to each character. To record into a specific session number, add session:2.
3. Play. If someone new joins voice mid-session, nothing breaks; long sessions are captured in rotating chunks automatically.
4. When you wrap, run /stop. The bot uploads per-speaker audio, and then transcription and event extraction start on their own. You do not have to press anything.
5. Playing in person instead? Skip /record and open Record in person on a laptop or tablet in the middle of the table: confirm everyone agrees, press Start, and press Stop when you wrap. When transcription finishes, map who was speaking on the Speakers page, then review as usual. Alternatively each player can use the self-recorder on their phone (the player Record page), or you can upload per-player audio on the Capture page.

**Somebody does not want to be recorded.** That is fine and it does not stop the session. On the Capture page you can opt any character out of any session; their track is excluded from transcription and from analysis, and everyone else records normally. A player can also withdraw at any time themselves, with Stop recording me in their Settings or /consent off in Discord, and the bot stops keeping their audio within about a minute.

## The tabletop

The shared table for your campaign: battle maps, tokens, handouts and rolls that you and your players see at once. Open it from Session, then Tabletop, or with Open the tabletop on Tonight, which puts it in its own window for a second screen. Players reach it once they have claimed a character and signed in.

**Maps and scenes.** Scenes holds the table's maps. Upload a map image, use a battle map from the World builder, or import a Universal VTT file (the .dd2vtt, .df2vtt and .uvtt files that Dungeondraft, DungeonFog and Arkenforge export), which brings its walls and doors with it. Look at a scene yourself without moving anyone, or send the players to it. Every scene is saved as a snapshot when a session ends, and you can save one by hand; This scene, Snapshots puts one scene back as it was (tokens, drawings, templates, pins, fog and doors), and keeps the way it was just before as a snapshot too. One fight can span several scenes: pick them on the encounter, and the turn order shows the GM which map each combatant is on.

**Tokens.** Tokens adds a creature or character; Everyone in the fight without a token gets one. Select and move with V, measure with M (right-click or Q adds a waypoint), and set height with [ and ]. Each token can carry status markers, resource bars you choose who sees, and a private note only you read. A player opens their own sheet from their token with Open sheet.

**Fog, doors, walls and sight.** Fog of war (U) reveals or hides a room with one click, or squares with the brush. Doors block sight until they are opened. You can draw invisible sight walls at any angle over a map, and turn on vision so players see only what their own tokens can see, inside what the fog reveals. On an uploaded map image, the battle map editor's Sight walls tool can find the walls for you: Find walls in the image proposes them, dashed blue, and you keep them or discard them.

**Floors.** A battle map with several levels becomes one place with floors. A token changes floor at the same spot. A player's token can only change floor standing on stairs, a ladder, a trapdoor or a pit, unless you let players change floors anywhere.

**Drawing, templates and terrain.** Draw (D) with a pen, lines, boxes, ellipses and text; each person erases their own. Area templates (T) are circles, cones, squares and lines you size by dragging or by typing a size in feet. A template can hold fire, cold, lightning or another effect and stays where you put it; with lighting on, fire and radiant light the area around them, so a 5 ft square of fire makes a brazier. Click a template and press Target everyone inside to select every creature it touches; in a fight, a player gets them all as the targets of their saving throw effect, rolled once. Difficult terrain (G) paints squares where movement costs double, and the measure tool counts it.

**Handouts, pins and tables.** Show a handout or picture to everyone or to chosen players, and pop it up again later. Pin a Codex entry to the table. Tables are rollable tables you paste or type, one entry per line, numbered like a book's or as a plain list.

**Card decks.** Make a deck of playing cards (with jokers if you want them) or your own cards, one per line as Name | text, or from a folder of pictures. Shuffle, draw and deal to players; the table keeps track of where every card is. Under a deck, Hand out a card lets you give a chosen card to a player. Your own cards (boons, banes, inspiration) have Use it, which shows the card to the table and returns it to the deck's discards. Save to my library keeps a copy of a deck for any of your campaigns; add it with From my library.

**Sound.** Play music and ambient sound for the whole table. Everyone hears the same moment of the track, even when their clocks disagree.

**Rolls and 3D dice.** Rolls use your system's dice: d20 for D&D and Pathfinder, Hope and Fear for Daggerheart, the power roll for Draw Steel. Rolls you mark as private only you see. Turn on 3D dice to see rolls thrown over the table; it is per browser and stays off when your device asks for reduced motion.

**Add-ons and webhooks.** The Add-ons tab in the tabletop's side panel (yours, not the players') gives a campaign a key for outside programs (bots, stream overlays, scripts) to read and post to the table, and webhooks that tell them when something happens. The full reference for add-on authors is public at /developers.

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

**Balance the fight for the party you actually have.** On Prep, then Encounters. Pick who showed up tonight, add the monsters, and it tells you where the fight lands. It supports both the 2024 XP budget and the 2014 thresholds-and-multiplier method, which genuinely disagree, so pick the one your table uses. If the module was written for four level-5 characters and you have three, it tells you how much to cut. And because it knows your party, it also tells you what they cannot do: no healer, no ranged option, no front line. That moves a fight's real danger further than any multiplier.

**Plan the next session.** The Prep sheet has a planner: jot the scenes and encounters you mean to run, link them to open threads or NPCs, set a difficulty by feel. Suggest prep pre-fills it in one tap, reading your stale threads and who has been quiet. Encounters can drop a balanced fight straight into it.

**The Living Map.** On World, then Image maps, upload your campaign map and click to drop pins. Link each pin to a place, NPC, or lore entry, and set who can see it. Party-visible pins appear on the players' Image map tab.

**Reveals.** On any Codex entry or NPC, Reveal to shows it to a specific player when the story earns it, even while it stays a secret to everyone else. It lands on that player's Lore tab. Party-visible entries already reach the whole table.

**The Campaign Journal.** Build the journal on the Session log stitches your recaps into one flowing chronicle, with the arcs, the loot ledger, the nat-20/nat-1 legends, and the cast. It gives you a public link you can share with anyone.

## Recording, consent, and what happens to it

You are recording your friends' voices. The app takes that seriously and so should you. This is the whole of it, in plain terms.

**Consent is once, not every session.** A player consents when they claim their character, and it stands for the campaign. They never see a consent prompt at record time, because being asked mid-game in front of everyone is not a free choice. On Discord the bot keeps audio only from people who have consented and are not opted out for that session: anyone else's audio is discarded as it arrives and never written down, including people in the channel who are not at the table. Someone who consents mid-session is recorded from about a minute later, and nothing earlier is kept.

**Transcription enforces it.** Transcription will not run if someone present has neither consented nor been opted out. This is not a warning you can click past: the job stops. If it does, the Capture page tells you who.

**Audio is deleted after 60 days.** Automatically, whether or not anyone asks, and nobody can extend it. The transcript and the moments drawn from it stay, because that is the campaign's record. The recording of a person's voice does not. Old moments will show as expired rather than playing, and that is the promise working.

**Players own their data.** On their Settings page, any player can export everything you hold about them, or delete their account. Deleting removes their recordings, their transcribed words, their questionnaire answers, and their notes. Their characters stay in your campaign with the personal link severed, because the story your table told together is yours as well as theirs.

**Emails and unsubscribing.** Every email Six Axes sends (session reminders, recaps, the daily digest) carries a one-click unsubscribe link that works without signing in. Players can also change which emails they get on their Settings page.

**Your responsibility as GM.** Recording law varies, and some places require every person to agree. Say out loud when recording starts, especially on Discord, where the bot joining is the only signal. Be careful with minors: a parent or guardian should consent.

## What to do with them

The point of all this is not the charts. It is five small moves that make the next session better:

1. Open the next session with the recap. Two minutes of 'previously on' gets everyone back in the story and rewards the players who read it early.
2. Balance the spotlight. If Mechanics shows a player rolling half as often as everyone else, or Dispositions shows an axis going quiet, write one scene for them into your next prep (Suggest prep will already be nudging you toward it).
3. Turn the dice into table lore. The nat 1 and nat 20 ledger is shareable gold: call back the fumble, celebrate the clutch 20.
4. Read the HP sparklines as a pacing instrument. If nobody dipped below 75 percent, the night may have been low-stakes; if someone flatlined near zero twice, check the Check-in pulses before turning the difficulty up again.
5. Pick exactly one Dashboard flag per session and address it in prep. One deliberate adjustment a week compounds; five at once is noise.

## Troubleshooting

**A player's rolls are not arriving.** Check three things in this order. Is a session actually open? Rolls are dropped if nothing is live, and that looks exactly like a broken extension. Do they have Six Axes Capture installed, plus Beyond20 if they roll on D&D Beyond, or Roll20 turned on in the extension if they play in Roll20 (then reload the game)? And did they click your /x/ setup link, which is what tells the extension which campaign to send to? A Roll20 roll goes to the character whose name it was rolled under. If a name does not match, send it to the right character from the Roll20 names list on Insight, Mechanics.

**A player's first roll shows as unlinked.** That is expected, and it is not lost. Rolls attach to a character only once that character's D&D Beyond id is known, and the first roll is what teaches it. The extension popup grows a Link your character picker; the player chooses once, and every earlier roll is backfilled and every later one attributes on its own. Tell your players this in advance, or they will assume it failed.

**Rolls show as unverified in Mechanics.** Two causes. Most often the sender has not connected the extension to their account: have them open the player setup link while signed in and press Connect the extension to me. The other is Beyond20 broadcasting formulas instead of results: have them enable D&D Beyond digital dice in Beyond20's options, and from then on their numbers match what the table sees.

**Transcription will not start.** That is the consent gate working. Someone at that table has neither consented nor been opted out. Fix it on the Capture page: opt them out for that session, or have them tap I consent in Discord.

**Recording into the right session.** /record opens a session automatically if none is live. After a false start, run /record session:2 to record into that exact number instead of creating a new one.

**The bot does not join voice.** Join the voice channel yourself before (or right after) running /record; the bot follows the person who requested the recording. If a recording is stuck, /stop clears it.

**A scheduling poll got no responses.** Players answer in Discord, so the bot must be able to post in your channel and players must have run /claim. If the poll did not appear at all, link the channel with /setup first.

**A player's Lore, Map, or Journal is empty.** Those are per-player and need the player to have claimed their character via their personal invite link. Until they claim, they see only party-visible items and no personal read.

**A character seems to be missing from party coverage.** It has no subclass recorded, or a subclass the catalog does not recognise. The Workspace roster flags them and gives you a fix link. A level 1 or 2 character with no subclass is fine and is not flagged, because it genuinely does not have one yet.

**An old moment will not play.** The audio was deleted under the 60-day retention policy. The transcript and the event are still there; the recording is not, and cannot be brought back. That is the policy working, not a fault.

---

Generated from the in-app guide. Edit lib/help-content.mjs and re-run this script.
