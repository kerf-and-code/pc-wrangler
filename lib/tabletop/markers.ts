import { markerKind, MARKER_COLORS } from "@/lib/combat-effects";

// lib/tabletop/markers.ts (2026-11-08)
//
// Status markers for tokens: small round badges with an icon, the way a GM marks who is blessed, who is
// bleeding, who is the leader. All the art is Six Axes' own, drawn on a 24 by 24 grid as SVG path data,
// so the same shapes draw on the tabletop canvas (Path2D) and in the panels (inline <svg>).
//
// Two sources put markers on a token: the fight (the conditions, buffs and debuffs on the combatant, in
// lib/combat-effects.ts) and the token itself (style.markers, any marker from the library below, set by
// the GM on any token and by a player on their own). A token marker can carry a number ("bleeding 3",
// "a 5 for the round it ends"); it is stored as "id" or "id|n".
//
// Two looks, picked per viewer: "color" draws each icon in its own colour, "plain" white on black.
// Colour dots keep their colour in both, since the colour is the meaning.

export type MarkerStyle = "color" | "plain";
export const MARKER_STYLES: { key: MarkerStyle; label: string }[] = [
  { key: "color", label: "Colour" },
  { key: "plain", label: "Black and white" },
];
export const MARKER_STYLE_KEY = "sixaxes:marker-style";

/** One stroke or shape of an icon. Strokes are 2 units wide with round ends unless `w` says otherwise. */
export type Part = { d: string; fill?: boolean; evenodd?: boolean; dash?: boolean; w?: number };
type Icon = { color: string; parts: Part[]; swatch?: boolean };

export type MarkerCat = "color" | "condition" | "buff" | "debuff" | "damage" | "gear" | "status";
export const MARKER_CATS: { key: MarkerCat; label: string }[] = [
  { key: "color", label: "Colours" },
  { key: "status", label: "Status" },
  { key: "condition", label: "Conditions" },
  { key: "buff", label: "Buffs" },
  { key: "debuff", label: "Debuffs" },
  { key: "damage", label: "Damage types" },
  { key: "gear", label: "Weapons and gear" },
];

// ---- drawing helpers (all on the 24 by 24 grid) ----

const f2 = (n: number) => +n.toFixed(2);
const ring = (cx: number, cy: number, r: number) => `M${f2(cx - r)} ${f2(cy)}a${r} ${r} 0 1 0 ${f2(r * 2)} 0a${r} ${r} 0 1 0 ${f2(-r * 2)} 0z`;
const star = (cx: number, cy: number, ro: number, ri: number, n = 5) => {
  let d = "";
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? ri : ro;
    d += `${i ? "L" : "M"}${f2(cx + Math.cos(a) * r)} ${f2(cy + Math.sin(a) * r)}`;
  }
  return d + "z";
};
const rays = (cx: number, cy: number, r0: number, r1: number, n: number, off = 0) => {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = off + (i * Math.PI * 2) / n;
    d += `M${f2(cx + Math.cos(a) * r0)} ${f2(cy + Math.sin(a) * r0)}L${f2(cx + Math.cos(a) * r1)} ${f2(cy + Math.sin(a) * r1)}`;
  }
  return d;
};
const snowTicks = () => {
  let d = "";
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3, bx = 12 + Math.cos(a) * 6.5, by = 12 + Math.sin(a) * 6.5;
    for (const s of [-1, 1]) {
      const b = a + s * 0.75;
      d += `M${f2(bx)} ${f2(by)}L${f2(bx + Math.cos(b) * 3)} ${f2(by + Math.sin(b) * 3)}`;
    }
  }
  return d;
};
const drop = (cx: number, top: number, r: number) => `M${cx} ${top}c${f2(r * 0.6)} ${f2(r * 1.4)} ${r} ${f2(r * 2)} ${r} ${f2(r * 2.6)}a${r} ${r} 0 0 1 ${f2(-r * 2)} 0c0-${f2(r * 0.6)} ${f2(r * 0.4)}-${f2(r * 1.2)} ${r}-${f2(r * 2.6)}z`;
const SHIELD = "M12 2.8l8 3v6c0 5-3.6 8.2-8 9.4-4.4-1.2-8-4.4-8-9.4v-6z";
const HEART = "M12 20.5s-8-4.8-8-10.6A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 8 2.3c0 5.8-8 10.6-8 10.6z";
const FLAME = "M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z";

// ---- the library ----

type Def = { id: string; label: string; cat: MarkerCat; icon: Icon };
const D = (id: string, label: string, cat: MarkerCat, color: string, parts: Part[]): Def => ({ id, label, cat, icon: { color, parts } });
const dot = (id: string, label: string, color: string): Def => ({ id, label, cat: "color", icon: { color, parts: [], swatch: true } });

const LIB: Def[] = [
  // colour dots
  dot("red", "Red", "#d23a3a"), dot("blue", "Blue", "#2f7fd8"), dot("green", "Green", "#3cb84a"), dot("orange", "Orange", "#e0892a"),
  dot("purple", "Purple", "#9a4ad8"), dot("pink", "Pink", "#ee82d0"), dot("yellow", "Yellow", "#e8de5a"), dot("white", "White", "#ececec"),
  dot("black", "Black", "#262626"),

  // status: the general table markers
  D("dead", "Dead", "status", "#c8c0b4", [{ d: "M3 21h18" }, { d: "M6 21V10a6 6 0 0 1 12 0v11" }, { d: "M12 8.5v7M9.3 11h5.4" }]),
  D("dying", "Dying", "status", "#e05050", [{ d: HEART }, { d: "M12.5 7.8l-2 4 3 2-2 4", w: 1.8 }]),
  D("bleeding", "Bleeding", "status", "#e0302a", [{ d: drop(7.5, 3, 2.6), fill: true }, { d: drop(16, 6, 2.6), fill: true }, { d: drop(11, 12, 2.2), fill: true }]),
  D("healing", "Healing", "status", "#ff6f8a", [{ d: HEART }, { d: "M12 10v6M9 13h6", w: 2.2 }]),
  D("temp-hp", "Temporary HP", "status", "#6fa3d8", [{ d: HEART, fill: true }, { d: "M19 3v5M16.5 5.5h5", w: 1.8 }]),
  D("hidden", "Hidden", "status", "#9fb3c8", [{ d: "M3 10.5c3 4.5 15 4.5 18 0" }, { d: "M6 13.6l-1.6 2.2M10 15l-.5 2.6M14 15l.5 2.6M18 13.6l1.6 2.2" }]),
  D("spotted", "Spotted", "status", "#ffd36b", [{ d: "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" }, { d: ring(12, 12, 3), fill: true }]),
  D("flying", "Flying", "status", "#cfe8ff", [{ d: "M3 18c4.5.5 9.5-1 12.5-5 2-2.7 3.6-6.2 5.5-8-.6 5.4-2 9.6-6 12.4-3.3 2.2-8 2.2-12 .6z", fill: true }, { d: "M8 4.5c1 2 1.2 4 .7 6M12 3c1.3 2.3 1.6 4.8.9 7.3", w: 1.6 }]),
  D("mounted", "Mounted", "status", "#c8a070", [{ d: "M7 20C3.5 16 3.5 8 8 4.5h8C20.5 8 20.5 16 17 20" , w: 2.6 }, { d: ring(6.5, 9.5, 0.9) + ring(17.5, 9.5, 0.9) + ring(6, 14.5, 0.9) + ring(18, 14.5, 0.9), fill: true }]),
  D("leader", "Leader", "status", "#ffd36b", [{ d: "M4 17.5l-1-10 5 4 4-6.5 4 6.5 5-4-1 10z", fill: true }, { d: "M4 20.5h16" }]),
  D("ally", "Ally", "status", "#8fd18a", [{ d: ring(8.5, 8, 3) + ring(15.5, 8, 3) }, { d: "M2.5 20a6 6 0 0 1 12 0M9.5 20a6 6 0 0 1 12 0" }]),
  D("enemy", "Enemy", "status", "#e07a70", [{ d: "M4 4l10.5 10.5M20 4L9.5 14.5" , w: 2.4 }, { d: "M12 16.5l-3.5 3.5M12 16.5l3.5 3.5M7 13l4 4M17 13l-4 4" }]),
  D("target", "Target", "status", "#ff6060", [{ d: ring(12, 12, 9) }, { d: ring(12, 12, 5) }, { d: ring(12, 12, 1.6), fill: true }]),
  D("alert", "Alert", "status", "#ffb030", [{ d: "M8.5 3.5v11M15.5 3.5v11", w: 2.8 }, { d: ring(8.5, 19.5, 1.5) + ring(15.5, 19.5, 1.5), fill: true }]),
  D("question", "Unknown", "status", "#a8d8ff", [{ d: "M8 8.3a4 4 0 1 1 5.6 3.7c-1.1.5-1.6 1.4-1.6 2.5V15", w: 2.6 }, { d: ring(12, 19.5, 1.5), fill: true }]),
  D("check", "Done", "status", "#5fd36b", [{ d: "M4 12.5l5 5L20 6.5", w: 2.8 }]),
  D("cross", "No", "status", "#e0302a", [{ d: "M6 6l12 12M18 6L6 18", w: 2.8 }]),
  D("timer", "Timer", "status", "#d8d0c0", [{ d: ring(12, 13.5, 7.5) }, { d: "M12 13.5V9.5M12 13.5l3 2M10 3h4M12 3v2.5M18.5 6l1.5-1.5" }]),
  D("flag", "Flag", "status", "#e8de5a", [{ d: "M6 21V3" }, { d: "M6 4h11l-2.5 4 2.5 4H6z", fill: true }]),
  D("star", "Star", "status", "#ffd36b", [{ d: star(12, 12.5, 9.5, 4), fill: true }]),
  D("web", "Webbed", "status", "#d8d8d8", [{ d: rays(12, 12, 0, 10, 8, Math.PI / 8), w: 1.3 }, { d: star(12, 12, 3.5, 3.5, 4) + star(12, 12, 6.5, 6.5, 4) + star(12, 12, 9.5, 9.5, 4), w: 1.3 }]),
  D("ghost", "Ethereal", "status", "#d8e8ff", [{ d: "M6 20.5V11a6 6 0 0 1 12 0v9.5l-2-1.6-2 1.6-2-1.6-2 1.6-2-1.6z" + ring(9.6, 11, 1.4) + ring(14.4, 11, 1.4), fill: true, evenodd: true }]),
  D("breath", "Holding breath", "status", "#9fd8e8", [{ d: "M12 3v7M12 9.5l-1.5 1.5M12 9.5l1.5 1.5" }, { d: "M10.5 7.5C7.5 7 4 11 4 16c0 2.5 1 4 3 4 3 0 3.5-4 3.5-7zM13.5 7.5c3-.5 6.5 3.5 6.5 8.5 0 2.5-1 4-3 4-3 0-3.5-4-3.5-7z" }]),
  D("cover", "In cover", "status", "#c8b8a0", [{ d: "M3 20.5h18" }, { d: "M4 20.5V13h16v7.5", fill: false }, { d: "M4 16.7h16M9 13v3.7M15 13v3.7M12 16.7v3.8M6.5 16.7v3.8M17.5 16.7v3.8", w: 1.4 }, { d: ring(12, 7.5, 3), fill: true }]),
  D("light", "Carries light", "status", "#ffd36b", [{ d: "M9 20h6M9.5 17.5h5" }, { d: "M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" }]),
  D("num", "Number", "status", "#ececec", []),

  // damage types (the token maker themes its animated borders on the same list)
  D("acid", "Acid", "damage", "#a6e03c", [{ d: "M4 4.5h16V8c0 1-.7 1.6-1.5 1.6S17 10 17 11v3.5a1.5 1.5 0 0 1-3 0V12c0-.8-.6-1.1-1-1.1s-1 .3-1 1.1v5a1.5 1.5 0 0 1-3 0v-6.2c0-.7-.5-1.1-1-1.1S7 10 7 10.8v1.7a1.5 1.5 0 0 1-3 0z", fill: true }, { d: ring(15.5, 19.5, 1.3) + ring(7.5, 17, 1), fill: true }]),
  D("bludgeoning", "Bludgeoning", "damage", "#c9b8a0", [{ d: "M3.5 20.5l8-8", w: 2.8 }, { d: ring(15, 9, 4.2), fill: true }, { d: "M15 2.5v2.3M21.5 9h-2.3M19.6 4.4l-1.6 1.6M19.6 13.6L18 12M10.4 4.4L12 6" }]),
  D("cold", "Cold", "damage", "#8fe0ff", [{ d: "M12 2v20M3.34 7l17.32 10M3.34 17L20.66 7" }, { d: snowTicks(), w: 1.6 }]),
  D("fire", "Fire", "damage", "#ff7a2e", [{ d: FLAME, fill: true }, { d: "M12 21a3 3 0 0 1-3-3c0-1.6 1.2-2.6 1.8-3.6.2 1.2.9 1.8 1.4 1.8.2-1.6.4-2.6 1.6-3.7.2 2 2.2 3 2.2 5.5a3 3 0 0 1-4 3z", fill: true, evenodd: true }]),
  D("force", "Force", "damage", "#c8a0ff", [{ d: star(12, 12, 10, 4.2, 8) }, { d: ring(12, 12, 1.8), fill: true }]),
  D("lightning", "Lightning", "damage", "#6fc8ff", [{ d: "M13.5 2L4.5 13.5h6.5L10 22l9-11.5h-6.5z", fill: true }]),
  D("necrotic", "Necrotic", "damage", "#9acd8a", [{ d: "M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.2 4.3 2.8 5.3V19h9.4v-3.2c1.6-1 2.8-2.7 2.8-5.3A7.5 7.5 0 0 0 12 3z" + ring(9, 10.8, 2) + ring(15, 10.8, 2) + "M12 13.3l1.2 2.2h-2.4z", fill: true, evenodd: true }, { d: "M9.5 19v2.5M12 19v2.5M14.5 19v2.5", w: 1.6 }]),
  D("piercing", "Piercing", "damage", "#e0d8c8", [{ d: "M4 20L16.5 7.5", w: 2.2 }, { d: "M21 3l-2.2 7.2-5-5z", fill: true }, { d: "M3.5 16.5h3.5V20M6.5 13.5H10v3.5", w: 1.6 }]),
  D("poison", "Poison", "damage", "#4fd24a", [{ d: "M9.5 3h5M10.5 3v4.5a6.5 6.5 0 1 0 3 0V3" }, { d: "M6.6 14a5.4 5.4 0 0 0 10.8 0z", fill: true }, { d: ring(13, 10.5, 1) + ring(10.5, 12, 0.7), fill: true }]),
  D("psychic", "Psychic", "damage", "#ff70d0", [{ d: "M12 5.5c-1.8-2.2-6-1.4-6 1.8-2.2 0-3.2 3-1.2 4.4-1.6 1.6 0 4.4 2.2 4.2.2 2.2 3.4 3 5 1.4 1.6 1.6 4.8.8 5-1.4 2.2.2 3.8-2.6 2.2-4.2 2-1.4 1-4.4-1.2-4.4 0-3.2-4.2-4-6-1.8zM12 5.5v12" }, { d: "M4 21c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0", w: 1.4 }]),
  D("radiant", "Radiant", "damage", "#ffe27a", [{ d: ring(12, 12, 4.2), fill: true }, { d: rays(12, 12, 6.5, 10, 8), w: 2.2 }]),
  D("slashing", "Slashing", "damage", "#e8e0d0", [{ d: "M5 19C8 14 11 9 15.5 4M9 20.5c3-5 6-10 10.5-14.5M13.5 21.5c2-3.2 4-6 7-8.5", w: 2.4 }]),
  D("thunder", "Thunder", "damage", "#a8b8ff", [{ d: ring(12, 12, 2.2), fill: true }, { d: "M7.8 8.2a5.5 5.5 0 0 0 0 7.6M16.2 8.2a5.5 5.5 0 0 1 0 7.6M5 5.5a9.5 9.5 0 0 0 0 13M19 5.5a9.5 9.5 0 0 1 0 13" }]),

  // weapons and gear
  D("sword", "Sword", "gear", "#d8dde6", [{ d: "M20.5 3.5v3.8L10 17.8l-3.8-3.8L16.7 3.5z" }, { d: "M4.5 12.5l7 7M7.5 16.5l-4 4", w: 2.4 }]),
  D("axe", "Axe", "gear", "#d8c0a0", [{ d: "M5 21L16 7", w: 2.4 }, { d: "M13.5 3c3.4-.2 7.4 3 7.6 7.2l-3.4 1.3-5.6-5.4z", fill: true }]),
  D("bow", "Bow", "gear", "#c8a070", [{ d: "M5 3.5c9.5 0 15.5 6 15.5 15.5", w: 2.2 }, { d: "M5 3.5l15.5 15.5", w: 1 }, { d: "M3 21L15 9", w: 1.6 }, { d: "M17.5 6.5l-1.2 4.4-3.2-3.2z", fill: true }]),
  D("dagger", "Dagger", "gear", "#d8dde6", [{ d: "M19.5 4.5l-.6 3.7-6.5 6.5-3.1-3.1 6.5-6.5z" }, { d: "M7 10l7 7M9 15l-4.5 4.5", w: 2.2 }]),
  D("wand", "Wand", "gear", "#e6b0ff", [{ d: "M4 20L14 10", w: 2.6 }, { d: star(17.5, 6.5, 4, 1.7), fill: true }]),
  D("staff", "Staff", "gear", "#c8a070", [{ d: "M6 22.5l8.5-14.5", w: 2.4 }, { d: ring(16.5, 5, 3.2) }, { d: ring(16.5, 5, 1.2), fill: true }]),
  D("shield", "Shield", "gear", "#a8b8c8", [{ d: SHIELD }, { d: "M12 3v18M4.5 10.5h15", w: 1.4 }]),
  D("potion", "Potion", "gear", "#ff6f8a", [{ d: "M9.5 3h5M10.5 3v4.2a6.5 6.5 0 1 0 3 0V3" }, { d: "M6.6 15a5.4 5.4 0 0 0 10.8 0z", fill: true }]),
  D("torch", "Torch", "gear", "#ffa040", [{ d: "M10 22.5l-1.2-9.5h6.4L14 22.5z", fill: true }, { d: "M12 2.5c.6 2.4 3.5 3.5 3.5 6.8a3.5 3.5 0 0 1-7 0c0-1.7 1.2-2.9 1.8-3.4 0 1.1.6 1.7 1.2 1.7 0-2.3-.6-3.5.5-5.1z", fill: true }]),
  D("key", "Key", "gear", "#ffd36b", [{ d: ring(7, 12, 4) }, { d: "M11 12h10.5M18.5 12v3.2M21.5 12v2.4" }]),
  D("coins", "Treasure", "gear", "#ffd36b", [{ d: "M5 9a7 2.6 0 1 0 14 0a7 2.6 0 1 0-14 0zM5 9v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V9M5 13v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4" }]),
  D("scroll", "Scroll", "gear", "#e8d8b0", [{ d: "M7 4h11a2 2 0 0 1 0 4h-1M7 4a2 2 0 0 0-2 2v11.5a2.5 2.5 0 0 0 2.5 2.5H16a2 2 0 0 0 2-2V8" }, { d: "M8.5 10h6M8.5 13h6M8.5 16h4", w: 1.4 }]),
  D("book", "Book", "gear", "#c88060", [{ d: "M4 5.5C6.5 4 9.5 4 12 5.5 14.5 4 17.5 4 20 5.5v13c-2.5-1.5-5.5-1.5-8 0-2.5-1.5-5.5-1.5-8 0zM12 5.5v13" }]),
  D("ring", "Ring", "gear", "#ffd36b", [{ d: ring(12, 14, 6.5), w: 2.4 }, { d: "M9.5 5.5l2.5-3 2.5 3-2.5 2.5z", fill: true }]),
  D("pack", "Backpack", "gear", "#b88a5a", [{ d: "M6 9a6 6 0 0 1 12 0v11.5H6zM9 9V7a3 3 0 0 1 6 0v2M8.5 13h7v4h-7z" }]),
  D("trap", "Trap", "gear", "#c8c0b4", [{ d: "M3 15h18" }, { d: "M5 15V12l2 2 2-3 2 3 2-3 2 3 2-3 2 2v3", w: 1.6 }, { d: ring(12, 18.5, 2) }]),
];

// The fight markers keep their names as ids, so a combatant's conditions draw straight from this map.
const FIGHT: Record<string, Icon> = {
  // conditions
  Blinded: { color: "#9fb3c8", parts: [{ d: "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" }, { d: ring(12, 12, 2.6) }, { d: "M4 20L20 4", w: 2.4 }] },
  Charmed: { color: "#f08cb4", parts: [{ d: HEART, fill: true }] },
  Deafened: { color: "#c9a27a", parts: [{ d: "M7.5 9.5a4.5 4.5 0 1 1 9 0c0 3.2-3.2 4-3.2 7.2a2.6 2.6 0 0 1-5 .8" }, { d: "M10.5 10a1.6 1.6 0 1 1 3 .6" }, { d: "M4 20L20 4", w: 2.4 }] },
  Exhaustion: { color: "#c8a35c", parts: [{ d: "M6.5 3h11M6.5 21h11" }, { d: "M8 3v2.5c0 3 4 4.5 4 6.5s-4 3.5-4 6.5V21M16 3v2.5c0 3-4 4.5-4 6.5s4 3.5 4 6.5V21" }, { d: "M9.5 19.5c0-1.5 2.5-2.5 2.5-3.5 0 1 2.5 2 2.5 3.5z", fill: true }] },
  Frightened: { color: "#d8d070", parts: [{ d: ring(12, 12, 9) }, { d: ring(8.8, 9.6, 1.3), fill: true }, { d: ring(15.2, 9.6, 1.3), fill: true }, { d: "M10 16.3a2 2.6 0 1 0 4 0a2 2.6 0 1 0-4 0z" }] },
  Grappled: { color: "#c49a6c", parts: [{ d: "M10 14l-3 3a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0" }, { d: "M14 10l3-3a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0" }, { d: "M9 15l6-6" }] },
  Incapacitated: { color: "#b49ae8", parts: [{ d: "M12 12a1 1 0 0 1 1 1a2 2 0 0 1-2 2a3 3 0 0 1-3-3a4 4 0 0 1 4-4a5 5 0 0 1 5 5a6 6 0 0 1-6 6a7 7 0 0 1-7-7" }] },
  Invisible: { color: "#a8d8ff", parts: [{ d: ring(12, 7.5, 3.5), dash: true }, { d: "M4.5 20.5a7.5 7.5 0 0 1 15 0", dash: true }] },
  Paralyzed: { color: "#ffd84a", parts: [{ d: ring(12, 5, 2.4) }, { d: "M12 7.5v8M8 10.5h8M12 15.5l-2.5 5.5M12 15.5l2.5 5.5" }, { d: "M4 6l2 1.5-2 1.5M20 6l-2 1.5 2 1.5M4 15l2 1.5-2 1.5M20 15l-2 1.5 2 1.5", w: 1.4 }] },
  Petrified: { color: "#a9a49a", parts: [{ d: "M3.5 17.5l2.8-8 5.2-4.5 6 2.5 3 8.5-6.5 4z", fill: true }, { d: "M11.5 5l1 5-3 3 1.5 4", w: 1.4 }] },
  Poisoned: { color: "#7fd25a", parts: [{ d: "M12 3s6 6.8 6 11a6 6 0 0 1-12 0c0-4.2 6-11 6-11z", fill: true }, { d: ring(9.8, 14.2, 1.2), fill: true }, { d: ring(13.6, 16.6, 0.9), fill: true }] },
  Prone: { color: "#d9b38c", parts: [{ d: "M2.5 19.5h19" }, { d: ring(5.5, 14, 2.2), fill: true }, { d: "M8.5 15.5h8l3.5 4M13 15.5l-2-3.5" }] },
  Restrained: { color: "#c8a070", parts: [{ d: "M4 4h16v16H4z" }, { d: "M4 12h16M12 4v16M4 4l16 16M20 4L4 20", w: 1.4 }] },
  Stunned: { color: "#ffe066", parts: [{ d: star(12, 9.5, 6, 2.6), fill: true }, { d: "M3 17.5c3.5 3.5 14.5 3.5 18 0" }, { d: ring(4.5, 12.5, 1.1), fill: true }, { d: ring(19.5, 12.5, 1.1), fill: true }] },
  Unconscious: { color: "#9fb6e8", parts: [{ d: "M4 5h7l-7 8h7" }, { d: "M13 12h6l-6 7h6" }] },
  Concentrating: { color: "#7fd0e0", parts: [{ d: ring(12, 12, 9) }, { d: ring(12, 12, 5) }, { d: ring(12, 12, 1.6), fill: true }] },
  // buffs
  Blessed: { color: "#ffe9a0", parts: [{ d: "M12 2.5c.9 4.9 3.3 7.3 8.5 8.5-5.2 1.2-7.6 3.6-8.5 8.5-.9-4.9-3.3-7.3-8.5-8.5 5.2-1.2 7.6-3.6 8.5-8.5z", fill: true }, { d: ring(19, 19, 1.3), fill: true }] },
  Hasted: { color: "#7fe0c0", parts: [{ d: "M4 6l6 6-6 6" }, { d: "M12 6l6 6-6 6" }] },
  Inspired: { color: "#e6b0ff", parts: [{ d: "M9 18V5.5L19 3.5v12" }, { d: ring(6.5, 18, 2.5), fill: true }, { d: ring(16.5, 15.5, 2.5), fill: true }] },
  Raging: { color: "#ff5a3c", parts: [{ d: "M3 7l7 3.5M21 7l-7 3.5", w: 2.6 }, { d: "M5.5 11.5c1 2.5 4 2.5 4.5 0zM18.5 11.5c-1 2.5-4 2.5-4.5 0z", fill: true }, { d: "M8 19c2-2.5 6-2.5 8 0" }] },
  Dodging: { color: "#9fe08a", parts: [{ d: "M3.5 18c4 0 4-11 8.5-11s4.5 11 8.5 11" }, { d: "M17.5 15l3 3-3.4 1.6" }] },
  Shielded: { color: "#7fb4ff", parts: [{ d: SHIELD }, { d: "M12 6.3l4.6 1.7v3.8c0 3-2 5-4.6 5.9-2.6-.9-4.6-2.9-4.6-5.9V8z", fill: true }] },
  // debuffs
  Baned: { color: "#ff8a80", parts: [{ d: "M6 5l6 6 6-6" }, { d: "M6 12l6 6 6-6" }] },
  Slowed: { color: "#b0c8a0", parts: [{ d: "M14.5 16.5a5 5 0 1 0-5-5a3 3 0 0 0 3 3a1.5 1.5 0 0 0 0-3" }, { d: "M3 18.5h15.5l2.5-3.5" }] },
  Hexed: { color: "#c080ff", parts: [{ d: "M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z" }, { d: ring(12, 12, 2.4), fill: true }] },
  Marked: { color: "#ff6060", parts: [{ d: ring(12, 12, 6.5) }, { d: "M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" }] },
  Outlined: { color: "#ff9be0", parts: [{ d: ring(12, 8.5, 3.2) }, { d: "M6 20a6 6 0 0 1 12 0" }, { d: "M3 4.5l1.6 1.6M21 4.5l-1.6 1.6M2.5 13h2M19.5 13h2", w: 1.6 }] },
  Vulnerable: { color: "#ff9a6a", parts: [{ d: SHIELD }, { d: "M12.5 5.5l-2.5 5.5 3.5 2-2.5 5.5", w: 2.2 }] },
};

const BY_ID = new Map<string, Def>(LIB.map((d) => [d.id, d]));
const FALLBACK: Icon = { color: "#d8c8a8", parts: [{ d: ring(12, 12, 7) }, { d: "M12 8v5M12 15.5v.5", w: 2.4 }] };

/** Every marker a GM or player can put on a token, in picker order. */
export const TOKEN_MARKERS: { id: string; label: string; cat: MarkerCat }[] = [
  ...LIB.filter((d) => d.cat === "color" || d.cat === "status"),
  ...Object.keys(FIGHT).map((id) => ({ id, label: id, cat: markerKind(id) as MarkerCat })),
  ...LIB.filter((d) => d.cat === "damage" || d.cat === "gear"),
].map((d) => ({ id: d.id, label: d.label, cat: d.cat }));

/** The damage types with their colours, for the token maker's themed borders. */
export const DAMAGE_TYPES: { id: string; label: string; color: string }[] = LIB.filter((d) => d.cat === "damage").map((d) => ({ id: d.id, label: d.label, color: d.icon.color }));

export const iconFor = (id: string): Icon => FIGHT[id] ?? BY_ID.get(id)?.icon ?? FALLBACK;
export const markerLabel = (id: string): string => (FIGHT[id] ? id : BY_ID.get(id)?.label ?? id);
export const isMarkerId = (id: string): boolean => id in FIGHT || BY_ID.has(id);

// ---- token markers in style.markers ----

export const MAX_TOKEN_MARKERS = 16;
export type TokenMarker = { id: string; n: number | null };

export function parseMarker(s: string): TokenMarker {
  const [id, raw] = s.split("|");
  const n = raw === undefined || raw === "" ? null : Math.max(-99, Math.min(99, Math.trunc(Number(raw)) || 0));
  return { id, n };
}
export const formatMarker = (m: TokenMarker): string => (m.n == null ? m.id : `${m.id}|${m.n}`);

/** The token's own markers, cleaned: known ids only, no repeats, at most MAX_TOKEN_MARKERS. */
export function tokenMarkers(style: Record<string, unknown> | null | undefined): TokenMarker[] {
  const raw = style?.markers;
  if (!Array.isArray(raw)) return [];
  const out: TokenMarker[] = [], seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const m = parseMarker(v);
    if (!isMarkerId(m.id) || seen.has(m.id)) continue;
    seen.add(m.id); out.push(m);
    if (out.length >= MAX_TOKEN_MARKERS) break;
  }
  return out;
}

/** The text for a marker in a label or tooltip: "Bleeding 3". */
export const markerText = (m: TokenMarker): string => (m.id === "num" ? String(m.n ?? 0) : m.n == null ? markerLabel(m.id) : `${markerLabel(m.id)} ${m.n}`);

/** Colours for one badge in the chosen look. */
export function badgeColors(id: string, style: MarkerStyle): { bg: string; ring: string; glyph: string } {
  const icon = iconFor(id);
  if (icon.swatch) return { bg: icon.color, ring: style === "plain" ? "#f2f2f2" : "rgba(0,0,0,0.55)", glyph: icon.color };
  if (style === "plain") return { bg: "#111", ring: "#f2f2f2", glyph: "#f2f2f2" };
  const ringCol = id in FIGHT ? MARKER_COLORS[markerKind(id)].line : "#8a7a64";
  return { bg: "#15110e", ring: ringCol, glyph: icon.color };
}

// ---- canvas ----

const pathCache = new Map<string, Path2D>();
function path(d: string): Path2D {
  let p = pathCache.get(d);
  if (!p) { p = new Path2D(d); pathCache.set(d, p); }
  return p;
}

/** Draws the glyph alone, centred at (x, y), `size` pixels across. */
export function drawMarkerGlyph(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, size: number, color: string) {
  const icon = iconFor(id), k = size / 24;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2); ctx.scale(k, k);
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const part of icon.parts) {
    const p = path(part.d);
    if (part.fill) ctx.fill(p, part.evenodd ? "evenodd" : "nonzero");
    else {
      ctx.lineWidth = part.w ?? 2;
      ctx.setLineDash(part.dash ? [2.2, 2.4] : []);
      ctx.stroke(p);
    }
  }
  ctx.restore();
}

function numberTag(ctx: CanvasRenderingContext2D, n: number, x: number, y: number, r: number, style: MarkerStyle) {
  const t = String(n), rr = r * (t.length > 2 ? 0.72 : 0.62);
  ctx.save();
  ctx.fillStyle = style === "plain" ? "#f2f2f2" : "#fff3d6"; ctx.strokeStyle = "#111"; ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = n < 0 ? "#b01818" : "#111"; ctx.font = `800 ${rr * (t.length > 1 ? 1.05 : 1.35)}px system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, x, y + rr * 0.06);
  ctx.restore();
}

/** Draws a round badge of radius `r` with the marker's icon inside, and its number if it has one. */
export function drawMarkerBadge(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, r: number, style: MarkerStyle, n: number | null = null) {
  const c = badgeColors(id, style);
  ctx.save();
  ctx.fillStyle = c.bg; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = c.ring; ctx.lineWidth = Math.max(1, r * 0.14); ctx.stroke();
  ctx.restore();
  if (id === "num") {
    const t = String(n ?? 0);
    ctx.save(); ctx.fillStyle = n != null && n < 0 ? "#ff8a80" : style === "plain" ? "#f2f2f2" : "#fff3d6";
    ctx.font = `800 ${r * (t.length > 2 ? 0.8 : t.length > 1 ? 1.05 : 1.3)}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(t, x, y + r * 0.06); ctx.restore();
    return;
  }
  if (!iconFor(id).swatch) drawMarkerGlyph(ctx, id, x, y, r * 1.35, c.glyph);
  if (n != null) numberTag(ctx, n, x + r * 0.72, y + r * 0.72, r, style);
}

/**
 * Lays out badges along the lower rim of a token centred at (cx, cy) with radius `rad`, centred under
 * the token, with an overflow count when they do not all fit.
 */
export function drawMarkerRing(ctx: CanvasRenderingContext2D, list: TokenMarker[], cx: number, cy: number, rad: number, r: number, style: MarkerStyle, max = 8) {
  if (!list.length) return;
  const step = Math.min(0.9, (2.15 * r) / Math.max(rad, 1));
  const fit = Math.max(1, Math.min(max, Math.floor((Math.PI * 1.1) / step) + 1));
  const over = list.length > fit;
  const shown = over ? list.slice(0, fit - 1) : list;
  const n = shown.length + (over ? 1 : 0);
  const a0 = Math.PI / 2 + ((n - 1) * step) / 2;
  shown.forEach((m, i) => {
    const a = a0 - i * step;
    drawMarkerBadge(ctx, m.id, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, r, style, m.n);
  });
  if (over) {
    const a = a0 - shown.length * step, x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    ctx.save();
    ctx.fillStyle = "#15110e"; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = style === "plain" ? "#f2f2f2" : "#c2a8f0"; ctx.lineWidth = Math.max(1, r * 0.14); ctx.stroke();
    ctx.fillStyle = "#f2f2f2"; ctx.font = `700 ${r * 0.95}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`+${list.length - shown.length}`, x, y + r * 0.04);
    ctx.restore();
  }
}

// ---- per-viewer look ----

export function readMarkerStyle(): MarkerStyle {
  try { return window.localStorage.getItem(MARKER_STYLE_KEY) === "plain" ? "plain" : "color"; } catch { return "color"; }
}
export function saveMarkerStyle(s: MarkerStyle) {
  try { window.localStorage.setItem(MARKER_STYLE_KEY, s); } catch { /* storage unavailable: the choice lasts for this visit */ }
}
