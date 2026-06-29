import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// Match this to whatever model string your extraction route already uses.
const RECAP_MODEL = "claude-sonnet-4-6";

const AXIS_NAME: Record<string, string> = {
  N: "Character", T: "Encounter", O: "System", S: "Table", E: "World", I: "Presence",
};

const SYSTEM = `You write short "previously on..." recaps for a tabletop RPG group, addressed to the players.
Rules:
- Ground every statement in the provided notes and logged events. Do NOT invent characters, outcomes, locations, or plot beats that are not supported by the input.
- If the input is sparse, write a short recap rather than padding it with invention.
- Engaging, neutral fantasy-narrative voice. Refer to player characters by name.
- 2 to 4 short paragraphs of flowing prose. No headers, no bullet points, no lists.
- Do not address the GM or mention "events," "logs," or the tool. Just tell the story of what happened.`;

export async function POST(request: Request) {
  try {
    const { sessionId } = await request.json().catch(() => ({}));
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    }

    // RLS ensures the user can only read their own session here.
    const { data: session, error: sErr } = await supabase
      .from("sessions")
      .select("id, campaign_id, session_number, notes")
      .eq("id", sessionId)
      .single();
    if (sErr || !session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const campaignId = session.campaign_id;
    const [
      { data: campaign },
      { data: characters },
      { data: eventTypes },
      { data: events },
      { data: loot },
      { data: touches },
    ] = await Promise.all([
      supabase.from("campaigns").select("name, system").eq("id", campaignId).single(),
      supabase.from("characters").select("id, name, kind").eq("campaign_id", campaignId),
      supabase.from("event_types").select("key, label"),
      supabase.from("events")
        .select("event_type, axis, payload, character_id, created_at")
        .eq("session_id", sessionId).order("created_at", { ascending: true }),
      supabase.from("loot_grants")
        .select("item_name, rarity, character_id")
        .eq("session_id", sessionId),
      supabase.from("arc_touches")
        .select("arc_id, arcs(title)")
        .eq("session_id", sessionId),
    ]);

    const nameOf = (id: string | null) =>
      (id && characters?.find((c: any) => c.id === id)?.name) || "the party";
    const typeLabel = (k: string) =>
      eventTypes?.find((t: any) => t.key === k)?.label || k;

    // Build the grounded context.
    const parts: string[] = [];
    parts.push(`Campaign: ${campaign?.name || "Untitled"}${campaign?.system ? ` (${campaign.system})` : ""}`);
    if (session.session_number != null) parts.push(`Session number: ${session.session_number}`);

    if (session.notes && session.notes.trim()) {
      parts.push(`\nGM notes for this session:\n${session.notes.trim()}`);
    }

    if (events && events.length) {
      const lines = events.map((ev: any) => {
        const who = nameOf(ev.character_id);
        const axis = ev.axis ? `[${AXIS_NAME[ev.axis] || ev.axis}] ` : "";
        const note = ev.payload?.note ? ` — ${ev.payload.note}` : "";
        return `- ${axis}${who}: ${typeLabel(ev.event_type)}${note}`;
      });
      parts.push(`\nLogged events (in order):\n${lines.join("\n")}`);
    }

    if (loot && loot.length) {
      const lines = loot.map((l: any) =>
        `- ${l.item_name}${l.rarity ? ` (${l.rarity})` : ""} to ${nameOf(l.character_id)}`);
      parts.push(`\nLoot gained:\n${lines.join("\n")}`);
    }

    if (touches && touches.length) {
      const titles = touches
        .map((t: any) => (Array.isArray(t.arcs) ? t.arcs[0]?.title : t.arcs?.title))
        .filter(Boolean);
      if (titles.length) parts.push(`\nStory threads advanced: ${titles.join(", ")}`);
    }

    const hasContent =
      (session.notes && session.notes.trim()) ||
      (events && events.length) ||
      (loot && loot.length);
    if (!hasContent) {
      return NextResponse.json(
        { error: "Nothing to summarize yet. Add session notes or log a few events first." },
        { status: 422 },
      );
    }

    const context = parts.join("\n");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Recap service is not configured." }, { status: 500 });
    }

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: RECAP_MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: context }],
      }),
    });

    if (!aiRes.ok) {
      return NextResponse.json({ error: "The recap model returned an error. Try again." }, { status: 502 });
    }

    const data = await aiRes.json();
    const recap = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    if (!recap) {
      return NextResponse.json({ error: "The recap came back empty. Try again." }, { status: 502 });
    }

    return NextResponse.json({ recap });
  } catch {
    return NextResponse.json({ error: "Could not generate recap." }, { status: 500 });
  }
}
