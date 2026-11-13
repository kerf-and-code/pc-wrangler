// scripts/build-docs/docs/six-axes-player-quick-card.mjs: the words of this document. Edit here, then run npm run docs.
import { build, tbl } from "../lib.mjs";
const makeDoc = (outDir) => build(`${outDir}/six-axes-player-quick-card.docx`, [
  ["title", "Six Axes: Player Quick Card"],
  ["sub", "A few minutes of setup, then it runs itself. The full Player Guide is under Help in the app."],

  ["rule", "Set yourself up"],
  ["ul", [
    "**In your campaign's Discord channel, run /claim** and pick your character. Read the short note on recording, then tap **I consent**. That is your consent for the campaign, given once; nobody asks again mid-game.",
    "**Then run /mypage.** Open the link it sends and sign in with the same Discord account. Every character of yours at that table, and at any other Six Axes table, attaches at once. No Discord? Open the personal invite link your GM sent you instead.",
    "**Install Six Axes Capture** if you roll on D&D Beyond or in Roll20. Get it from the Chrome Web Store: search for Six Axes Capture.",
    "**Click the setup link your GM pinned**, while signed in, and press **Connect the extension to me**. D&D Beyond players also need Beyond20. Roll20 players open the extension, press **Turn on Roll20**, and reload the game.",
  ]],
  ["note", "**Your first D&D Beyond roll will not show under your character.** That is expected. The extension popup shows a **Link your character** picker: choose once, every earlier roll is backfilled, and every later one attributes on its own."],

  ["rule", "At the table"],
  ["p", "**Tabletop.** Session → Tabletop opens the shared map. Move your own token, plus any token your GM hands to your character (a familiar, a summon). Select your token and press **Open sheet** for your character sheet. **My tokens** on the Tokens tab keeps looks you saved, or tokens your GM gave you, to place on the table yourself."],
  ["p", "**Saves.** A save a monster forces on you appears on your sheet (**save due**), the tabletop, the Initiative page and the Discord Activity (Activities, in a voice call). Roll it, or type the total from your own dice."],
  ["p", "**Read the recap before each session.** Two minutes, and you will be the one who remembers the NPC's name."],

  ["rule", "What is where"],
  tbl([0.2, 0.3, 0.2, 0.3], [
    ["**Recaps**", "Last session, written up", "**Character sheet**", "Your sheet: HP, slots, resources, saves"],
    ["**Lore**", "The campaign wiki, as far as you know it", "**Threads**", "Yours alone. Nobody sees it, not even your GM"],
    ["**Journal**", "Your story so far, and how you actually play", "**Chat**", "Players only. Closes while a session is live"],
    ["**Schedule**", "RSVP to sessions and polls", "**Record**", "Backs up your own mic, if your line is bad"],
    ["**Initiative**", "Whose turn it is, and saves waiting on you", "**Character library**", "Builds you can reuse at another table"],
    ["**Image map, World map**", "The world, as your GM reveals it", "**Notes**", "Your own notes"],
  ], true),

  ["rule", "Your read, and how to take it"],
  ["p", "The app reads six axes: **Tactics**, **Arcana**, **Voice**, **Exploration**, **Rapport** and **Nerve**. It is not a score and no axis is the good one. It exists so your GM notices when they have not given you a scene that plays to what you enjoy. Ignore it for the first few sessions: the band under each score is the point, and a wide band means thin evidence. Fill in **Character play style** (This table) once, early, so it has somewhere to start."],

  ["rule", "Your voice, your data"],
  ["p", "**Audio is deleted 60 days after it is recorded**, automatically. Nobody can extend it. Transcripts and moments stay; the recording of your voice does not."],
  ["p", "**Change your mind any time.** Press **Stop recording me** in Settings, or run /consent choice:off in Discord. The bot stops keeping your audio within about a minute; **I consent to recording** turns it back on. **Settings → Export my data** gives you everything held about you."],
], { compact: true });

export default makeDoc;
