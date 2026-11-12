// lib/vtt/name-route.ts (2026-11-11, push 38: rolls made in Roll20)
//
// A roll from Roll20 carries no D&D Beyond id, only the name it was rolled under in the Roll20 chat
// ("Mira Ashgrove", or "Mira Ashgrove (GM)" when the GM speaks as her). /api/vtt/ingest uses these
// helpers to find the Six Axes character of that name in a campaign with a session underway. A name
// that fits no character, or fits characters in two live campaigns equally, routes nowhere and the roll
// lands unattributed (or is skipped when several campaigns are live), exactly as an unlinked
// D&D Beyond roll does. Kept pure so tests/name-route.test.ts can check it.
//
// Push 44 (audit round 2, T9, B14, G12):
//   - The GM's own choice comes first. On Insight, Mechanics, the GM can say where a Roll20 name goes
//     (a character, or "not a player character"); those choices are vtt_name_links (p167) and are passed
//     in as `links`. A link decides that campaign outright.
//   - Two player characters with the same full name in one campaign: the roll goes nowhere rather than
//     to whichever came first (B14). The GM settles it with a link.
//   - A name that is also a non-player character's in that campaign (its full name, or the first name
//     being matched) is never handed to a player character (T9). Monsters the GM never made a character
//     for can still slip through the first-name rules ("Grim Wolf" for a PC called Grim), which is why
//     Mechanics shows every Roll20 name with where it went and lets the GM move it.

/** The comparable form of a name: lower case, single spaces, without Roll20's " (GM)" tag, the colon
 *  after a speaker's name, or quotes and brackets around it. */
export function normName(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .normalize("NFKC")
    .replace(/\s*\(gm\)\s*$/i, "")
    .replace(/:\s*$/, "")
    .replace(/["'“”‘’[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A character a roll could go to. `kind` is the characters.kind column; anything but "pc" is treated as
 *  a non-player character, which no roll is routed to by name but which blocks its name. */
export type NamedCharacter = { id: string; name: string; campaignId: string; kind?: string | null };

/** The GM's choice for a name in a campaign (vtt_name_links): a character, or null for "not a player
 *  character". `nameNorm` is normName of the Roll20 name. */
export type NameLink = { campaignId: string; nameNorm: string; characterId: string | null };

const isPc = (c: NamedCharacter) => (c.kind ?? "pc") === "pc";
const firstOf = (s: string) => s.split(" ")[0];

/** Where one campaign sends a normalized name: a character, or null. */
function decide(n: string, chars: NamedCharacter[], link: NameLink | undefined): NamedCharacter | null {
  if (link) return link.characterId ? chars.find((c) => c.id === link.characterId) ?? null : null;
  const pcs = chars.filter(isPc);
  const others = chars.filter((c) => !isPc(c));
  // an NPC of this exact name: the roll is theirs, not a player's
  if (others.some((c) => normName(c.name) === n)) return null;
  const full = pcs.filter((c) => normName(c.name) === n);
  if (full.length === 1) return full[0];
  if (full.length > 1) return null; // two PCs share the name: the GM decides (B14)
  // a first name alone, on either side ("Mira" rolling for "Mira Ashgrove", or "Bobert Wildman" in
  // Roll20 for "Bobert" in Six Axes): only when exactly one PC in the campaign fits, and no NPC does
  const head = firstOf(n);
  const fits = (c: NamedCharacter) => { const cn = normName(c.name); return firstOf(cn) === n || (!cn.includes(" ") && cn === head); };
  if (others.some(fits)) return null;
  const first = pcs.filter(fits);
  return first.length === 1 ? first[0] : null;
}

/** The character a roll's name belongs to, among the given characters (all characters in campaigns
 *  with a session underway). `liveTs` is each campaign's session start; the newest wins when the name
 *  fits in two of them. `links` are the GM's choices (vtt_name_links) for those campaigns. */
export function routeByName(actor: unknown, chars: NamedCharacter[], liveTs: Map<string, number>, links: NameLink[] = []): NamedCharacter | null {
  const n = normName(actor);
  if (!n) return null;
  const byCampaign = new Map<string, NamedCharacter[]>();
  for (const c of chars) byCampaign.set(c.campaignId, [...(byCampaign.get(c.campaignId) ?? []), c]);
  for (const l of links) if (!byCampaign.has(l.campaignId)) byCampaign.set(l.campaignId, []);
  let best: NamedCharacter | null = null;
  for (const [cid, list] of byCampaign) {
    const pick = decide(n, list, links.find((l) => l.campaignId === cid && l.nameNorm === n));
    if (pick && (!best || (liveTs.get(pick.campaignId) ?? 0) > (liveTs.get(best.campaignId) ?? 0))) best = pick;
  }
  return best;
}

/** How a stored Roll20 row's name relates to the character it went to, for the GM's list on Mechanics:
 *  "exact" when the names are the same, "partial" when it went by a first name. */
export function matchKind(actor: unknown, characterName: unknown): "exact" | "partial" {
  return normName(actor) === normName(characterName) ? "exact" : "partial";
}
