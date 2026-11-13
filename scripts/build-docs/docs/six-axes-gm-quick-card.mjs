// scripts/build-docs/docs/six-axes-gm-quick-card.mjs: the words of this document. Edit here, then run npm run docs.
import { build, tbl } from "../lib.mjs";
const makeDoc = (outDir) => build(`${outDir}/six-axes-gm-quick-card.docx`, [
  ["title", "Six Axes: GM Quick Card"],
  ["sub", "Everything you need on game night, on one page. The full documents are under Help in the app."],

  ["rule", "Once, when you set up"],
  ["ul", [
    "**Home → Workspace.** Make the campaign, add each character, set levels (the encounter balancer ignores a character without one). Players can build their own instead.",
    "**Link Discord.** Invite the bot (Workspace), press **Copy /setup command** and paste it in your recaps channel. The code works once, within a day.",
    "**Players run /claim** (pick their character, tap I consent), then **/mypage** and sign in with Discord. No Discord? Home → Roster → **Copy player invite**.",
    "**Rolls.** Home → Roster → Table Tap → copy the player setup link and pin it. Players install Six Axes Capture from the Chrome Web Store, plus Beyond20 for D&D Beyond, or press Turn on Roll20. Foundry tables install the module from six-axes.com/foundry.",
    "**Do the two-minute test.** Join voice, /record, a few words, /stop, one roll. Events on Review and a row on Mechanics mean the whole chain is wired.",
  ]],

  ["rule", "Game night"],
  ["p", "**Open Session → Tonight.** It picks tonight's session and walks the night top to bottom: who is here, consent, go live, record, log moments, the fight, then **End and process**."],
  ["p", "**Say out loud that you are recording.** The bot joining the channel is the only other signal and half the table will miss it."],
  ["p", "**Everyone joins voice → /record → play → /stop.** Late arrivals and long sessions are fine. If the bot restarts mid-session it rejoins and carries on; it says so in your channel. In person: Session → **Record in person** instead."],

  ["rule", "The next day"],
  ["p", "**After → Review is the only thing that needs you.** Approve, edit or reject each event; Accept + create turns an NPC or place into a Codex entry. Deciding the last one finishes the session: the recap drafts, the model refreshes."],
  ["p", "**After → Session log:** edit the recap, then **Email** or **Post to Discord**. In person, name the voices on **After → Speakers** first."],

  ["rule", "Before session two"],
  ["p", "**Prep → Prep sheet** knows your open threads, idle NPCs and who has been quiet; **Suggest prep** fills the planner. **Prep → Encounters** balances for who is actually coming and names what the party cannot do. Open with the recap."],

  ["rule", "The three that bite everyone"],
  ["p", "**1. The first D&D Beyond roll will not attribute.** Warn your players: they pick their character once in the extension popup and earlier rolls backfill."],
  ["p", "**2. Dispositions mean nothing for four or five sessions.** A wide band is the finding. Calibration likewise concludes nothing below ten measured fights."],
  ["p", "**3. Consent is per person.** The bot discards the audio of anyone who has not consented as it arrives; it cannot be recovered. Players fix it with I consent in Discord or Settings, and are recorded about a minute later. **After → Capture** opts someone out for the night."],

  ["rule", "Where things live"],
  tbl([0.22, 0.28, 0.22, 0.28], [
    ["**Run the night**", "Session → Tonight", "**Balance a fight**", "Prep → Encounters"],
    ["**Approve events**", "After → Review", "**Build a monster**", "Prep → Monster maker"],
    ["**Send the recap**", "After → Session log", "**Plan next session**", "Prep → Prep sheet"],
    ["**Opt someone out**", "After → Capture", "**The dice story**", "Insight → Mechanics"],
    ["**Invite links, setup link**", "Home → Roster", "**How fights went**", "Insight → Calibration"],
    ["**Co-GMs, Duplicate, export**", "Home → Workspace", "**Share a player's read**", "Insight → Dispositions"],
    ["**Ask about the campaign**", "World → Ask the campaign", "**Build the world**", "World → World builder"],
  ], true),
], { compact: true });

export default makeDoc;
