# Six Axes: GM Onboarding

From an empty account to a recorded, analysed session. About twenty minutes of your time,
about a minute of each player's.

The **Start here** checklist in the app tracks most of this. This document is the version
you can read on the bus.

---

## Before you start

You need:

- **A Discord server** you can invite a bot to. This is how voice gets captured and how
  your players RSVP and consent.
- **Players.** That is genuinely it. They do not need accounts, they do not need to install
  anything, unless they roll on D&D Beyond.

You do **not** need: a VTT, a paid plan, or anyone to sign up for anything.

---

## 1. Make a campaign

Table → **Workspace**. Name it, pick the system. Thirty seconds.

## 2. Build your cast

Still on the Workspace, add each player character.

Class, subclass, species, and lineage or subrace all come from **real lists you pick from**.
Nothing is typed, so nothing gets mistyped. If your table uses third-party content, flip the
partner toggles on and it appears in the lists.

**A half-filled character now is fine.** Every field is editable in place afterwards, and
editing preserves the character's history. You are not locked into anything.

> **Levels matter more than they look.** The encounter balancer and the party-coverage panel
> both read them, and a character with no level is quietly excluded from both. Set them when
> you know them.

## 3. Send the invite links

Table → **Roster** → **Copy player invite** next to each character.

That link is personal to one character. Opening it claims that character for whoever clicked
it, and the app offers them an account so it does not evaporate when they clear their browser.
They can decline and play as a guest. Either works.

**They consent to recording here, or in Discord at `/claim`.** Once, for the campaign. They
will never be asked again mid-game.

## 4. Connect Discord

1. Invite the Six Axes bot to your server (the button is on the Workspace).
2. In the channel where you want recaps and polls, run:
   ```
   /setup code:<your share code>
   ```
3. Each player runs `/claim` once. This links their Discord account to their character, so
   the app knows whose voice is whose, and it is where the consent button appears.

## 5. If your players roll on D&D Beyond

Table → **Roster** → the **Table Tap** card → **Copy player setup link**.

Pin that link in Discord. Each player, once:

1. Install **Beyond20** (they may already have it).
2. Install **Six Axes Capture**.
3. Click your link.

Done. **No custom domains. No keeping a tab open.** The old setup took about thirty minutes
for five players and silently failed for some of them; this is three clicks.

> **Tell them about the first roll.** The first time a player rolls, it will not attribute to
> their character yet: the app has to learn their D&D Beyond id, and that first roll is what
> teaches it. The extension popup will show a **Link your character** picker. They choose
> once, every earlier roll is backfilled, and every later roll attributes automatically
> forever.
>
> If you do not warn them, they will roll, see nothing, and assume it is broken.

## 6. Schedule the first session

Play → **Sessions**. Propose a few times, post the poll to Discord, players tap what they can
make, you confirm the winner. That creates the session. Tick **Make recurring** for a standing
weekly game.

## 7. Do a two-minute test

Worth it. Genuinely.

Join voice → `/record` → say a few words → `/stop` → have one player roll something.

If events appear on **Review** and a row appears on **Mechanics**, every part of the chain is
wired. If they do not, you would much rather find that out now than at 8pm on game night.

---

## What happens on game night

```
Everyone joins voice
  → /record          (the bot joins and records each speaker separately)
  → play
  → /stop            (and then you do nothing)
```

Transcription starts on its own. Extraction follows. By the time you look, the proposed events
are usually waiting.

**Then there is exactly one thing for you to do: Review.** Approve, edit, or reject each
proposed event. When you decide the last one, the session finishes itself: the recap is
drafted and the disposition model refreshes. There is no Done button to remember.

Edit the recap on the Session Log and send it. **Email** and **Post to Discord** are separate
buttons over the same draft, so what you see on screen is exactly what goes out.

---

## Consent, and why the app is stubborn about it

You are recording your friends' voices. Three things are true and worth knowing before you
start:

**Consent is once, at claim, not every session.** Nobody gets asked mid-game in front of the
whole table, because that is not a free choice.

**The pipeline will refuse to run.** If someone present has neither consented nor been opted
out, transcription stops. This is not a warning you can click past. If it happens, the Capture
page tells you who, and you can either get their consent or opt them out for that session.
Either way the rest of the table records normally.

**Audio is deleted after 60 days.** Automatically. Nobody can extend it, including you. The
transcript and the moments stay; the recording of a person's voice does not. Old moments will
show as **expired** rather than playing, and that is the promise being kept.

**Your part:** say out loud when recording starts. On Discord, the bot joining the channel is
the only signal, and not everyone will notice it.

---

## What you get, and when

| When | What |
|---|---|
| Straight away | The session timeline: what was said, what was rolled |
| After you review | Recaps, the Codex filling itself, arcs and loot on the Timeline |
| After a session or two | Mechanics (the dice story), the Dashboard's table-health flags |
| After several sessions | Dispositions that mean something |

**Be patient with the dispositions.** A read built on one session is mostly the model's
starting assumption wearing a number. The app tells you when that is true and draws the
uncertainty band under the score. **Wide band, thin evidence.** Do not sit a player down and
talk about a wide band.

---

## The five-minute version

1. Make a campaign, add characters.
2. Send invite links. Players claim and consent.
3. `/setup` in Discord. Players `/claim`.
4. D&D Beyond players: install two extensions, click one link.
5. `/record` … play … `/stop`.
6. Review the events. Send the recap.

Everything else is the app doing its job.
