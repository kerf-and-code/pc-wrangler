import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reserveAi, releaseAi } from "@/lib/ai-allowance";
import { anthropicTokens, recordUsage } from "@/lib/usage";
import {
  ASK_MODEL, ASK_SYSTEM, QUESTION_MAX, buildAskPrompt, citedNumbers, extractTerms, numberSources, tidyAnswer, wantsRecent,
  type AskSource,
} from "@/lib/ask";

export const maxDuration = 60;

// POST /api/ask   body: { campaignId, question } (2026-11-10, push 27, audit P1)
//
// Ask the campaign. GM only (owner or co-GM). The question's words are searched across the campaign's
// transcripts, story beats, Codex, cast and recaps (p153 ask_campaign_search, full-text, run as the
// caller so the database checks they are a GM), and Claude answers from the best matches with numbered
// citations. When nothing matches, no model call is made and no allowance is spent.
//
// Answers { answer, sources, cited, remaining } or { answer: null, sources: [], empty: true }.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { campaignId?: string; question?: string };
  const campaignId = (body.campaignId || "").trim();
  const question = typeof body.question === "string" ? body.question.trim().slice(0, QUESTION_MAX) : "";
  if (!UUID.test(campaignId)) return NextResponse.json({ error: "Pick a campaign first." }, { status: 400 });
  if (question.length < 3) return NextResponse.json({ error: "Type a question first." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only this campaign's GMs can ask about it." }, { status: 403 });

  const terms = extractTerms(question);
  const recent = wantsRecent(question) || terms.length === 0;
  const search = async (p_recent: number) =>
    supabase.rpc("ask_campaign_search", { p_campaign: campaignId, p_terms: terms, p_limit: 24, p_recent });

  const first = await search(recent ? 3 : 0);
  const error = first.error;
  let rows = first.data;
  if (error) {
    console.error("ask: search failed", error.message);
    const missing = /ask_campaign_search/.test(error.message) && /(does not exist|could not find)/i.test(error.message);
    return NextResponse.json(
      { error: missing ? "Ask the campaign is being set up. Try again in a few minutes." : "Could not search the campaign. Try again." },
      { status: missing ? 503 : 500 },
    );
  }
  // Thin results: add the latest recaps as background, so a vague question still gets context.
  if (!recent && (rows || []).length < 3) {
    const again = await search(2);
    if (!again.error) rows = again.data;
  }

  const sources: AskSource[] = numberSources((rows as unknown[]) || []);
  if (!sources.length) {
    return NextResponse.json({ answer: null, sources: [], cited: [], empty: true, terms });
  }

  const admin = createAdminClient();
  const grant = await reserveAi(admin, user.id, campaignId, "ask");
  if (!grant.ok) return NextResponse.json({ error: grant.error, limited: grant.limited ?? false }, { status: grant.status });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await releaseAi(admin, grant.id);
    return NextResponse.json({ error: "Answers are not set up on this server yet." }, { status: 503 });
  }

  const { data: camp } = await supabase.from("campaigns").select("name").eq("id", campaignId).maybeSingle();
  const campaignName = (camp as { name: string | null } | null)?.name ?? null;

  let answer = "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: ASK_MODEL,
        max_tokens: 900,
        system: ASK_SYSTEM,
        messages: [{ role: "user", content: buildAskPrompt(question, sources, campaignName) }],
      }),
    });
    if (!res.ok) throw new Error(`model ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    await recordUsage({ kind: "ai", provider: "anthropic", model: ASK_MODEL, route: "ask", campaignId, ...anthropicTokens(data) });
    answer = tidyAnswer((data.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("\n"));
    if (!answer) throw new Error("empty answer");
  } catch (e) {
    console.error("ask: model failed", e instanceof Error ? e.message : e);
    await releaseAi(admin, grant.id);
    return NextResponse.json({ error: "Could not write an answer just now. Nothing was counted against your daily questions; try again." }, { status: 502 });
  }

  return NextResponse.json({ answer, sources, cited: citedNumbers(answer, sources.length), remaining: grant.remaining, terms });
}
