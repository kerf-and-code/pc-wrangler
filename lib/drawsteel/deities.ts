// Draw Steel deities, saints, and domains (MCDM Draw Steel Rules Reference, via the Steel Compendium
// data set, used under the Draw Steel Creator License). MECHANICS ONLY: the twelve domain names, and
// each deity's / saint's domain PORTFOLIO (the Deities and Domains + Saints and Domains tables). A
// domain's own mechanics (its piety trigger, prayer effect, and per-level domain features) are effect
// content and live in the SRD, not here - the Forge shows the domain by name and a generic note. No
// MCDM prose (deity/saint lore) is stored. See lib/systems/drawsteel.ts for attribution.
//
// How it is used: a Conduit picks a deity and TWO domains from that deity's portfolio (its subclass);
// a Censor picks a deity and ONE domain. The domain choices are constrained to the chosen deity's
// portfolio. A player may also invent their own saint by choosing domains from a god's list (SRD
// sidebar); that freeform path is not modeled here - pick the closest listed deity/saint.

export interface DSDomain {
  id: string;
  name: string;
}

// The twelve domains (Conduit/Censor domain options; also the Conduit subclass in play terms).
export const DS_DOMAINS: DSDomain[] = [
  { id: "creation", name: "Creation" },
  { id: "death", name: "Death" },
  { id: "fate", name: "Fate" },
  { id: "knowledge", name: "Knowledge" },
  { id: "life", name: "Life" },
  { id: "love", name: "Love" },
  { id: "nature", name: "Nature" },
  { id: "protection", name: "Protection" },
  { id: "storm", name: "Storm" },
  { id: "sun", name: "Sun" },
  { id: "trickery", name: "Trickery" },
  { id: "war", name: "War" },
];

const DOMAIN_NAME: Record<string, string> = Object.fromEntries(DS_DOMAINS.map((d) => [d.id, d.name]));
export const domainName = (id: string): string => DOMAIN_NAME[id] ?? id;

export interface DSDeity {
  id: string;
  name: string;
  kind: "deity" | "saint";
  domains: string[];        // domain ids in this deity's/saint's portfolio
}

const d = (id: string, name: string, kind: "deity" | "saint", domains: string[]): DSDeity =>
  ({ id, name, kind, domains });

// ---- deities (Deities and Domains Table) -------------------------------------------------------
const DEITIES: DSDeity[] = [
  d("adun", "Adûn", "deity", ["creation", "life", "love", "protection"]),
  d("cavall", "Cavall", "deity", ["life", "love", "protection", "war"]),
  d("cyrvis", "Cyrvis", "deity", ["death", "fate", "knowledge", "trickery"]),
  d("kul", "Kul", "deity", ["knowledge", "life", "sun", "trickery", "war"]),
  d("nebular", "Nebular the Star Mother", "deity", ["creation", "life", "love", "sun"]),
  d("nikros", "Nikros", "deity", ["death", "fate", "storm", "war"]),
  d("ord", "Ord", "deity", ["creation", "knowledge", "protection", "sun", "war"]),
  d("ov", "OV the Wave Pilot", "deity", ["fate", "knowledge", "storm", "sun"]),
  d("salorna", "Salorna", "deity", ["life", "nature", "storm", "sun"]),
  d("val", "Val", "deity", ["creation", "knowledge", "life", "nature", "protection"]),
];

// ---- saints and legendary heroes (Saints and Domains Table) ------------------------------------
const SAINTS: DSDeity[] = [
  d("atossa-the-shepherd", "Atossa the Shepherd", "saint", ["fate", "protection", "trickery"]),
  d("chokassa-the-time-rider", "Cho'kassa the Time Rider", "saint", ["storm", "sun"]),
  d("draighen-the-warden", "Draighen the Warden", "saint", ["nature", "sun"]),
  d("eriarwen-the-wroth", "Eriarwen the Wroth", "saint", ["nature", "storm"]),
  d("eseld-the-eye", "Eseld the Eye", "saint", ["knowledge", "trickery"]),
  d("gaed-the-confessor", "Gaed the Confessor", "saint", ["love", "protection"]),
  d("grole-the-one-handed", "Grole the One-Handed", "saint", ["life", "war"]),
  d("gryffyn-the-stout", "Gryffyn the Stout", "saint", ["creation", "life"]),
  d("gwenllian-the-fell-handed", "Gwenllian the Fell-Handed", "saint", ["protection", "war"]),
  d("illwyv-li-orchiax", "Illwyv li Orchiax", "saint", ["nature", "protection"]),
  d("khorvath-who-slew-a-thousand", "Khorvath Who Slew a Thousand", "saint", ["sun", "war"]),
  d("khravila-who-ran-forty-leagues", "Khravila Who Ran Forty Leagues", "saint", ["knowledge", "trickery"]),
  d("kyruyalka-the-false-principle", "Kyruyalka the False Principle", "saint", ["death", "trickery"]),
  d("lady-magnetar", "Lady Magnetar", "saint", ["life", "sun"]),
  d("llewellyn-the-valiant", "Llewellyn the Valiant", "saint", ["life", "protection"]),
  d("mahsiti-the-weaver", "Mahsiti the Weaver", "saint", ["creation", "knowledge", "trickery"]),
  d("pentalion-the-paladin", "Pentalion the Paladin", "saint", ["death", "war"]),
  d("prexaspes-the-stargazer", "Prexaspes the Stargazer", "saint", ["nature", "protection", "sun"]),
  d("ripples-of-honey", "Ripples of Honey on a Shore of Gold", "saint", ["life", "protection"]),
  d("a-sea-of-suns", "A Sea of Suns", "saint", ["creation", "life"]),
  d("stakros-the-engineer", "Stakros the Engineer", "saint", ["creation", "knowledge"]),
  d("the-taste-of-morning", "The Taste of Morning", "saint", ["creation", "knowledge"]),
  d("thellasko-the-great-designer", "Thellasko the Great Designer", "saint", ["knowledge", "war"]),
  d("thyll-hylacae", "Thyll Hylacae", "saint", ["life", "nature"]),
  d("uryal-the-subtle", "Uryal the Subtle", "saint", ["knowledge", "trickery"]),
  d("valak-koth-the-seeker", "Valak-koth the Seeker", "saint", ["knowledge", "sun"]),
  d("yllin-dyrvis", "Yllin Dyrvis", "saint", ["knowledge", "nature"]),
  d("zarok-the-law-giver", "Zarok the Law-Giver", "saint", ["protection", "war"]),
];

export const DS_DEITIES: DSDeity[] = [...DEITIES, ...SAINTS];

export const deityById = (id: string): DSDeity | undefined => DS_DEITIES.find((x) => x.id === id);

// The domain options for a chosen deity, as {id,name}, in the canonical domain order. Empty when no
// deity is chosen (the UI asks for a deity first).
export function domainsForDeity(deityId: string): DSDomain[] {
  const dd = deityById(deityId);
  if (!dd) return [];
  const set = new Set(dd.domains);
  return DS_DOMAINS.filter((x) => set.has(x.id));
}
