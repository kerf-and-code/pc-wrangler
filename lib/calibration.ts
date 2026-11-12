// lib/calibration.ts (2026-11-11, push 39: encounter calibration)
//
// Does the encounter math match your table? For each finished D&D fight that p161 measured
// (combats.calibration: everyone as they first appeared, every time a player character dropped, where
// everyone stood at the end), this works out:
//
//   predicted  the DMG band the encounter math gives for that fight: the monsters' CR against the
//              characters' levels, by the fight's own rules (2024 XP budget, or 2014 thresholds with the
//              multiplier), using lib/tools/encounter-dnd.ts, the same math as the encounter builder
//   observed   rounds; the party's net HP lost (HP at the start minus HP at the end, over the party's
//              maximum, so healing during the fight counts against it); times a character dropped to 0;
//              characters still at 0 when it ended
//
// and then, per predicted band, how fights in that band actually went, plus a rank correlation between
// the predicted band and the HP lost. Nothing here judges a fight "too hard" by a threshold of its own:
// the bands are the DMG's, the outcomes are measurements, and the summary says how many fights each
// number rests on. Kept pure so tests/calibration.test.ts can check it.

import { computeDnd, CR_XP, type DndMethod } from "@/lib/tools/encounter-dnd";

type StartEntry = { kind?: string; name?: string; characterId?: string | null; level?: number | null; cr?: string | null; hp?: number | null; maxHp?: number | null; round?: number };
type EndEntry = { hp?: number | null; maxHp?: number | null; defeated?: boolean };
export type Calibration = { start?: Record<string, StartEntry>; downs?: Record<string, number>; end?: { round?: number; at?: string; combatants?: Record<string, EndEntry> } };
export type FightRow = { id: string; name: string; rules: string; status: string; round: number; created_at: string; ended_at: string | null; encounter_id: string | null; calibration: Calibration | null };

export type FightResult = {
  id: string; name: string; when: string; method: DndMethod;
  predicted: { band: string; bandIndex: number; foeXp: number; budgetTop: number } | null;
  why: string | null;            // why there is no prediction
  pcs: number; monsters: number; monstersWithoutCr: number;
  rounds: number;
  hpLost: number | null;         // party net HP lost, 0..1 of the party's maximum
  downs: number;                 // times a character dropped to 0
  stillDown: number;             // characters at 0 or below when it ended
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One finished fight's prediction and outcome, or null when it was not measured (before p161, still
 *  running, or not D&D). */
export function fightResult(f: FightRow): FightResult | null {
  if (f.status !== "ended" || (f.rules !== "2014" && f.rules !== "2024")) return null;
  const cal = f.calibration ?? {};
  const start = cal.start ?? {};
  const ends = cal.end?.combatants ?? {};
  const ids = Object.keys(start);
  if (!ids.length || !cal.end) return null;
  const method = f.rules as DndMethod;

  const pcIds = ids.filter((id) => start[id]?.kind === "pc");
  const monIds = ids.filter((id) => start[id]?.kind === "monster");
  const levels = pcIds.map((id) => num(start[id]?.level)).filter((l): l is number => l !== null && l >= 1 && l <= 20);
  const crs = monIds.map((id) => start[id]?.cr ?? null);
  const withCr = crs.filter((cr): cr is string => !!cr && CR_XP[cr] !== undefined);
  const monstersWithoutCr = crs.length - withCr.length;

  let predicted: FightResult["predicted"] = null, why: string | null = null;
  if (!pcIds.length) why = "no player characters";
  else if (levels.length < pcIds.length) why = `${pcIds.length - levels.length} character${pcIds.length - levels.length === 1 ? " has" : "s have"} no level`;
  else if (!monIds.length) why = "no monsters";
  else if (monstersWithoutCr) why = `${monstersWithoutCr} monster${monstersWithoutCr === 1 ? " has" : "s have"} no CR`;
  else {
    const counts = new Map<string, number>();
    for (const cr of withCr) counts.set(cr, (counts.get(cr) ?? 0) + 1);
    const v = computeDnd(levels, [...counts.entries()].map(([cr, count]) => ({ cr, count })), method);
    predicted = { band: v.band, bandIndex: v.bandIndex, foeXp: v.foeXp, budgetTop: v.tiers[v.tiers.length - 1] ?? 0 };
  }

  // net HP lost by the party: start HP minus end HP, over the party's maximum; a character with no HP
  // tracked at either end is left out of both sides
  let lost = 0, max = 0, stillDown = 0;
  for (const id of pcIds) {
    const s = start[id], e = ends[id];
    const sHp = num(s?.hp), eHp = num(e?.hp), m = num(e?.maxHp) ?? num(s?.maxHp);
    if (e && eHp !== null && eHp <= 0) stillDown += 1;
    if (sHp === null || eHp === null || !m || m <= 0) continue;
    lost += Math.max(0, sHp - Math.max(0, eHp));
    max += m;
  }
  const downs = pcIds.reduce((n, id) => n + (Number(cal.downs?.[id]) || 0), 0);

  return {
    id: f.id, name: f.name, when: f.ended_at ?? f.created_at, method, predicted, why,
    pcs: pcIds.length, monsters: monIds.length, monstersWithoutCr,
    rounds: Math.max(1, Number(cal.end?.round ?? f.round) || 1),
    hpLost: max > 0 ? Math.min(1, lost / max) : null, downs, stillDown,
  };
}

export type BandSummary = { method: DndMethod; band: string; bandIndex: number; n: number; medianRounds: number; meanHpLost: number | null; downsPerFight: number; fightsWithADown: number };

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
};

/** How fights in each predicted band went, per method (2014 and 2024 bands are different scales). */
export function byBand(results: FightResult[]): BandSummary[] {
  const groups = new Map<string, FightResult[]>();
  for (const r of results) {
    if (!r.predicted) continue;
    const k = `${r.method}|${r.predicted.bandIndex}|${r.predicted.band}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()].map(([k, rs]) => {
    const [method, idx, band] = k.split("|");
    const hp = rs.map((r) => r.hpLost).filter((x): x is number => x !== null);
    return {
      method: method as DndMethod, band, bandIndex: Number(idx), n: rs.length,
      medianRounds: median(rs.map((r) => r.rounds)),
      meanHpLost: hp.length ? hp.reduce((a, b) => a + b, 0) / hp.length : null,
      downsPerFight: rs.reduce((a, r) => a + r.downs, 0) / rs.length,
      fightsWithADown: rs.filter((r) => r.downs > 0).length,
    };
  }).sort((a, b) => (a.method === b.method ? a.bandIndex - b.bandIndex : a.method < b.method ? -1 : 1));
}

/** Spearman's rank correlation (average ranks for ties), or null below 3 pairs or with no spread. */
export function spearman(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs.slice(0, n)), ry = rank(ys.slice(0, n));
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export const MIN_FIGHTS_TO_JUDGE = 10;

/** The plain reading for the GM, honest about how little it rests on. */
export function reading(results: FightResult[], method: DndMethod): { rho: number | null; n: number; text: string } {
  const rs = results.filter((r) => r.method === method && r.predicted && r.hpLost !== null);
  const n = rs.length;
  const rho = spearman(rs.map((r) => r.predicted!.bandIndex), rs.map((r) => r.hpLost as number));
  if (n < MIN_FIGHTS_TO_JUDGE) {
    return { rho, n, text: `${n} measured ${n === 1 ? "fight" : "fights"} so far. Below ${MIN_FIGHTS_TO_JUDGE}, any pattern is as likely to be chance as your table, so nothing is concluded yet.` };
  }
  if (rho === null) return { rho, n, text: `${n} fights, but they all landed in one band or lost the same HP, so there is nothing to compare yet.` };
  const strength = Math.abs(rho) < 0.2 ? "barely" : Math.abs(rho) < 0.4 ? "weakly" : Math.abs(rho) < 0.6 ? "moderately" : "strongly";
  return {
    rho, n,
    text: rho > 0
      ? `Across ${n} fights, harder predictions went with more HP lost, ${strength} (rank correlation ${rho.toFixed(2)}).`
      : `Across ${n} fights, harder predictions did NOT go with more HP lost (rank correlation ${rho.toFixed(2)}): the math is not predicting how your table's fights go.`,
  };
}
