// Stage 1 proof: POST two real events (from the Beyond20 spike capture) to the
// vtt ingest endpoint. Run with: node scripts/test-vtt-ingest.mjs
// Optional env: BASE_URL (default https://pc-wrangler.vercel.app), SHARE_CODE.

const BASE_URL = process.env.BASE_URL || "https://pc-wrangler.vercel.app";
const SHARE_CODE = process.env.SHARE_CODE || "e99867dbd3";

const now = new Date().toISOString();

const events = [
  {
    source: "beyond20",
    ddb_character_id: "155882597",
    actor_name: "Boberta Barkwalker",
    event_type: "to-hit",
    name: "Guiding Bolt",
    fidelity: "canonical",
    rolled_at: now,
    rolls: {
      formula: "1d20 + 5",
      total: 11,
      modifier: 5,
      advantage: 0,
      dice: [{ faces: 20, results: [6] }],
      critical_success: false,
      critical_failure: false,
      discarded: false,
    },
    state: { hp: 21, max_hp: 21, temp_hp: 0, conditions: [], exhaustion: 0 },
  },
  {
    source: "beyond20",
    ddb_character_id: "155882597",
    actor_name: "Boberta Barkwalker",
    event_type: "damage",
    name: "Guiding Bolt",
    fidelity: "canonical",
    rolled_at: now,
    rolls: {
      formula: "4d6",
      total: 11,
      damage_type: "Radiant",
      dice: [{ faces: 6, results: [2, 1, 3, 5] }],
    },
    state: { hp: 21, max_hp: 21, temp_hp: 0, conditions: [], exhaustion: 0 },
  },
];

const res = await fetch(`${BASE_URL}/api/vtt/ingest`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ share_code: SHARE_CODE, events }),
});

console.log("HTTP", res.status);
console.log(JSON.stringify(await res.json(), null, 2));
