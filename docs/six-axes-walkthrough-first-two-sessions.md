# Six Axes: Your First Two Sessions

A walkthrough of what actually happens, in order, the first two times you use this. Written
so you can keep it open on a second monitor on game night.

The first session is about proving the plumbing works. The second is where it starts paying
you back.

---

# Session One

## The week before

**Do the two-minute test.** Join voice, `/record`, say a few words, `/stop`, have one player
roll something. If events show on **Review** and a row shows on **Mechanics**, you are wired.

This is the single highest-value thing in this document. Everything else can be fixed on the
night; a broken bot cannot.

**Warn your D&D Beyond players about the first roll.** It will not attribute to their
character. That is expected: the app has to learn their D&D Beyond id, and the first roll is
what teaches it. The extension popup will show a **Link your character** picker; they choose
once and it is permanent, and every earlier roll gets backfilled.

If you skip this warning, at least one player will roll, see nothing, and quietly decide the
tool is broken.

**Check consent.** Everyone who claimed should have consented at claim, or via the `/claim`
button in Discord. If someone has not, the pipeline will stop after the session rather than
transcribe them anyway.

## On the night

### Before you start

Say it out loud: **"I'm recording this session."** On Discord the bot joining the voice
channel is the only signal, and half the table will not notice it.

If someone would rather not be recorded, that is fine and it does not stop anything. Open
**Play → Capture** and opt them out for this session. Their track is excluded from
transcription and from analysis; everyone else records normally.

### Running it

1. Everyone joins voice.
2. You run `/record`.
3. You play.
4. You run `/stop`.

That is the whole of it. The bot captures each speaker on their own track, opens a session,
and links you as the narrator. Rolls from D&D Beyond arrive alongside, attributed to whoever
made them.

**If someone joins voice late, nothing breaks.** If the session runs long, it is captured in
rotating chunks automatically.

## After you wrap

**Do nothing.** Transcription starts on its own within a minute of `/stop`. Extraction follows
it. Go to bed.

## The next day: Review

This is the one thing that needs you, and it is the only one.

**Play → Review.** The extractor has proposed events: who did what, which threads moved, what
was found. Approve, edit, or reject each one.

- Use the **confidence threshold** to accept the obvious ones in a single click.
- **Accept + create** turns a captured NPC, place, or faction into a Codex entry, seeded with
  what you actually narrated about it. Your Codex starts filling itself here.

**When you decide the last proposal, the session finishes itself.** The recap is drafted. The
disposition model refreshes. There is no Done button. (If you want to leave some proposals
undecided on purpose, a button appears to let you.)

## Send the recap

**Play → Sessions.** The recap is already drafted. Read it, fix the names it got wrong, cut
the bits that do not land.

Then: **Email** or **Post to Discord**. Two buttons, one shared draft, so whatever is on
screen is exactly what goes out. Nothing sends without you clicking.

## What to expect from session one

**A good recap, and not much else.** That is correct, and it is not a fault.

| Surface | After one session |
|---|---|
| Recap | Genuinely useful |
| Codex | A few NPCs and places, if you narrated them |
| Mechanics | The dice story of the night. Fun immediately. |
| Timeline | Sparse |
| **Dispositions** | **Mostly the model's starting assumption. Ignore them.** |

**Be honest with yourself about that last row.** A disposition built on one session is a prior
wearing a number. The app says so in plain language and draws the uncertainty band under the
score. **Wide band, thin evidence.** Do not open a conversation with a player about it.

---

# Session Two

Session one proved the plumbing. Session two is where the app starts doing things you could
not do yourself.

## Before: use the prep sheet

**Story → Prep.** It now knows things.

- **Open threads** it heard you leave dangling.
- **NPCs in play** that you introduced and have not returned to.
- **Who has been quiet.** This is the one worth acting on.
- **Suggest prep** pre-fills a planner from all of the above in one tap. Take what is useful,
  ignore the rest.

**Balance the fight for the party you actually have.** Play → **Encounters**. Pick who is
showing up tonight (someone is always missing). Add the monsters. It tells you where the fight
lands.

Two things it does that a generic calculator cannot:

- **If the module was written for four level-5 characters and you have three**, it tells you
  how much XP to cut. Not roughly. Specifically.
- **It tells you what your party cannot do.** No healer. No ranged option. No front line.
  That moves a fight's real danger further than any multiplier, and the published tables do
  not know about it.

You can drop the balanced encounter straight into your prep sheet.

## On the night

**Open with the recap.** Two minutes of "previously on." It gets everyone back into the story
and it quietly rewards the players who read it during the week. This is the highest-return
thing on this page.

Then run it the same way: `/record` … play … `/stop`.

## After: what is different this time

**The Codex is compounding.** Each NPC accretes what you said about them, session by session.
By session five you will have a campaign bible you never wrote.

**The Timeline has shape.** Arcs, loot, who found what and when.

**Mechanics has a baseline.** Now the crits mean something, because there is something to
compare them to.

**The Dashboard has flags.** Plain language, not charts.

> **Pick exactly one flag and address it in your next prep.**
>
> One deliberate adjustment a week compounds. Five at once is noise, and you will not be able
> to tell which one worked.

## The dispositions, still

Two sessions is still thin. The bands will still be wide.

**What to look for instead of a number:** an axis that is conspicuously quiet for one player.
Not "their Rapport is 0.3" — that means little yet — but "nobody has given this player a
scene where Rapport was the answer."

That is a prep problem, not a player problem, and it is fixable in one scene.

---

## When the dispositions actually start meaning something

Roughly: **four or five sessions**, with events approved each time.

Sooner if your players fill in the questionnaire (it gives the model somewhere to start).
Sooner still once a player has run **more than one character**, because then the model can
read the *player* underneath the characters, and a new PC no longer starts from nothing.

**The app will tell you when the evidence is thin.** Believe it. It is the most useful thing
it says.

---

## The two mistakes everyone makes

**1. Reading the dispositions too early.** They look like data from the first session. They
are not. The uncertainty band is not decoration; it is the finding.

**2. Not warning players about the first roll.** They roll, nothing appears, they conclude the
tool is broken, and they never look again. One sentence in your Discord channel prevents this
entirely.

---

## Where things live

| You want | Go |
|---|---|
| The recap | Play → Sessions |
| Approve events | Play → Review |
| Balance a fight | Play → Encounters |
| Opt someone out of recording | Play → Capture |
| Fix a character's class or subclass | Table → Workspace |
| The dice story | Insight → Mechanics |
| Table-health flags | Insight → Dashboard |
| Plan next session | Story → Prep |
