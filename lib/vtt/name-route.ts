// lib/vtt/name-route.ts (2026-11-11, push 38: rolls made in Roll20)
//
// A roll from Roll20 carries no D&D Beyond id, only the name it was rolled under in the Roll20 chat
// ("Mira Ashgrove", or "Mira Ashgrove (GM)" when the GM speaks as her). /api/vtt/ingest uses these
// helpers to find the Six Axes character of that name in a campaign with a session underway. A name
// that fits no character, or fits characters in two live campaigns equally, routes nowhere and the roll
// lands unattributed (or is skipped when several campaigns are live), exactly as an unlinked
// D&D Beyond roll does. Kept pure so tests/name-route.test.ts can check it.

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

export type NamedCharacter = { id: string; name: string; campaignId: string };

/** The character a roll's name belongs to, among the given characters (player characters in campaigns
 *  with a session underway). `liveTs` is each campaign's session start; the newest wins when the same
 *  name is in two of them. The full name must match, or else a first name that only one character in
 *  that campaign has ("Mira" for "Mira Ashgrove", or the other way round). */
export function routeByName(actor: unknown, chars: NamedCharacter[], liveTs: Map<string, number>): NamedCharacter | null {
  const n = normName(actor);
  if (!n) return null;
  const newest = (list: NamedCharacter[]) =>
    list.reduce<NamedCharacter | null>((best, c) => (!best || (liveTs.get(c.campaignId) ?? 0) > (liveTs.get(best.campaignId) ?? 0) ? c : best), null);
  const full = chars.filter((c) => normName(c.name) === n);
  if (full.length) return newest(full);
  // a first name alone, on either side ("Mira" rolling for "Mira Ashgrove", or "Breena Stumbleduck
  // Timbers" in Roll20 for "Breena" in Six Axes): only when exactly one character in a campaign fits
  const head = n.split(" ")[0];
  const first = chars.filter((c) => { const cn = normName(c.name); return cn.split(" ")[0] === n || (!cn.includes(" ") && cn === head); });
  const byCampaign = new Map<string, NamedCharacter[]>();
  for (const c of first) byCampaign.set(c.campaignId, [...(byCampaign.get(c.campaignId) ?? []), c]);
  const unique = [...byCampaign.values()].filter((l) => l.length === 1).map((l) => l[0]);
  return unique.length ? newest(unique) : null;
}
