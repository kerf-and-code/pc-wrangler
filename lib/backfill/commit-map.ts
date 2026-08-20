// lib/backfill/commit-map.ts
//
// The pure mapping from an approved EntityCandidate to the exact row the app already stores, so the
// commit route writes the SAME shapes as app/api/lore-triage and app/api/lore-retro. Kept pure (no DB,
// no client) so it is unit-tested here; the route consumes CommitPlan and does the dedupe + insert with
// the admin client.
//
// Storage map (from the live schema: entries.type in note|location|lore, characters.kind in pc|npc):
//   npc      -> characters(kind='npc')
//   location -> entries(type='location')
//   faction  -> entries(type='lore', tags=['faction'])
//   item     -> entries(type='lore', tags=['item'])
//   lore     -> entries(type='lore')
//   pc       -> NOT auto-created: a PC is a real person's character (characters.profile_id). We surface
//               it for the GM to link to a player, never invent one blind.
//
// Imported rows are written visibility='gm' (GM-only) so a bulk import never surfaces to players before
// the GM publishes it. The review UI can bulk-raise visibility to 'player'.

import type { CandidateKind, EntityCandidate } from "./extract";

export type CharacterInsert = {
  campaign_id: string;
  kind: "npc";
  name: string;
  description: string | null;
  active: true;
  visibility: "gm";
};

export type EntryInsert = {
  campaign_id: string;
  created_by: string;
  type: "location" | "lore";
  title: string;
  body: string | null;
  visibility: "gm";
  tags?: string[];
};

// How the commit route should look for an existing row to fold into instead of duplicating, matching the
// ilike-title/name dedupe the lore routes use.
export type Dedupe =
  | { table: "characters"; kind: "npc"; nameIlike: string }
  | { table: "entries"; type: "location" | "lore"; titleIlike: string };

export type CommitPlan =
  | { table: "characters"; insert: CharacterInsert; dedupe: Dedupe; appendField: "description" }
  | { table: "entries"; insert: EntryInsert; dedupe: Dedupe; appendField: "body" }
  | { table: null; reason: string };

export function planCommit(
  cand: EntityCandidate,
  ctx: { campaignId: string; userId: string },
): CommitPlan {
  const name = cand.name.trim();
  const body = cand.body.trim() || null;
  const kind: CandidateKind = cand.kind;

  if (!name) return { table: null, reason: "candidate has no name" };

  if (kind === "npc") {
    return {
      table: "characters",
      insert: { campaign_id: ctx.campaignId, kind: "npc", name, description: body, active: true, visibility: "gm" },
      dedupe: { table: "characters", kind: "npc", nameIlike: name },
      appendField: "description",
    };
  }

  if (kind === "pc") {
    return { table: null, reason: "PC: link to a player in review rather than auto-create" };
  }

  if (kind === "location") {
    return {
      table: "entries",
      insert: { campaign_id: ctx.campaignId, created_by: ctx.userId, type: "location", title: name, body, visibility: "gm" },
      dedupe: { table: "entries", type: "location", titleIlike: name },
      appendField: "body",
    };
  }

  // faction, item, lore all live as type='lore'; faction/item carry a reserved tag.
  const tags = kind === "faction" ? ["faction"] : kind === "item" ? ["item"] : undefined;
  const insert: EntryInsert = {
    campaign_id: ctx.campaignId, created_by: ctx.userId, type: "lore", title: name, body, visibility: "gm",
    ...(tags ? { tags } : {}),
  };
  return {
    table: "entries",
    insert,
    dedupe: { table: "entries", type: "lore", titleIlike: name },
    appendField: "body",
  };
}

// Fold new text onto an existing row's field without stacking a duplicate paragraph, the same rule
// appendFact uses in the lore routes. Pure: returns the next value, or null when nothing changes.
export function foldText(current: string | null, fact: string | null): string | null {
  const f = (fact || "").trim();
  if (!f) return null;
  const cur = (current || "").trim();
  if (cur.toLowerCase().includes(f.toLowerCase())) return null;
  return cur ? `${cur}\n\n${f}` : f;
}
