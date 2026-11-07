import {
  CLASSES, FUNNEL, SOURCES, SUBCLASSES,
  type FunnelOption, type Role, type Subclass, type Theme,
} from "@/lib/tools/class-quiz-data";

// lib/tools/class-quiz.ts (2026-11-07)
//
// The engine behind the free "What D&D class should I be?" quiz. Pure: no React, no DOM, so the logic
// can be checked on its own. Ported from the standalone quiz Terry supplied, same behavior:
//
//   * The opening questions are hand written (FUNNEL). An answer leads to another question, to one
//     subclass ("r:<id>"), or into a class branch ("c:<class>").
//   * A class branch is built on the fly from the subclasses' tags. At each step it picks the unasked
//     axis (where you fight, flavor of power, role, theme, tone) that splits the remaining subclasses
//     most evenly; with three or fewer left, or no useful split, it asks a final "which sounds like you".
//   * Options whose every path is filtered out (2024 only, official only) are hidden, and a question
//     with only one live answer is answered automatically and shown as such in the trail.
//
// Node ids for a branch carry their constraints: "c:<class>~<axis>=<value>~<axis>=<value>".

export const BY_ID: Record<string, Subclass> = Object.fromEntries(SUBCLASSES.map((r) => [r.id, r]));
export const CLASS_ORDER = Object.keys(CLASSES);
export const className = (k: string) => CLASSES[k]?.name ?? k;

export type Filters = { legacy: boolean; partner: boolean };

export const isPartner = (r: Subclass) => !!SOURCES[r.s]?.publisher;
export const isAllowed = (r: Subclass, f: Filters) =>
  (f.legacy || r.e === "24" || r.e === "B") && (f.partner || !isPartner(r));

type AxisKey = "rgroup" | "tgroup" | "role" | "theme" | "tone";
type Axis = { q: string; get: (r: Subclass) => string[]; v: Record<string, [string, string]> };

const RG: Record<Role, string> = {
  tank: "front", melee: "front", ranged: "back", control: "back",
  support: "team", heal: "team", pet: "team", skill: "skill",
};
const TG: Record<Theme, string> = {
  holy: "life", nature: "life", beast: "life",
  death: "dark", blood: "dark", shadow: "dark", infernal: "dark", eldritch: "dark",
  arcane: "mystic", mind: "mystic", cosmic: "mystic", fey: "mystic",
  elements: "force", martial: "force",
  luck: "craft", tech: "craft",
};
const uniq = <T,>(a: T[]) => [...new Set(a)];

const AXES: Record<AxisKey, Axis> = {
  rgroup: {
    q: "When the fight starts, where do you want to be?",
    get: (r) => uniq(r.r.map((x) => RG[x])),
    v: {
      front: ["On the front line", "Where the blows land."],
      back: ["Behind the line, running the fight", "Distance, magic, and control."],
      team: ["Right beside my friends, making them stronger", "Healing, buffs, or a companion."],
      skill: ["Honestly, the fight is not my favorite part", "Scouting, talking, solving."],
    },
  },
  tgroup: {
    q: "What flavor is your power?",
    get: (r) => uniq(r.t.map((x) => TG[x])),
    v: {
      life: ["Light and life", "Faith, nature, and beasts."],
      dark: ["Dark and dangerous", "Death, blood, shadow, hell, the unknowable."],
      mystic: ["Mysterious and arcane", "Spells, minds, stars, and the fey."],
      force: ["Raw force and skill", "The elements, or pure training."],
      craft: ["Clever craft and chance", "Gadgets, guns, alchemy, and luck."],
    },
  },
  role: {
    q: "Be more specific. In combat you are:",
    get: (r) => r.r,
    v: {
      tank: ["The wall", "Nobody gets past me."],
      melee: ["The blade", "I hit hard up close."],
      ranged: ["The artillery", "I hit hard from afar."],
      control: ["The puppeteer", "Curses, terrain, and conditions."],
      support: ["The banner", "Allies fight better near me."],
      heal: ["The medic", "Nobody dies on my watch."],
      skill: ["The specialist", "Scouting, talking, solving problems."],
      pet: ["The handler", "I fight alongside a companion or summons."],
    },
  },
  theme: {
    q: "Narrow it down. Your power smells like:",
    get: (r) => r.t,
    v: {
      holy: ["Incense and sunlight", "The divine."],
      nature: ["Moss and rain", "The green world."],
      beast: ["Fur and musk", "Beasts and the hunt."],
      death: ["Grave dirt", "Death and undeath."],
      blood: ["Copper", "Blood and sacrifice."],
      shadow: ["Nothing at all", "Shadow and stealth."],
      infernal: ["Brimstone", "Hellfire and fiends."],
      eldritch: ["Something wrong", "Eldritch horror and madness."],
      arcane: ["Old parchment", "Arcane study."],
      mind: ["A storm inside your skull", "Psionics, time, and fate."],
      cosmic: ["Starlight", "Moons, stars, and other planes."],
      fey: ["Wildflowers and mischief", "The fey."],
      elements: ["Smoke and ozone", "Fire, ice, lightning, and sea."],
      martial: ["Sweat and steel", "Pure training."],
      luck: ["Dice and cards", "Luck and chaos."],
      tech: ["Gunpowder and solvent", "Guns, alchemy, and gadgets."],
    },
  },
  tone: {
    q: "What kind of story are you in?",
    get: (r) => [r.o],
    v: {
      heroic: ["A heroic adventure", "Good guys, big moments."],
      grim: ["A grim, dark tale", "Nothing comes free."],
      whimsy: ["Something strange or funny", "The weird stuff is the good stuff."],
    },
  },
};
const AX_ORDER: AxisKey[] = ["rgroup", "tgroup", "role", "theme", "tone"];

export const ROLE_LABEL: Record<Role, string> = {
  tank: "Tank", melee: "Melee damage", ranged: "Ranged damage", control: "Control",
  support: "Support", heal: "Healer", skill: "Skills and utility", pet: "Companion or summons",
};

export type QNode = { q: string; s?: string; o: FunnelOption[]; final?: boolean };

// The first sentence of a description becomes the option label on a final question; the rest, its line.
export function firstSentence(b: string): [string, string] {
  const m = b.match(/^(.+?[.!?])(\s|$)/);
  return m ? [m[1], b.slice(m[1].length).trim()] : [b, ""];
}

export type Quiz = {
  getNode: (id: string) => QNode;
  reach: (target: string) => string[];
  visible: (id: string) => FunnelOption[];
};

export function makeQuiz(f: Filters): Quiz {
  const memo = new Map<string, string[]>();
  const nodes = new Map<string, QNode>();

  function classNode(id: string): QNode {
    const parts = id.slice(2).split("~");
    const cls = parts[0];
    const cons = parts.slice(1).map((p) => p.split("=") as [AxisKey, string]);
    let C = SUBCLASSES.filter((r) => r.c === cls && isAllowed(r, f));
    for (const [a, v] of cons) C = C.filter((r) => AXES[a].get(r).includes(v));
    const asked = new Set(cons.map((c) => c[0]));
    if (C.length <= 1) return { q: "", o: C.map((r): FunnelOption => [r.n, "", "r:" + r.id]) };

    let best: { a: AxisKey; vals: string[]; sizes: number[]; mx: number } | null = null;
    if (C.length > 3) {
      for (const a of AX_ORDER) {
        if (asked.has(a)) continue;
        const vals = uniq(C.flatMap((r) => AXES[a].get(r)));
        if (vals.length < 2 || vals.length > (C.length > 6 ? 9 : 7)) continue;
        const sizes = vals.map((v) => C.filter((r) => AXES[a].get(r).includes(v)).length);
        const mx = Math.max(...sizes);
        if (mx >= C.length) continue;
        if (!best || mx < best.mx) best = { a, vals, sizes, mx };
      }
    }
    if (best) {
      const ax = AXES[best.a];
      const b = best;
      return {
        q: ax.q,
        o: b.vals
          .map((v, i) => ({ opt: [ax.v[v][0], ax.v[v][1], `${id}~${b.a}=${v}`] as FunnelOption, n: b.sizes[i] }))
          .sort((x, y) => y.n - x.n)
          .map((x) => x.opt),
      };
    }
    return {
      q: "Last one. Which of these sounds most like you?",
      final: true,
      o: C.map((r): FunnelOption => { const [a, b] = firstSentence(r.b); return [a, b, "r:" + r.id]; }),
    };
  }

  function getNode(id: string): QNode {
    const hit = nodes.get(id);
    if (hit) return hit;
    const n = id.startsWith("c:") ? classNode(id) : FUNNEL[id];
    nodes.set(id, n);
    return n;
  }

  function reach(t: string): string[] {
    if (t.startsWith("r:")) {
      const r = BY_ID[t.slice(2)];
      return r && isAllowed(r, f) ? [r.id] : [];
    }
    const hit = memo.get(t);
    if (hit) return hit;
    memo.set(t, []); // breaks any cycle while this node is being walked
    const s = new Set<string>();
    for (const o of getNode(t).o) for (const x of reach(o[2])) s.add(x);
    const out = [...s];
    memo.set(t, out);
    return out;
  }

  const visible = (id: string) => getNode(id).o.filter((o) => reach(o[2]).length > 0);
  return { getNode, reach, visible };
}

export type Step = { node: string; text: string; to: string; auto: boolean };

export const currentOf = (stack: Step[]) => (stack.length ? stack[stack.length - 1].to : "start");

// Walk forward through any question that has only one live answer, recording it as automatic.
export function settle(q: Quiz, stack: Step[]): Step[] {
  const out = [...stack];
  for (let guard = 0; guard < 30; guard++) {
    const c = currentOf(out);
    if (c.startsWith("r:")) break;
    const v = q.visible(c);
    if (v.length !== 1) break;
    out.push({ node: c, text: v[0][0], to: v[0][2], auto: true });
  }
  return out;
}

export function choose(q: Quiz, stack: Step[], i: number): Step[] {
  const c = currentOf(stack);
  const o = q.visible(c)[i];
  if (!o) return stack;
  return settle(q, [...stack, { node: c, text: o[0], to: o[2], auto: false }]);
}

// Back undoes the last real answer and every automatic step that followed it.
export function back(stack: Step[]): Step[] {
  const out = [...stack];
  while (out.length && out[out.length - 1].auto) out.pop();
  out.pop();
  return out;
}

// Runners-up for a result: the other subclasses still reachable at the last real question, topped up
// from the same class, at most six.
export function runnersUp(q: Quiz, stack: Step[], id: string): string[] {
  const r = BY_ID[id];
  const lastReal = [...stack].reverse().find((s) => !s.auto && s.node !== "alt");
  if (!lastReal || !r) return [];
  let alts = q.reach(lastReal.node).filter((x) => x !== id);
  if (alts.length < 3) alts = alts.concat(q.reach("c:" + r.c).filter((x) => x !== id && !alts.includes(x)));
  return alts.slice(0, 6);
}

export function editionLabel(r: Subclass): string {
  if (isPartner(r)) return r.e === "24" ? "2024 rules" : r.e === "B" ? "2014 and 2024 versions" : "2014-era rules";
  return r.e === "L" ? "2014 legacy" : "2024 rules";
}

export function publisherLabel(r: Subclass): string {
  const p = SOURCES[r.s]?.publisher;
  if (!p) return "Wizards of the Coast";
  return p === "Partnered" ? "Partnered publisher" : `${p} (partnered)`;
}
