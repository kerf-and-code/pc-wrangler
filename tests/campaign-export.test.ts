import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCampaignExport } from "@/lib/campaign/export";

// Push 3 (audit F3): what a campaign export contains, against a stand-in database.
const CID = "11111111-1111-1111-1111-111111111111";
const rows: Record<string, Record<string, unknown>[]> = {
  sessions: [{ id: "s1", campaign_id: CID, session_number: 3, recap: "They found the vault.", reminder_sent_at: "x" }],
  characters: [{ id: "c1", campaign_id: CID, name: "Bobert", profile_id: "secret-owner", discord_user_id: "123", invite_code: "abc" }],
  entries: [{ id: "e1aaaaaaaa", campaign_id: CID, type: "location", title: "The Sunken Vault", body: "Wet.", visibility: "gm", created_by: "u1" }],
  world_maps: [{ id: "w1", campaign_id: CID }],
  map_pois: [{ id: "p1", world_map_id: "w1", name: "Gate" }],
};

function fake(): SupabaseClient {
  const query = (table: string) => {
    let filter: (r: Record<string, unknown>) => boolean = () => true;
    const missing = table === "vtt_audio"; // a table this database does not have
    const result = () => Promise.resolve(missing
      ? { data: null, error: { message: `relation ${table} does not exist` } }
      : { data: (rows[table] ?? []).filter(filter), error: null });
    const b = {
      select: () => b,
      range: () => b,
      eq: (col: string, v: unknown) => { filter = (r) => r[col] === v; return Object.assign(result(), b); },
      in: (col: string, vs: unknown[]) => { filter = (r) => vs.includes(r[col]); return result(); },
      single: () => Promise.resolve({ data: { id: CID, name: "Ember & Ash" }, error: null }),
    };
    return b;
  };
  return {
    from: (t: string) => query(t),
    storage: { from: () => ({ list: async () => ({ data: [{ id: "f", name: "map.png" }], error: null }), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }) }) },
  } as unknown as SupabaseClient;
}

describe("buildCampaignExport", () => {
  it("packs the campaign's records, Markdown and file list, without account ids", async () => {
    const out = await buildCampaignExport(fake(), CID);
    const zip = await JSZip.loadAsync(out.zip);
    const names = Object.keys(zip.files);
    expect(names).toContain("campaign.json");
    expect(names).toContain("recaps/session-003.md");
    expect(names.some((n) => n.startsWith("codex/location/the-sunken-vault-"))).toBe(true);
    const chars = JSON.parse(await zip.file("data/characters.json")!.async("string"));
    expect(chars[0].name).toBe("Bobert");
    expect(chars[0].profile_id).toBeUndefined();
    expect(chars[0].discord_user_id).toBeUndefined();
    const sessions = JSON.parse(await zip.file("data/sessions.json")!.async("string"));
    expect(sessions[0].reminder_sent_at).toBeUndefined();
    expect(JSON.parse(await zip.file("data/map_pois.json")!.async("string"))[0].name).toBe("Gate");
    expect(JSON.parse(await zip.file("files.json")!.async("string"))[0].url).toBe(`https://cdn/${CID}/map.png`);
    expect(out.skipped.join(" ")).toContain("vtt_audio");
    expect(out.name).toMatch(/^ember-ash-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/);
  });
});
