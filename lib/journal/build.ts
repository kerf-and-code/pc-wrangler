// Campaign journal builder. Sibling of lib/recap/build.ts: gathers the campaign's
// captured material (session recaps, arcs, loot, dice highlights, NPC cast) and
// makes ONE model call to weave the recaps into a continuous chronicle. Returns
// structured content; persisting is the caller's job.

const JOURNAL_MODEL = "claude-sonnet-4-6";
const CONTEXT_LIMIT = 40000; // cap on recap+arc context fed to the model

const D20_TYPES = new Set(["to-hit", "saving-throw", "skill", "ability", "initiative", "death-save"]);

type DbLike = { from: (table: string) => any };
type Dice = { character: string; nat20: number; nat1: number };
type LootRow = { character: string; items: string[] };
type JournalContent = {
  campaign: string;
  chronicle: string;
  arcs: { title: string; status: string }[];
  loot: LootRow[];
  dice: Dice[];
  cast: { name: string; description: string | null }[];
  sessions: number;
  generated_at: string;
};
type Result = { ok: true; content: JournalContent } | { ok: false; error: string; status: number };

function natD20(rolls: any): number | null {
  const d = (rolls?.dice ?? []).find((g: any) => g.faces === 20);
  const v = d?.results?.[0];
  return typeof v === "number" ? v : null;
}

async function callClaude(apiKey: string, system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: JOURNAL_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error("model error");
  const data = await res.json();
  return (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
}

export async function buildJournal(supabase: DbLike, campaignId: string): Promise<Result> {
  const { data: campaign } = await supabase.from("campaigns").select("name, system").eq("id", campaignId).single();

  const [{ data: sessions }, { data: chars }, { data: arcs }, { data: loot }, { data: vtt }] = await Promise.all([
    supabase.from("sessions").select("session_number, recap").eq("campaign_id", campaignId).not("recap", "is", null).order("session_number", { ascending: true }),
    supabase.from("characters").select("id, name, kind, description").eq("campaign_id", campaignId),
    supabase.from("arcs").select("title, status").eq("campaign_id", campaignId),
    supabase.from("loot_grants").select("item_name, rarity, character_id").eq("campaign_id", campaignId),
    supabase.from("vtt_events").select("character_id, actor_name, event_type, rolls").eq("campaign_id", campaignId),
  ]);

  const recaps = (sessions || []).filter((s: any) => s.recap && s.recap.trim());
  if (!recaps.length) {
    return { ok: false, error: "No session recaps yet. Write a recap or two first, and the journal will weave them into a chronicle.", status: 422 };
  }

  const nameOf = (id: string | null) => (id && (chars || []).find((c: any) => c.id === id)?.name) || "the party";

  // Loot ledger, by character.
  const lootMap = new Map<string, string[]>();
  (loot || []).forEach((l: any) => {
    const who = nameOf(l.character_id);
    const item = `${l.item_name}${l.rarity ? ` (${l.rarity})` : ""}`;
    if (!lootMap.has(who)) lootMap.set(who, []);
    lootMap.get(who)!.push(item);
  });
  const lootRows: LootRow[] = Array.from(lootMap.entries()).map(([character, items]) => ({ character, items }));

  // Dice highlight reel: nat 20s and nat 1s by roller.
  const diceMap = new Map<string, { nat20: number; nat1: number }>();
  (vtt || []).forEach((e: any) => {
    if (!D20_TYPES.has(e.event_type)) return;
    const nat = natD20(e.rolls);
    const who = e.character_id ? nameOf(e.character_id) : (e.actor_name || "Someone");
    if (!diceMap.has(who)) diceMap.set(who, { nat20: 0, nat1: 0 });
    const d = diceMap.get(who)!;
    if (nat === 20 || e.rolls?.critical_success === true) d.nat20 += 1;
    if (nat === 1 || e.rolls?.critical_failure === true) d.nat1 += 1;
  });
  const dice: Dice[] = Array.from(diceMap.entries())
    .map(([character, v]) => ({ character, nat20: v.nat20, nat1: v.nat1 }))
    .filter((d) => d.nat20 || d.nat1)
    .sort((a, b) => (b.nat20 + b.nat1) - (a.nat20 + a.nat1));

  const cast = (chars || []).filter((c: any) => c.kind === "npc").map((c: any) => ({ name: c.name, description: c.description || null }));
  const arcRows = (arcs || []).map((a: any) => ({ title: a.title, status: a.status }));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "Journal service is not configured.", status: 500 };

  const recapText = recaps.map((s: any) => `Session ${s.session_number ?? "?"}:\n${s.recap.trim()}`).join("\n\n");
  const arcText = arcRows.length ? `\n\nStory arcs so far: ${arcRows.map((a: { title: string; status: string }) => `${a.title} (${a.status})`).join(", ")}` : "";
  const context = `Campaign: ${campaign?.name || "Untitled"}${campaign?.system ? ` (${campaign.system})` : ""}\n\nSession recaps in order:\n\n${recapText}${arcText}`.slice(0, CONTEXT_LIMIT);

  const system = `You write a campaign chronicle for a tabletop RPG group, addressed to the players as one continuous tale.
- Weave the session recaps below into a single flowing narrative, in order. Add brief connective tissue between sessions so it reads as one story, not a list of recaps.
- Open with a short evocative preamble naming the campaign and its heroes.
- Ground everything in the provided recaps and arcs. Do NOT invent characters, outcomes, or plot beats not present in the input.
- Refer to player characters by name. Engaging, neutral fantasy-narrative voice.
- Flowing prose. You may use short act-style section breaks (a bold line) between major movements if it helps, but keep it narrative, no bullet lists.`;

  let chronicle = "";
  try {
    chronicle = await callClaude(apiKey, system, context, 3000);
  } catch {
    return { ok: false, error: "The journal model returned an error. Try again.", status: 502 };
  }
  if (!chronicle) return { ok: false, error: "The journal came back empty. Try again.", status: 502 };

  return {
    ok: true,
    content: {
      campaign: campaign?.name || "Untitled",
      chronicle,
      arcs: arcRows,
      loot: lootRows,
      dice,
      cast,
      sessions: recaps.length,
      generated_at: new Date().toISOString(),
    },
  };
}
