// lib/languages.ts (2026-11-10, push 26, audit P2)
//
// The language a table plays in (campaigns.audio_language, p152). It sets the language the recordings
// are transcribed in (Groq Whisper on the sidecar, Replicate WhisperX for room recordings, Deepgram as
// the fallback) and the language recaps and the campaign journal are written in. The app itself stays
// in English. Every language here is one Whisper transcribes; Deepgram, the fallback, covers fewer, so
// a fallback in a language it does not take fails visibly rather than coming back as English.

export type TableLanguage = { code: string; name: string };

export const TABLE_LANGUAGES: TableLanguage[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "no", name: "Norwegian" },
  { code: "fi", name: "Finnish" },
  { code: "cs", name: "Czech" },
  { code: "hu", name: "Hungarian" },
  { code: "ro", name: "Romanian" },
  { code: "el", name: "Greek" },
  { code: "tr", name: "Turkish" },
  { code: "ru", name: "Russian" },
  { code: "uk", name: "Ukrainian" },
  { code: "he", name: "Hebrew" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
];

const BY_CODE = new Map(TABLE_LANGUAGES.map((l) => [l.code, l]));

/** A stored code, or English for anything unknown or empty. */
export function tableLanguage(code: string | null | undefined): TableLanguage {
  return BY_CODE.get(String(code ?? "").trim().toLowerCase()) ?? BY_CODE.get("en")!;
}

/** The line added to a writing prompt so the model writes in the table's language; empty for English. */
export function writeInLanguage(code: string | null | undefined): string {
  const l = tableLanguage(code);
  return l.code === "en" ? "" : `\n- Write entirely in ${l.name}, the language this table plays in. Keep character and place names as they appear in the input.`;
}

type DbLike = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The campaign's language code ("en" when unset, or before p152 has run). */
export async function campaignLanguage(db: DbLike, campaignId: string | null | undefined): Promise<string> {
  if (!campaignId) return "en";
  try {
    const { data, error } = await db.from("campaigns").select("audio_language").eq("id", campaignId).maybeSingle();
    if (error) return "en";
    return tableLanguage((data as { audio_language?: string | null } | null)?.audio_language).code;
  } catch {
    return "en";
  }
}
